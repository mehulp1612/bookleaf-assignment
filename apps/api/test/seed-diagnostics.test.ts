import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvironment } from '../src/infrastructure/config.js';
import { seedFailureMessage, validateSeedCredentials } from '../src/seed-diagnostics.js';

test('database diagnostics emit only allowlisted codes from nested errors', () => {
  const message = seedFailureMessage('database connection', {
    code: 'secret-code',
    message: 'secret-message',
    cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN', message: 'secret-database-url' },
  });
  assert.match(message, /SELF_SIGNED_CERT_IN_CHAIN/);
  assert.ok(!message.includes('secret'));
});

test('seed rejects missing, short and identical demo passwords before database work', () => {
  const valid = {
    DEMO_ADMIN_EMAIL: 'admin@example.test',
    DEMO_ADMIN_PASSWORD: 'test-only-admin-password',
    DEMO_AUTHOR_PASSWORD: 'test-only-author-password',
  };
  assert.doesNotThrow(() => validateSeedCredentials(valid));
  assert.throws(() => validateSeedCredentials({}));
  assert.throws(() => validateSeedCredentials({ ...valid, DEMO_ADMIN_PASSWORD: 'short' }));
  assert.throws(() =>
    validateSeedCredentials({ ...valid, DEMO_AUTHOR_PASSWORD: valid.DEMO_ADMIN_PASSWORD }),
  );
});

test('seed diagnostics identify configuration fields without exposing raw errors or values', () => {
  const secret = 'secret-that-must-not-be-logged';
  try {
    parseEnvironment({ DATABASE_URL: secret, APP_ORIGIN: secret });
    assert.fail('invalid environment should fail');
  } catch (error) {
    const message = seedFailureMessage('environment', error);
    assert.match(message, /DATABASE_URL/);
    assert.match(message, /APP_ORIGIN/);
    assert.ok(!message.includes(secret));
  }
  for (const stage of ['environment', 'credentials', 'sample data', 'database seed'] as const) {
    const message = seedFailureMessage(stage, new Error(secret));
    assert.ok(message.includes(stage));
    assert.ok(!message.includes(secret));
  }
});
