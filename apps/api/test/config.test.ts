import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvironment } from '../src/infrastructure/config.js';

test('configuration requires PostgreSQL and rejects invalid ports and production origins', () => {
  assert.throws(() => parseEnvironment({}), /DATABASE_URL/);
  assert.throws(
    () => parseEnvironment({ DATABASE_URL: 'https://example.test/db' }),
    /DATABASE_URL/,
  );
  assert.throws(
    () => parseEnvironment({ DATABASE_URL: 'postgresql://localhost/bookleaf', PORT: '70000' }),
    /PORT/,
  );
  assert.throws(
    () =>
      parseEnvironment({ DATABASE_URL: 'postgresql://localhost/bookleaf', NODE_ENV: 'production' }),
    /APP_ORIGIN/,
  );
  assert.equal(parseEnvironment({ DATABASE_URL: 'postgresql://localhost/bookleaf' }).PORT, 3000);
});

test('invalid configuration reports field names without revealing values', () => {
  assert.throws(
    () =>
      parseEnvironment({
        DATABASE_URL: 'postgresql://localhost/bookleaf',
        APP_ORIGIN: 'private-invalid-origin',
      }),
    /APP_ORIGIN/,
  );
  assert.throws(
    () => parseEnvironment({ DATABASE_URL: 'private-invalid-value' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /DATABASE_URL/);
      assert.equal(error.message.includes('private-invalid-value'), false);
      return true;
    },
  );
});
