import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorResponseSchema, createTicketRequestSchema } from '@bookleaf/contracts';
import { buildApp } from '../src/app.js';

test('liveness is independent of readiness and readiness hides database details', async () => {
  let closed = false;
  const app = await buildApp({
    logLevel: 'silent',
    database: {
      check: async () => {
        throw new Error('private database connection string');
      },
      close: async () => {
        closed = true;
      },
    },
  });
  try {
    assert.equal((await app.inject('/health/live')).statusCode, 200);
    const response = await app.inject('/health/ready');
    assert.equal(response.statusCode, 503);
    assert.equal(errorResponseSchema.parse(response.json()).error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(response.body.includes('private database'), false);
    assert.equal(response.headers['cache-control'], 'no-store');
  } finally {
    await app.close();
  }
  assert.equal(closed, true);
});

test('ready database returns health shape and request IDs are server generated', async () => {
  const app = await buildApp({
    logLevel: 'silent',
    database: { check: async () => {}, close: async () => {} },
  });
  try {
    const response = await app.inject({
      url: '/health/ready',
      headers: { 'x-request-id': 'untrusted' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { data: { status: 'ok' } });
    assert.notEqual(response.headers['x-request-id'], 'untrusted');
  } finally {
    await app.close();
  }
});

test('validation, malformed JSON, and unknown exceptions have safe error envelopes', async () => {
  const app = await buildApp({
    logLevel: 'silent',
    database: { check: async () => {}, close: async () => {} },
  });
  app.post('/test/validation', async (request) => createTicketRequestSchema.parse(request.body));
  app.get('/test/failure', async () => {
    throw new Error('secret-provider-token');
  });
  try {
    const validation = await app.inject({
      method: 'POST',
      url: '/test/validation',
      payload: { bookId: null, subject: ' ', description: 'Text' },
    });
    assert.equal(validation.statusCode, 400);
    assert.ok(errorResponseSchema.parse(validation.json()).error.fieldErrors?.subject);
    const malformed = await app.inject({
      method: 'POST',
      url: '/test/validation',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    assert.equal(malformed.statusCode, 400);
    errorResponseSchema.parse(malformed.json());
    const failure = await app.inject('/test/failure');
    assert.equal(failure.statusCode, 500);
    assert.equal(failure.body.includes('secret-provider-token'), false);
    assert.equal(errorResponseSchema.parse(failure.json()).error.code, 'INTERNAL_ERROR');
  } finally {
    await app.close();
  }
});

test('production serves SPA routes, but never turns missing API or asset requests into HTML', async () => {
  const webRoot = await mkdtemp(join(tmpdir(), 'bookleaf-web-'));
  await mkdir(join(webRoot, 'assets'));
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>BookLeaf test</title>');
  await writeFile(join(webRoot, 'assets', 'app-test.js'), 'console.log("fixture");');
  const app = await buildApp({
    webRoot,
    logLevel: 'silent',
    database: { check: async () => {}, close: async () => {} },
  });
  try {
    const navigation = await app.inject({ url: '/author/books', headers: { accept: 'text/html' } });
    assert.equal(navigation.statusCode, 200);
    assert.match(navigation.body, /BookLeaf test/);
    for (const url of ['/api/v1/missing', '/health/missing', '/assets/missing.js']) {
      const response = await app.inject({ url, headers: { accept: 'text/html' } });
      assert.equal(response.statusCode, 404);
      errorResponseSchema.parse(response.json());
    }
    assert.equal((await app.inject('/assets/app-test.js')).statusCode, 200);
  } finally {
    await app.close();
    await rm(webRoot, { recursive: true, force: true });
  }
});
