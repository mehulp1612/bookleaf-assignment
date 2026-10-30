import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../apps/api/dist/app.js';
import { createDatabase } from '../apps/api/dist/infrastructure/database.js';
import { loadEnvironment } from '../apps/api/dist/infrastructure/config.js';

// Requires a completed build and a reachable PostgreSQL database. Does not mutate data.
const environment = loadEnvironment();
const app = await buildApp({
  database: createDatabase(environment.DATABASE_URL),
  webRoot: fileURLToPath(new URL('../apps/web/dist', import.meta.url)),
  logLevel: 'silent',
});
try {
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  for (const path of ['/health/live', '/health/ready']) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, `${path} must be healthy`);
    assert.deepEqual(await response.json(), { data: { status: 'ok' } });
  }
  const page = await fetch(base, { headers: { accept: 'text/html' } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /BookLeaf Author Support/);
  const missing = await fetch(`${base}/api/v1/missing`, { headers: { accept: 'text/html' } });
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type') ?? '', /application\/json/);
  console.log('Smoke passed: live HTTP server, PostgreSQL readiness, web HTML, and API 404.');
} finally {
  await app.close();
}
