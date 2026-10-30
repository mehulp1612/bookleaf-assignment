import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  authorTicketDetailSchema,
  adminTicketQuerySchema,
  authorTicketQuerySchema,
  bookSchema,
  createTicketRequestSchema,
  updateTicketRequestSchema,
  classificationResultSchema,
  aiDraftSchema,
  paginationSchema,
  loginRequestSchema,
} from '../src/index.js';
import {
  adminTicketFixture,
  authorTicketFixture,
  publishedBookFixture,
  productionBookFixture,
  pendingDraftFixture,
  failedDraftFixture,
} from '../src/fixtures.js';

test('author projection removes all admin-only fields, including nested notes', () => {
  assert.deepEqual(authorTicketDetailSchema.parse(adminTicketFixture), authorTicketFixture);
});

test('book fixtures preserve sample values, nulls, placeholders, and exact paise', () => {
  const sample = JSON.parse(
    readFileSync(
      new URL('../../../FULLSTACK-SAMPLEDATA (1) (1) (1).json', import.meta.url),
      'utf8',
    ),
  );
  for (const fixture of [publishedBookFixture, productionBookFixture]) {
    const author = sample.authors.find(
      (entry: { author_id: string }) => entry.author_id === fixture.authorId,
    );
    const original = author.books.find(
      (entry: { book_id: string }) => entry.book_id === fixture.id,
    );
    assert.equal(fixture.isbn, original.isbn);
    assert.equal(fixture.publicationDate, original.publication_date);
    assert.equal(fixture.mrpPaise, original.mrp === null ? null : original.mrp * 100);
    assert.equal(fixture.royaltyPendingPaise, original.royalty_pending * 100);
  }
  assert.equal(productionBookFixture.mrpPaise, null);
  assert.equal(productionBookFixture.totalRoyaltyEarnedPaise, 0);
  assert.equal(bookSchema.safeParse({ ...publishedBookFixture, mrpPaise: 1.5 }).success, false);
});

test('requests reject impersonation fields, whitespace-only text, and over-limit input', () => {
  const valid = { bookId: null, subject: ' Question ', description: ' Details ' };
  assert.equal(createTicketRequestSchema.parse(valid).subject, 'Question');
  assert.equal(
    createTicketRequestSchema.safeParse({ ...valid, authorId: 'AUTH002' }).success,
    false,
  );
  assert.equal(createTicketRequestSchema.safeParse({ ...valid, subject: '   ' }).success, false);
  assert.equal(
    createTicketRequestSchema.safeParse({ ...valid, description: 'x'.repeat(10001) }).success,
    false,
  );
  assert.equal(updateTicketRequestSchema.safeParse({ expectedRevision: 0 }).success, false);
});

test('filters validate bounds, real dates, order, and author field restrictions', () => {
  assert.deepEqual(paginationSchema.parse({}), { page: 1, pageSize: 20 });
  assert.equal(paginationSchema.safeParse({ pageSize: '101' }).success, false);
  assert.equal(adminTicketQuerySchema.parse({ page: '2' }).page, 2);
  assert.equal(adminTicketQuerySchema.safeParse({ createdFrom: '2025-02-29' }).success, false);
  assert.equal(
    adminTicketQuerySchema.safeParse({ createdFrom: '2026-10-30', createdTo: '2026-10-01' })
      .success,
    false,
  );
  assert.equal(authorTicketQuerySchema.safeParse({ priority: 'HIGH' }).success, false);
});

test('AI results reject unsupported categories and impossible success states', () => {
  assert.equal(
    classificationResultSchema.safeParse({ category: 'OTHER', priority: 'HIGH', rationale: 'Test' })
      .success,
    false,
  );
  assert.equal(
    aiDraftSchema.safeParse({ ...pendingDraftFixture, state: 'SUCCEEDED' }).success,
    false,
  );
  assert.equal(aiDraftSchema.parse(failedDraftFixture).state, 'FAILED');
});

test('email normalization preserves password bytes', () => {
  const result = loginRequestSchema.parse({
    email: '  AUTHOR@EXAMPLE.TEST  ',
    password: ' secret ',
  });
  assert.equal(result.email, 'author@example.test');
  assert.equal(result.password, ' secret ');
});
