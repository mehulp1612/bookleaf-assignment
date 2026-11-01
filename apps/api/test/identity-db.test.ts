import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { endpoints } from '@bookleaf/contracts';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedIdentity } from '../src/modules/auth/seed.js';
import { createPrismaAuthStore } from '../src/modules/auth/prisma-store.js';
import { hashToken } from '../src/modules/auth/service.js';
import { verifyPassword } from '../src/modules/auth/passwords.js';
import { buildApp } from '../src/app.js';
import { requireRole } from '../src/modules/auth/http.js';

async function verifyHttpAuthentication(
  client: PrismaClient,
  authorPassword: string,
  adminPassword: string,
) {
  const appOrigin = 'http://localhost:5173';
  let time = Date.now();
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
      appOrigin,
      production: false,
      sessionTtlSeconds: 60,
      clock: () => new Date(time),
    },
  });
  app.get('/api/v1/test-admin', { preHandler: requireRole('ADMIN') }, async () => ({
    allowed: true,
  }));
  try {
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const headers = {
      origin: appOrigin,
      'x-bookleaf-request': '1',
      'content-type': 'application/json',
    };
    const login = async (email: string, password: string) => {
      const response = await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, password }),
      });
      assert.equal(response.status, 200);
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      const body = await response.text();
      assert.equal(body.includes(password), false);
      assert.equal(body.includes(cookie.split('=')[1]!), false);
      return cookie;
    };
    assert.equal((await fetch(`${base}/health/ready`)).status, 200);
    assert.equal((await fetch(`${base}/api/v1/auth/me`)).status, 401);
    const authorCookie = await login('priya.sharma@email.com', authorPassword);
    const me = await fetch(`${base}/api/v1/auth/me`, { headers: { cookie: authorCookie } });
    assert.equal(me.status, 200);
    assert.equal(endpoints.me.response.parse(await me.json()).data.authorId, 'AUTH001');
    assert.equal(
      (await fetch(`${base}/api/v1/test-admin`, { headers: { cookie: authorCookie } })).status,
      403,
    );
    const adminCookie = await login('admin@example.test', adminPassword);
    assert.equal(
      (await fetch(`${base}/api/v1/test-admin`, { headers: { cookie: adminCookie } })).status,
      200,
    );
    // A cross-origin logout must neither succeed nor revoke the valid session.
    assert.equal(
      (
        await fetch(`${base}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            origin: 'https://other.example.test',
            cookie: authorCookie,
            'x-bookleaf-request': '1',
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(`${base}/api/v1/auth/me`, { headers: { cookie: authorCookie } })).status,
      200,
    );
    const logout = await fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { origin: appOrigin, 'x-bookleaf-request': '1', cookie: authorCookie },
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
    assert.equal(
      (await fetch(`${base}/api/v1/auth/me`, { headers: { cookie: authorCookie } })).status,
      401,
    );
    time += 60000;
    assert.equal(
      (await fetch(`${base}/api/v1/auth/me`, { headers: { cookie: adminCookie } })).status,
      401,
    );
    console.log(
      'Live HTTP with PostgreSQL passed: readiness, login/me, roles, CSRF, logout/replay, expiry.',
    );
  } finally {
    await app.close();
  }
}

// Opt-in only. Creates/drops a new random schema; never truncates existing application tables.
test(
  'PostgreSQL migration, repeatable seed, atomic throttle, session persistence and rotation',
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async () => {
    const connectionString = process.env.TEST_DATABASE_URL!;
    const schema = `bookleaf_identity_test_${randomBytes(8).toString('hex')}`;
    assert.match(schema, /^bookleaf_identity_test_[a-f0-9]{16}$/);
    const connection = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
    const client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString,
          options: `-c search_path=${schema}`,
          connectionTimeoutMillis: 3000,
        },
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
      // npm workspaces run in apps/api; direct compiled checks run from repository root.
      const root = process.cwd().replaceAll('\\', '/').endsWith('/apps/api')
        ? resolve('../..')
        : process.cwd();
      await connection.query(
        await readFile(
          resolve(root, 'apps/api/prisma/migrations/202611010001_identity/migration.sql'),
          'utf8',
        ),
      );
      const data: unknown = JSON.parse(
        await readFile(resolve(root, 'FULLSTACK-SAMPLEDATA (1) (1) (1).json'), 'utf8'),
      );
      const credentials = {
        DEMO_ADMIN_EMAIL: 'admin@example.test',
        DEMO_ADMIN_PASSWORD: randomBytes(24).toString('base64url'),
        DEMO_AUTHOR_PASSWORD: randomBytes(24).toString('base64url'),
      };
      assert.deepEqual(await seedIdentity(client, data, credentials), { users: 11, authors: 10 });
      const first = await client.user.findUniqueOrThrow({ where: { id: 'demo-author-AUTH001' } });
      assert.equal(
        await verifyPassword(credentials.DEMO_AUTHOR_PASSWORD, first.passwordHash),
        true,
      );
      await seedIdentity(client, data, credentials);
      assert.equal(await client.user.count(), 11);
      assert.equal(await client.author.count(), 10);
      assert.equal(
        (await client.user.findUniqueOrThrow({ where: { id: first.id } })).passwordHash,
        first.passwordHash,
      );
      await assert.rejects(
        client.user.create({
          data: {
            id: 'bad-role',
            email: 'bad@example.test',
            displayName: 'Invalid',
            passwordHash: first.passwordHash,
            role: 'AUTHOR',
          },
        }),
      );
      const store = createPrismaAuthStore(client);
      await verifyHttpAuthentication(
        client,
        credentials.DEMO_AUTHOR_PASSWORD,
        credentials.DEMO_ADMIN_PASSWORD,
      );
      const now = new Date();
      const attempts = await Promise.all(
        Array.from({ length: 12 }, () =>
          store.consumeAttempts([{ key: 'test-bucket', limit: 10 }], now, 900),
        ),
      );
      assert.equal(attempts.filter((value) => value === 0).length, 10);
      assert.equal(attempts.filter((value) => value > 0).length, 2);
      const tokenHash = hashToken(randomBytes(32).toString('hex'));
      await store.replaceSession(
        { tokenHash, userId: first.id, expiresAt: new Date(now.getTime() + 60000) },
        null,
        now,
      );
      const secondClient = new PrismaClient({
        adapter: new PrismaPg({ connectionString }, { schema }),
        log: [],
      });
      try {
        assert.equal(
          (await createPrismaAuthStore(secondClient).findSession(tokenHash))?.user.id,
          first.id,
        );
      } finally {
        await secondClient.$disconnect();
      }
      const newHash = hashToken(randomBytes(32).toString('hex'));
      await store.replaceSession(
        { tokenHash: newHash, userId: first.id, expiresAt: new Date(now.getTime() + 60000) },
        tokenHash,
        now,
      );
      assert.equal(await store.findSession(tokenHash), null);
      assert.ok(await store.findSession(newHash));
      await seedIdentity(client, data, { ...credentials, DEMO_RESET_PASSWORDS: 'true' });
      assert.equal(await client.session.count(), 0);
      assert.notEqual(
        (await client.user.findUniqueOrThrow({ where: { id: first.id } })).passwordHash,
        first.passwordHash,
      );
    } finally {
      await client.$disconnect();
      if (created) await connection.query(`DROP SCHEMA "${schema}" CASCADE`);
      await connection.end();
    }
  },
);
