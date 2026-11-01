import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { currentUserSchema, endpoints } from '@bookleaf/contracts';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedDemoData } from '../src/seed-data.js';
import { catalogImportSchema, importCatalog } from '../src/modules/catalog/import.js';
import { createCatalogService } from '../src/modules/catalog/service.js';
import { createPrismaAuthStore } from '../src/modules/auth/prisma-store.js';
import { hashToken } from '../src/modules/auth/service.js';
import { buildApp } from '../src/app.js';
import { applyTestMigrations, repositoryRoot } from './helpers/migrations.js';

test(
  'catalog PostgreSQL import, HTTP ownership, verified context and preservation on reruns',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const connectionString = process.env.TEST_DATABASE_URL!;
    const schema = `bookleaf_catalog_test_${randomBytes(8).toString('hex')}`;
    assert.match(schema, /^bookleaf_catalog_test_[a-f0-9]{16}$/);
    const connection = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
    const client = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 },
        { schema },
      ),
      log: [],
    });
    let created = false;
    try {
      await connection.connect();
      await connection.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      await connection.query(`SET search_path TO "${schema}"`);
      await applyTestMigrations(connection, async (name) => {
        if (name.endsWith('_identity')) {
          await connection.query('INSERT INTO "Author" (id) VALUES ($1)', ['AUTH001']);
        }
      });
      const raw: unknown = JSON.parse(
        await readFile(resolve(repositoryRoot(), 'FULLSTACK-SAMPLEDATA (1) (1) (1).json'), 'utf8'),
      );
      const source = catalogImportSchema.parse(raw);
      const credentials = {
        DEMO_ADMIN_EMAIL: 'admin@example.test',
        DEMO_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
        DEMO_AUTHOR_PASSWORD: randomBytes(24).toString('hex'),
      };
      // A preexisting M02 anchor survives the catalog migration/import path.
      assert.equal(
        (await client.author.findUniqueOrThrow({ where: { id: 'AUTH001' } })).name,
        null,
      );
      assert.deepEqual(await seedDemoData(client, raw, credentials), {
        authors: 10,
        books: 18,
        users: 11,
      });
      const catalog = createCatalogService(client);
      const admin = currentUserSchema.parse(
        await client.user.findUniqueOrThrow({ where: { id: 'demo-admin' } }),
      );
      const firstUser = await client.user.findUniqueOrThrow({
        where: { id: 'demo-author-AUTH001' },
      });
      const firstPrincipal = currentUserSchema.parse(firstUser);
      const before = await client.book.findMany({ orderBy: { id: 'asc' } });
      const now = new Date();
      const tokenHash = hashToken(randomBytes(32).toString('hex'));
      await createPrismaAuthStore(client).replaceSession(
        { tokenHash, userId: firstUser.id, expiresAt: new Date(now.getTime() + 600000) },
        null,
        now,
      );
      // Test-only dependent record simulates future support data without implementing M04.
      await connection.query(
        'CREATE TABLE "SupportSentinel" (id TEXT PRIMARY KEY, "authorId" TEXT REFERENCES "Author"(id), "bookId" TEXT REFERENCES "Book"(id), body TEXT NOT NULL)',
      );
      await connection.query('INSERT INTO "SupportSentinel" VALUES ($1, $2, $3, $4)', [
        'preserve',
        'AUTH001',
        'BK001',
        'Existing support content',
      ]);
      await seedDemoData(client, raw, credentials);
      await importCatalog(client, raw);
      assert.equal(await client.author.count(), 10);
      assert.equal(await client.book.count(), 18);
      assert.equal(await client.user.count(), 11);
      assert.deepEqual(await client.book.findMany({ orderBy: { id: 'asc' } }), before);
      assert.equal(
        (await client.user.findUniqueOrThrow({ where: { id: firstUser.id } })).passwordHash,
        firstUser.passwordHash,
      );
      assert.equal(await client.session.count({ where: { tokenHash } }), 1);
      assert.equal(
        (await connection.query('SELECT body FROM "SupportSentinel" WHERE id = $1', ['preserve']))
          .rows[0].body,
        'Existing support content',
      );

      for (const author of source.authors) {
        const profile = await client.author.findUniqueOrThrow({ where: { id: author.author_id } });
        assert.equal(profile.name, author.name);
        assert.equal(profile.email, author.email);
        assert.equal(profile.phone, author.phone);
        assert.equal(profile.city, author.city);
        assert.equal(profile.joinedDate?.toISOString().slice(0, 10), author.joined_date);
        const user = await client.user.findUniqueOrThrow({ where: { authorId: author.author_id } });
        assert.equal(user.email, author.email);
        for (const book of author.books) {
          const output = await catalog.getBook(admin, book.book_id);
          assert.deepEqual(output, {
            id: book.book_id,
            authorId: author.author_id,
            title: book.title,
            isbn: book.isbn,
            genre: book.genre,
            publicationDate: book.publication_date,
            status: book.status,
            mrpPaise: book.mrp,
            authorRoyaltyPerCopyPaise: book.author_royalty_per_copy,
            totalCopiesSold: book.total_copies_sold,
            totalRoyaltyEarnedPaise: book.total_royalty_earned,
            royaltyPaidPaise: book.royalty_paid,
            royaltyPendingPaise: book.royalty_pending,
            lastRoyaltyPayoutDate: book.last_royalty_payout_date,
            printPartner: book.print_partner,
            availableOn: book.available_on,
          });
        }
      }
      const privateFailure = (error: unknown) =>
        error instanceof Error && 'statusCode' in error && error.statusCode === 404;
      await assert.rejects(catalog.getBook(firstPrincipal, 'BK003'), privateFailure);
      await assert.rejects(catalog.getBook(firstPrincipal, 'missing'), privateFailure);
      await assert.rejects(catalog.assertBookOwnership(admin, 'AUTH001', 'BK003'), privateFailure);
      await assert.rejects(
        catalog.getBookContext(firstPrincipal, 'AUTH002', 'BK003'),
        privateFailure,
      );
      await assert.rejects(catalog.getAccountContext(firstPrincipal, 'AUTH002'), privateFailure);
      const context = await catalog.getBookContext(firstPrincipal, 'AUTH001', 'BK001');
      assert.equal(context.book.royaltyPendingPaise, 357000);
      for (const key of ['email', 'phone', 'passwordHash', 'bankAccount', 'payoutDeadline'])
        assert.equal(JSON.stringify(context).includes(`"${key}"`), false);
      assert.deepEqual(await catalog.getAccountContext(firstPrincipal, 'AUTH001'), {
        source: 'catalog_snapshot',
        currency: 'INR',
        authorId: 'AUTH001',
        bookCount: 2,
        totalRoyaltyEarnedPaise: 1990800,
        royaltyPaidPaise: 1633800,
        royaltyPendingPaise: 357000,
      });

      const app = await buildApp({
        logLevel: 'silent',
        database: {
          check: async () => {
            await client.$queryRaw`SELECT 1`;
          },
          close: async () => {},
        },
        auth: {
          store: createPrismaAuthStore(client),
          appOrigin: 'http://localhost:5173',
          production: false,
          sessionTtlSeconds: 3600,
        },
        catalog,
      });
      try {
        const base = await app.listen({ host: '127.0.0.1', port: 0 });
        const login = async (email: string, password: string) => {
          const response = await fetch(`${base}/api/v1/auth/login`, {
            method: 'POST',
            headers: {
              origin: 'http://localhost:5173',
              'x-bookleaf-request': '1',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
          });
          assert.equal(response.status, 200);
          await response.text();
          const cookie = response.headers.get('set-cookie')?.split(';')[0];
          assert.ok(cookie);
          return cookie;
        };
        assert.equal((await fetch(`${base}/api/v1/books`)).status, 401);
        assert.equal((await fetch(`${base}/api/v1/books/BK001`)).status, 401);
        let firstCookie = '';
        for (const author of source.authors) {
          const cookie = await login(author.email, credentials.DEMO_AUTHOR_PASSWORD);
          if (author.author_id === 'AUTH001') firstCookie = cookie;
          const response = await fetch(`${base}/api/v1/books`, { headers: { cookie } });
          assert.equal(response.status, 200);
          const body = endpoints.books.response.parse(await response.json());
          assert.equal(body.meta.total, author.books.length);
          assert.deepEqual(
            body.data.map((book) => book.id),
            author.books.map((book) => book.book_id),
          );
          assert.ok(body.data.every((book) => book.authorId === author.author_id));
        }
        for (const [path, status] of [
          ['/books/BK003', 404],
          ['/books/missing', 404],
          ['/books?authorId=AUTH002', 403],
          ['/books?page=0', 400],
          ['/books?pageSize=101', 400],
          ['/books?page=9007199254740991', 400],
          ['/books?unexpected=value', 400],
        ] as const)
          assert.equal(
            (await fetch(`${base}/api/v1${path}`, { headers: { cookie: firstCookie } })).status,
            status,
          );
        const adminCookie = await login(
          credentials.DEMO_ADMIN_EMAIL,
          credentials.DEMO_ADMIN_PASSWORD,
        );
        for (const [query, total, ids] of [
          ['?page=2&pageSize=5', 18, ['BK006', 'BK007', 'BK008', 'BK009', 'BK010']],
          ['?authorId=AUTH007', 3, ['BK011', 'BK012', 'BK013']],
          ['?authorId=missing', 0, []],
          ['?page=999', 18, []],
        ] as const) {
          const response = await fetch(`${base}/api/v1/books${query}`, {
            headers: { cookie: adminCookie },
          });
          assert.equal(response.status, 200);
          const body = endpoints.books.response.parse(await response.json());
          assert.equal(body.meta.total, total);
          assert.deepEqual(
            body.data.map((book) => book.id),
            ids,
          );
        }
        const detail = await fetch(`${base}/api/v1/books/BK013`, {
          headers: { cookie: adminCookie },
        });
        assert.equal(detail.status, 200);
        assert.equal(endpoints.book.response.parse(await detail.json()).data.mrpPaise, null);
      } finally {
        await app.close();
      }

      // A late ownership conflict rolls back even earlier profile changes in the same import.
      const conflicting = JSON.parse(JSON.stringify(raw));
      conflicting.authors[0].name = 'Must roll back';
      const moved = conflicting.authors[0].books.shift();
      conflicting.authors[1].books.push(moved);
      await assert.rejects(importCatalog(client, conflicting), /cannot transfer/);
      assert.equal(
        (await client.author.findUniqueOrThrow({ where: { id: 'AUTH001' } })).name,
        source.authors[0]!.name,
      );
      assert.equal(
        (await client.book.findUniqueOrThrow({ where: { id: 'BK001' } })).authorId,
        'AUTH001',
      );
      // A late identity uniqueness failure must also roll back catalog changes in the combined seed.
      const changed = JSON.parse(JSON.stringify(raw));
      changed.authors[0].name = 'Must also roll back';
      await client.user.create({
        data: {
          id: 'unrelated-user',
          email: 'occupied@example.test',
          displayName: 'Unrelated',
          role: 'ADMIN',
          passwordHash: firstUser.passwordHash,
        },
      });
      await assert.rejects(
        seedDemoData(client, changed, {
          ...credentials,
          DEMO_ADMIN_EMAIL: 'occupied@example.test',
        }),
      );
      assert.equal(
        (await client.author.findUniqueOrThrow({ where: { id: 'AUTH001' } })).name,
        source.authors[0]!.name,
      );
      assert.ok(await client.user.findUnique({ where: { id: 'unrelated-user' } }));
      await client.author.create({ data: { id: 'EMPTY' } });
      const emptyPrincipal = { ...firstPrincipal, authorId: 'EMPTY' };
      assert.equal((await catalog.listBooks(emptyPrincipal, {})).meta.total, 0);
      assert.equal(
        (await catalog.getAccountContext(emptyPrincipal, 'EMPTY')).royaltyPendingPaise,
        0,
      );
      await client.book.create({ data: { ...before[0]!, id: 'EXTRA_BOOK', authorId: 'EMPTY' } });
      await seedDemoData(client, raw, credentials);
      assert.equal(await client.author.count(), 11);
      assert.equal(await client.book.count(), 19);
      assert.ok(await client.user.findUnique({ where: { id: 'unrelated-user' } }));
      assert.equal(await client.session.count({ where: { tokenHash } }), 1);
      console.log(
        'Catalog live checks passed: all 18 records, all 10 author logins, isolation, contexts, reruns and rollback.',
      );
    } finally {
      await client.$disconnect();
      if (created) await connection.query(`DROP SCHEMA "${schema}" CASCADE`);
      await connection.end();
    }
  },
);
