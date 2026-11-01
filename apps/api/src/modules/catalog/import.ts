import { z } from 'zod';
import { dateSchema, idSchema } from '@bookleaf/contracts';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

// Decimal parsing avoids floating-point multiplication/rounding (e.g. 0.29 * 100).
export function rupeesToPaise(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid monetary value.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Money must have at most two decimal places.');
  const paise = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (paise > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Monetary value exceeds the API range.');
  return Number(paise);
}

const money = z.number().transform((value, ctx) => {
  try {
    return rupeesToPaise(value);
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'Expected nonnegative rupees with at most two decimal places in the safe range.',
    });
    return z.NEVER;
  }
});
const text = z.string().min(1);
const sourceBookSchema = z.object({
  book_id: idSchema,
  title: text,
  isbn: text,
  genre: text,
  publication_date: dateSchema.nullable(),
  status: text,
  mrp: money.nullable(),
  author_royalty_per_copy: money.nullable(),
  total_copies_sold: z.number().int().min(0).max(2147483647),
  total_royalty_earned: money,
  royalty_paid: money,
  royalty_pending: money,
  last_royalty_payout_date: dateSchema.nullable(),
  print_partner: text.nullable(),
  available_on: z.array(text),
});
export const catalogImportSchema = z
  .object({
    authors: z
      .array(
        z.object({
          author_id: idSchema,
          name: text,
          email: z.email(),
          phone: text,
          city: text,
          joined_date: dateSchema,
          books: z.array(sourceBookSchema),
        }),
      )
      .min(1),
  })
  .superRefine(({ authors }, ctx) => {
    const authorIds = authors.map((author) => author.author_id);
    const emails = authors.map((author) => author.email.toLowerCase());
    const bookIds = authors.flatMap((author) => author.books.map((book) => book.book_id));
    for (const values of [authorIds, emails, bookIds]) {
      if (new Set(values).size !== values.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Duplicate author ID, author email, or book ID in import.',
        });
      }
    }
  });
export type CatalogImport = z.infer<typeof catalogImportSchema>;
const dateValue = (value: string | null) =>
  value === null ? null : new Date(`${value}T00:00:00.000Z`);
const bigintValue = (value: number | null) => (value === null ? null : BigInt(value));

export async function writeCatalog(tx: Prisma.TransactionClient, input: CatalogImport) {
  for (const author of input.authors) {
    const profile = {
      name: author.name,
      email: author.email,
      phone: author.phone,
      city: author.city,
      joinedDate: dateValue(author.joined_date),
    };
    await tx.author.upsert({
      where: { id: author.author_id },
      create: { id: author.author_id, ...profile },
      update: profile,
    });
    for (const book of author.books) {
      const existing = await tx.book.findUnique({
        where: { id: book.book_id },
        select: { authorId: true },
      });
      if (existing && existing.authorId !== author.author_id) {
        throw new Error('Import cannot transfer an existing book to another author.');
      }
      const values = {
        authorId: author.author_id,
        title: book.title,
        isbn: book.isbn,
        genre: book.genre,
        publicationDate: dateValue(book.publication_date),
        status: book.status,
        mrpPaise: bigintValue(book.mrp),
        authorRoyaltyPerCopyPaise: bigintValue(book.author_royalty_per_copy),
        totalCopiesSold: book.total_copies_sold,
        totalRoyaltyEarnedPaise: BigInt(book.total_royalty_earned),
        royaltyPaidPaise: BigInt(book.royalty_paid),
        royaltyPendingPaise: BigInt(book.royalty_pending),
        lastRoyaltyPayoutDate: dateValue(book.last_royalty_payout_date),
        printPartner: book.print_partner,
        availableOn: book.available_on,
      };
      await tx.book.upsert({
        where: { id: book.book_id },
        create: { id: book.book_id, ...values },
        update: values,
      });
    }
  }
  return {
    authors: input.authors.length,
    books: input.authors.reduce((sum, author) => sum + author.books.length, 0),
  };
}

export async function importCatalog(client: PrismaClient, raw: unknown) {
  const input = catalogImportSchema.parse(raw);
  return client.$transaction((tx) => writeCatalog(tx, input), {
    isolationLevel: 'Serializable',
    timeout: 15000,
  });
}
