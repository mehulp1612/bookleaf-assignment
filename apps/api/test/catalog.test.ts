import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { catalogImportSchema, rupeesToPaise } from '../src/modules/catalog/import.js';
import { repositoryRoot } from './helpers/migrations.js';

const raw: unknown = JSON.parse(
  readFileSync(resolve(repositoryRoot(), 'FULLSTACK-SAMPLEDATA (1) (1) (1).json'), 'utf8'),
);

test('catalog imports the exact sample counts and preserves production nulls and placeholders', () => {
  const parsed = catalogImportSchema.parse(raw);
  assert.equal(parsed.authors.length, 10);
  const books = parsed.authors.flatMap((author) => author.books);
  assert.equal(books.length, 18);
  assert.equal(books.filter((book) => book.status === 'Published & Live').length, 16);
  for (const id of ['BK013', 'BK015']) {
    const book = books.find((value) => value.book_id === id)!;
    assert.equal(book.publication_date, null);
    assert.equal(book.mrp, null);
    assert.equal(book.author_royalty_per_copy, null);
    assert.equal(book.total_royalty_earned, 0);
    assert.equal(book.print_partner, null);
    assert.deepEqual(book.available_on, []);
  }
  const first = books.find((book) => book.book_id === 'BK001')!;
  assert.equal(first.isbn, '978-93-5XXXX-01-1');
  assert.equal(first.mrp, 39900);
  assert.equal(first.royalty_pending, 357000);
  assert.equal(first.publication_date, '2023-06-20');
});

test('rupee conversion is exact to paise and never rounds invalid precision', () => {
  for (const [rupees, paise] of [
    [0, 0],
    [0.29, 29],
    [1.01, 101],
    [399, 39900],
    [1234.56, 123456],
  ]) {
    assert.equal(rupeesToPaise(rupees!), paise);
  }
  for (const value of [-1, Infinity, NaN, 1.001, 1e-7, Number.MAX_SAFE_INTEGER])
    assert.throws(() => rupeesToPaise(value));
});

test('import rejects duplicate ownership identifiers, missing fields, invalid dates and amounts', () => {
  // Reparse the source each time because the import schema converts rupees to paise.
  const source = () => JSON.parse(JSON.stringify(raw));
  const duplicate = source();
  duplicate.authors[1].books[0].book_id = 'BK001';
  assert.equal(catalogImportSchema.safeParse(duplicate).success, false);
  const wrongDate = source();
  wrongDate.authors[0].books[0].publication_date = '2023-02-30';
  assert.equal(catalogImportSchema.safeParse(wrongDate).success, false);
  const missing = source();
  delete missing.authors[0].phone;
  assert.equal(catalogImportSchema.safeParse(missing).success, false);
  const precision = source();
  precision.authors[0].books[0].mrp = 12.345;
  assert.equal(catalogImportSchema.safeParse(precision).success, false);
});
