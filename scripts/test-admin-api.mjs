// Real HTTP/PostgreSQL verification of the web adapters, without a browser.
// Run from repository root with TEST_DATABASE_URL: npx tsx scripts/test-admin-api.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/dist/generated/prisma/client.js';
import { buildApp } from '../apps/api/dist/app.js';
import { seedDemoData } from '../apps/api/dist/seed-data.js';
import { createCatalogService } from '../apps/api/dist/modules/catalog/service.js';
import { createTicketService } from '../apps/api/dist/modules/tickets/service.js';
import { createPrismaAuthStore } from '../apps/api/dist/modules/auth/prisma-store.js';
import { adminApi } from '../apps/web/src/features/admin-tickets/api.ts';
import { httpDraftApi } from '../apps/web/src/features/admin-tickets/ai.ts';
import { ApiClientError } from '../apps/web/src/shared/api.ts';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('Set TEST_DATABASE_URL to a disposable development PostgreSQL database.');
const schema = `bookleaf_admin_ui_test_${randomBytes(8).toString('hex')}`;
assert.match(schema, /^bookleaf_admin_ui_test_[a-f0-9]{16}$/);
const connectionString = process.env.TEST_DATABASE_URL;
const connection = new pg.Client({ connectionString });
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  log: [],
});
let app,
  created = false;
const originalFetch = globalThis.fetch;
try {
  await connection.connect();
  await connection.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  await connection.query(`SET search_path TO "${schema}"`);
  for (const entry of (await readdir('apps/api/prisma/migrations', { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    await connection.query(
      await readFile(`apps/api/prisma/migrations/${entry.name}/migration.sql`, 'utf8'),
    );
  const sample = JSON.parse(await readFile('FULLSTACK-SAMPLEDATA (1) (1) (1).json', 'utf8'));
  const credentials = {
    DEMO_ADMIN_EMAIL: 'admin@example.test',
    DEMO_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
    DEMO_AUTHOR_PASSWORD: randomBytes(24).toString('hex'),
  };
  await seedDemoData(client, sample, credentials);
  const catalog = createCatalogService(client);
  app = await buildApp({
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
    tickets: createTicketService(client, catalog),
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = async (email, password) => {
    const response = await originalFetch(`${base}/api/v1/auth/login`, {
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
  const authorCookie = await login(sample.authors[0].email, credentials.DEMO_AUTHOR_PASSWORD);
  const otherCookie = await login(sample.authors[1].email, credentials.DEMO_AUTHOR_PASSWORD);
  const adminCookie = await login(credentials.DEMO_ADMIN_EMAIL, credentials.DEMO_ADMIN_PASSWORD);
  let cookie = authorCookie;
  // Node has no browser cookie jar or relative URL base: emulate those two transport facilities only.
  globalThis.fetch = (path, init) => {
    const headers = new Headers(init?.headers);
    headers.set('cookie', cookie);
    headers.set('origin', 'http://localhost:5173');
    return originalFetch(new URL(String(path), base), { ...init, headers });
  };
  const createResponse = await globalThis.fetch('/api/v1/tickets', {
    method: 'POST',
    headers: { 'x-bookleaf-request': '1', 'content-type': 'application/json' },
    body: JSON.stringify({
      bookId: 'BK001',
      subject: 'Admin UI adapter verification',
      description: 'Please check my book.',
    }),
  });
  assert.equal(createResponse.status, 201);
  const ticket = (await createResponse.json()).data;
  cookie = adminCookie;
  let detail = (await adminApi.detail(ticket.id, new AbortController().signal)).data;
  assert.equal(detail.classificationState, 'QUEUED');
  detail = (
    await adminApi.update(ticket.id, {
      expectedRevision: detail.revision,
      category: 'ISBN_METADATA',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      assignmentAction: 'SELF',
    })
  ).data;
  assert.equal(detail.assignee.id, 'demo-admin');
  assert.equal(detail.categorySource, 'MANUAL');
  assert.equal(detail.prioritySource, 'MANUAL');
  const queue = await adminApi.list(
    'status=IN_PROGRESS&category=ISBN_METADATA&priority=HIGH&page=1&pageSize=10',
    new AbortController().signal,
  );
  assert.equal(queue.meta.total, 1);
  assert.equal(queue.data[0].id, ticket.id);
  await adminApi.note(ticket.id, 'PRIVATE_ADMIN_ADAPTER_SENTINEL');
  const stale = {
    key: 'first-send',
    body: 'Reviewed public response.',
    expectedRevision: detail.revision,
  };
  await assert.rejects(
    adminApi.reply(ticket.id, stale),
    (error) => error instanceof ApiClientError && error.status === 409,
  );
  detail = (await adminApi.detail(ticket.id, new AbortController().signal)).data;
  const attempt = { ...stale, key: 'reviewed-send', expectedRevision: detail.revision };
  const [first, retry] = await Promise.all([
    adminApi.reply(ticket.id, attempt),
    adminApi.reply(ticket.id, attempt),
  ]);
  assert.deepEqual(first, retry);
  detail = (await adminApi.detail(ticket.id, new AbortController().signal)).data;
  assert.equal(detail.replies.length, 1);
  assert.equal(detail.notes.length, 1);
  detail = (
    await adminApi.update(ticket.id, {
      expectedRevision: detail.revision,
      status: 'RESOLVED',
      assignmentAction: 'UNASSIGN',
    })
  ).data;
  assert.equal(detail.assignee, null);
  assert.deepEqual(await httpDraftApi.latest(ticket.id), { available: false });
  cookie = authorCookie;
  const authorView = await (await globalThis.fetch(`/api/v1/tickets/${ticket.id}`)).json();
  assert.equal(authorView.data.replies.length, 1);
  assert.equal(authorView.data.status, 'RESOLVED');
  assert.equal(JSON.stringify(authorView).includes('PRIVATE_ADMIN_ADAPTER_SENTINEL'), false);
  await assert.rejects(
    adminApi.note(ticket.id, 'Must fail'),
    (error) => error instanceof ApiClientError && error.status === 403,
  );
  cookie = otherCookie;
  assert.equal((await globalThis.fetch(`/api/v1/tickets/${ticket.id}`)).status, 404);
  console.log(
    'PASS real admin web adapters: filtered queue, assignment, overrides, status, private note, revision conflict, concurrent idempotent reply, author visibility, ownership and unavailable AI.',
  );
} finally {
  globalThis.fetch = originalFetch;
  await app?.close();
  await client.$disconnect();
  if (created) await connection.query(`DROP SCHEMA "${schema}" CASCADE`);
  await connection.end();
}
