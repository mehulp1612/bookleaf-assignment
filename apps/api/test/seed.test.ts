import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  prepareIdentitySeed,
  seedAuthorsSchema,
  seedCredentialsSchema,
} from '../src/modules/auth/seed.js';
import { verifyPassword } from '../src/modules/auth/passwords.js';

test('seed preparation preserves distinct salts and valid passwords for each identity', async () => {
  const authorPassword = 'test-only-author-password';
  const adminPassword = 'test-only-admin-password';
  const prepared = await prepareIdentitySeed(
    {
      authors: [
        { author_id: 'A1', name: 'First', email: 'first@example.test' },
        { author_id: 'A2', name: 'Second', email: 'second@example.test' },
      ],
    },
    {
      DEMO_ADMIN_EMAIL: 'admin@example.test',
      DEMO_ADMIN_PASSWORD: adminPassword,
      DEMO_AUTHOR_PASSWORD: authorPassword,
    },
  );
  assert.equal(prepared.users.length, 3);
  assert.equal(new Set(prepared.users.map((user) => user.passwordHash)).size, 3);
  for (const user of prepared.users) {
    assert.equal(
      await verifyPassword(
        user.role === 'ADMIN' ? adminPassword : authorPassword,
        user.passwordHash,
      ),
      true,
    );
    assert.equal(user.authorId === null, user.role === 'ADMIN');
  }
});

test('demo seed requires explicit strong distinct passwords and rejects invalid reset flags', () => {
  const valid = {
    DEMO_ADMIN_EMAIL: ' ADMIN@EXAMPLE.TEST ',
    DEMO_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
    DEMO_AUTHOR_PASSWORD: randomBytes(24).toString('hex'),
  };
  assert.equal(seedCredentialsSchema.safeParse({}).success, false);
  assert.equal(seedCredentialsSchema.parse(valid).DEMO_ADMIN_EMAIL, 'admin@example.test');
  assert.equal(seedCredentialsSchema.parse(valid).DEMO_RESET_PASSWORDS, 'false');
  assert.equal(
    seedCredentialsSchema.safeParse({ ...valid, DEMO_ADMIN_PASSWORD: 'short' }).success,
    false,
  );
  assert.equal(
    seedCredentialsSchema.safeParse({ ...valid, DEMO_AUTHOR_PASSWORD: valid.DEMO_ADMIN_PASSWORD })
      .success,
    false,
  );
  assert.equal(
    seedCredentialsSchema.safeParse({ ...valid, DEMO_RESET_PASSWORDS: 'yes' }).success,
    false,
  );
});

test('identity seed ignores book data but rejects duplicate normalized emails or IDs', () => {
  const author = {
    author_id: 'AUTH001',
    name: 'Demo author',
    email: 'author@example.test',
    books: [{ book_id: 'BK001' }],
  };
  assert.equal('books' in seedAuthorsSchema.parse({ authors: [author] }).authors[0]!, false);
  assert.equal(seedAuthorsSchema.safeParse({ authors: [author, author] }).success, false);
  assert.equal(
    seedAuthorsSchema.safeParse({
      authors: [author, { ...author, author_id: 'AUTH002', email: ' AUTHOR@EXAMPLE.TEST ' }],
    }).success,
    false,
  );
});
