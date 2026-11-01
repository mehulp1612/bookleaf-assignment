// Optional real-browser integration check. Build API/web first; see docs/author-interface.md.
/* global document, window */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/dist/generated/prisma/client.js';
import { buildApp } from '../apps/api/dist/app.js';
import { seedDemoData } from '../apps/api/dist/seed-data.js';
import { createCatalogService } from '../apps/api/dist/modules/catalog/service.js';
import { createTicketService } from '../apps/api/dist/modules/tickets/service.js';
import { createPrismaAuthStore } from '../apps/api/dist/modules/auth/prisma-store.js';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('Set TEST_DATABASE_URL to a disposable development database.');
const { chromium } = await import(
  process.env.BOOKLEAF_PLAYWRIGHT_MODULE
    ? pathToFileURL(resolve(process.env.BOOKLEAF_PLAYWRIGHT_MODULE)).href
    : 'playwright'
);
const schema = `bookleaf_web_test_${randomBytes(8).toString('hex')}`;
assert.match(schema, /^bookleaf_web_test_[a-f0-9]{16}$/);
const connectionString = process.env.TEST_DATABASE_URL;
const connection = new pg.Client({ connectionString });
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  log: [],
});
let app,
  browser,
  context,
  created = false;
try {
  await connection.connect();
  await connection.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  await connection.query(`SET search_path TO "${schema}"`);
  for (const entry of (await readdir('apps/api/prisma/migrations', { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    await connection.query(
      await readFile(`apps/api/prisma/migrations/${entry.name}/migration.sql`, 'utf8'),
    );
  }
  const raw = JSON.parse(await readFile('FULLSTACK-SAMPLEDATA (1) (1) (1).json', 'utf8'));
  const credentials = {
    DEMO_ADMIN_EMAIL: 'admin@example.test',
    DEMO_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
    DEMO_AUTHOR_PASSWORD: randomBytes(24).toString('hex'),
  };
  await seedDemoData(client, raw, credentials);
  const catalog = createCatalogService(client);
  const port = Number(process.env.BOOKLEAF_TEST_PORT ?? 3187);
  const origin = `http://127.0.0.1:${port}`;
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
      appOrigin: origin,
      production: false,
      sessionTtlSeconds: 3600,
    },
    catalog,
    tickets: createTicketService(client, catalog),
    webRoot: resolve(process.env.BOOKLEAF_TEST_WEB_ROOT ?? 'apps/web/dist'),
  });
  await app.listen({ host: '127.0.0.1', port });
  browser = process.env.BOOKLEAF_BROWSER_CDP
    ? await chromium.connectOverCDP(process.env.BOOKLEAF_BROWSER_CDP)
    : await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const login = async (authorId = 'AUTH001') => {
    const author = raw.authors.find((a) => a.author_id === authorId);
    await page.getByLabel('Email address').fill(author.email);
    await page.getByLabel('Password', { exact: true }).fill(credentials.DEMO_AUTHOR_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  };
  const check = async (name, work) => {
    await work();
    console.log(`PASS ${name}`);
  };
  await page.goto(origin);
  await check('login failure and successful real-cookie login', async () => {
    await page.getByLabel('Email address').fill(raw.authors[0].email);
    await page.getByLabel('Password', { exact: true }).fill('incorrect-test-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await login();
    await page.getByRole('heading', { name: 'My books', exact: true }).waitFor();
    assert.equal(await page.getByRole('article').count(), 2);
    assert.ok(await page.getByText('₹3,570.00', { exact: true }).count());
  });
  await check('book selection, validation, preview-only attachment, real submission', async () => {
    await page.getByRole('link', { name: 'Ask about this book' }).first().click();
    assert.equal(await page.getByLabel('Book', { exact: true }).inputValue(), 'BK001');
    await page.getByRole('button', { name: 'Send question', exact: true }).click();
    assert.equal(await page.locator('#subject').getAttribute('aria-invalid'), 'true');
    await page.getByLabel('Subject', { exact: true }).fill('Browser journey question');
    await page
      .getByLabel('Your question', { exact: true })
      .fill('Please explain this royalty snapshot.');
    await page.getByLabel('Attachments (optional preview)').setInputFiles({
      name: 'preview.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This must never be uploaded'),
    });
    await page.getByText('Files are not uploaded or sent.', { exact: true }).waitFor();
    const sent = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith('/api/v1/tickets'),
    );
    await page.getByRole('button', { name: 'Send question', exact: true }).click();
    const body = (await sent).postDataJSON();
    assert.deepEqual(Object.keys(body).sort(), ['bookId', 'description', 'subject']);
    await page.getByRole('heading', { name: 'Browser journey question', exact: true }).waitFor();
    assert.equal(await client.ticket.count({ where: { subject: 'Browser journey question' } }), 1);
  });
  await check('public reply and status arrive by polling; private note stays hidden', async () => {
    const ticket = await client.ticket.findFirstOrThrow({
      where: { subject: 'Browser journey question' },
    });
    const admin = await client.user.findUniqueOrThrow({ where: { id: 'demo-admin' } });
    const service = createTicketService(client, catalog);
    await service.note(admin, ticket.id, { body: 'PRIVATE_BROWSER_SENTINEL' });
    await service.reply(
      admin,
      ticket.id,
      { body: 'Live reply received without refreshing.', expectedRevision: 1 },
      'browser-reply',
    );
    await service.update(admin, ticket.id, { status: 'RESOLVED', expectedRevision: 2 });
    await page
      .getByText('Live reply received without refreshing.', { exact: true })
      .waitFor({ timeout: 15000 });
    assert.ok(await page.getByText('Resolved', { exact: true }).count());
    assert.equal(
      (await page.locator('body').innerText()).includes('PRIVATE_BROWSER_SENTINEL'),
      false,
    );
  });
  await check(
    'ticket list, status filter, general question and session-expiry draft recovery',
    async () => {
      await page.getByRole('link', { name: 'My questions', exact: true }).click();
      await page.getByLabel('Status', { exact: true }).selectOption('RESOLVED');
      await page.getByRole('heading', { name: 'Browser journey question', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Ask a question', exact: true }).first().click();
      await page.getByLabel('Subject', { exact: true }).fill('Keep my unsent text');
      await page.getByLabel('Your question', { exact: true }).fill('General question draft');
      await client.session.deleteMany({ where: { userId: 'demo-author-AUTH001' } });
      await page.getByRole('button', { name: 'Send question', exact: true }).click();
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
      await login();
      assert.equal(
        await page.getByLabel('Subject', { exact: true }).inputValue(),
        'Keep my unsent text',
      );
      assert.equal(
        await page.getByLabel('Your question', { exact: true }).inputValue(),
        'General question draft',
      );
      await page.getByRole('button', { name: 'Send question', exact: true }).click();
      await page.getByRole('heading', { name: 'Keep my unsent text', exact: true }).waitFor();
      assert.equal(
        (await client.ticket.findFirstOrThrow({ where: { subject: 'Keep my unsent text' } }))
          .bookId,
        null,
      );
    },
  );
  await check(
    'recoverable network error retains draft and prevents automatic duplicate sends',
    async () => {
      await page.getByRole('link', { name: 'Ask a question', exact: true }).click();
      await page.getByLabel('Subject', { exact: true }).fill('Network recovery draft');
      await page.getByLabel('Your question', { exact: true }).fill('Keep this description');
      await page.route('**/api/v1/tickets', (route) =>
        route.request().method() === 'POST' ? route.abort() : route.continue(),
      );
      await page.getByRole('button', { name: 'Send question', exact: true }).click();
      await page
        .getByRole('button', { name: 'I checked — allow another attempt', exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel('Subject', { exact: true }).inputValue(),
        'Network recovery draft',
      );
      assert.equal(
        await page.getByRole('button', { name: 'Send question', exact: true }).isDisabled(),
        true,
      );
      await page.unroute('**/api/v1/tickets');
      await page
        .getByRole('button', { name: 'I checked — allow another attempt', exact: true })
        .click();
      await page.getByRole('button', { name: 'Send question', exact: true }).click();
      await page.getByRole('heading', { name: 'Network recovery draft', exact: true }).waitFor();
    },
  );
  await check(
    'logout clears drafts and previous author data; production/null fields and mobile layout',
    async () => {
      await page.getByRole('link', { name: 'Ask a question', exact: true }).click();
      await page.getByLabel('Subject', { exact: true }).fill('Must not leak');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
      await login('AUTH007');
      assert.equal(await page.getByLabel('Subject', { exact: true }).inputValue(), '');
      await page.getByRole('link', { name: 'My books', exact: true }).click();
      await page.getByText('BK013', { exact: true }).waitFor();
      assert.ok(await page.getByText('Not available', { exact: true }).count());
      assert.ok(await page.getByText('₹0.00', { exact: true }).count());
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      await mkdir('.tmp/m07-evidence', { recursive: true });
      await page.screenshot({ path: '.tmp/m07-evidence/books-mobile.png', fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: '.tmp/m07-evidence/books-desktop.png', fullPage: true });
      await page.getByRole('link', { name: 'My questions', exact: true }).click();
      await page.getByRole('heading', { name: 'No questions here yet', exact: true }).waitFor();
      assert.equal(
        (await page.locator('body').innerText()).includes('Browser journey question'),
        false,
      );
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
    },
  );
  assert.deepEqual(pageErrors, []);
  console.log(
    'All author browser checks passed against real PostgreSQL/API; no application mocks.',
  );
} finally {
  await context?.close();
  await browser?.close();
  await app?.close();
  await client.$disconnect();
  if (created) await connection.query(`DROP SCHEMA "${schema}" CASCADE`);
  await connection.end();
}
