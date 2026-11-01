import {
  bookListQuerySchema,
  bookSchema,
  currentUserSchema,
  idSchema,
  listResponseSchema,
  moneyPaiseSchema,
  type CurrentUser,
} from '@bookleaf/contracts';
import type { Book as StoredBook, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../infrastructure/errors.js';

export function toBook(book: StoredBook) {
  return bookSchema.parse({
    ...book,
    publicationDate: book.publicationDate?.toISOString().slice(0, 10) ?? null,
    lastRoyaltyPayoutDate: book.lastRoyaltyPayoutDate?.toISOString().slice(0, 10) ?? null,
    mrpPaise: book.mrpPaise === null ? null : Number(book.mrpPaise),
    authorRoyaltyPerCopyPaise:
      book.authorRoyaltyPerCopyPaise === null ? null : Number(book.authorRoyaltyPerCopyPaise),
    totalRoyaltyEarnedPaise: Number(book.totalRoyaltyEarnedPaise),
    royaltyPaidPaise: Number(book.royaltyPaidPaise),
    royaltyPendingPaise: Number(book.royaltyPendingPaise),
  });
}

function principal(value: CurrentUser | null) {
  if (!value) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  return currentUserSchema.parse(value);
}
const missingBook = () => new HttpError(404, 'NOT_FOUND', 'Book not found.');

export function createCatalogService(client: PrismaClient) {
  async function ownedBook(user: CurrentUser | null, authorId: string, bookId: string) {
    const viewer = principal(user);
    idSchema.parse(authorId);
    idSchema.parse(bookId);
    if (viewer.role === 'AUTHOR' && viewer.authorId !== authorId) throw missingBook();
    const book = await client.book.findFirst({ where: { id: bookId, authorId } });
    if (!book) throw missingBook();
    return toBook(book);
  }
  return {
    async listBooks(user: CurrentUser | null, query: unknown) {
      const viewer = principal(user);
      const input = bookListQuerySchema.parse(query);
      if (viewer.role === 'AUTHOR' && input.authorId && input.authorId !== viewer.authorId) {
        throw new HttpError(403, 'FORBIDDEN', 'You may only list your own books.');
      }
      const authorId = viewer.role === 'AUTHOR' ? viewer.authorId! : input.authorId;
      const where = authorId ? { authorId } : {};
      const offset = (input.page - 1) * input.pageSize;
      if (!Number.isSafeInteger(offset) || offset > 2147483647) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Page offset is too large.');
      }
      const [rows, total] = await client.$transaction(
        [
          client.book.findMany({
            where,
            orderBy: { id: 'asc' },
            skip: offset,
            take: input.pageSize,
          }),
          client.book.count({ where }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return listResponseSchema(bookSchema).parse({
        data: rows.map(toBook),
        meta: { page: input.page, pageSize: input.pageSize, total },
      });
    },
    async getBook(user: CurrentUser | null, bookId: string) {
      const viewer = principal(user);
      idSchema.parse(bookId);
      const book = await client.book.findFirst({
        where: {
          id: bookId,
          ...(viewer.role === 'AUTHOR' ? { authorId: viewer.authorId! } : {}),
        },
      });
      if (!book) throw missingBook();
      return toBook(book);
    },
    // M04 must pass the ticket author's ID, even when the current viewer is an admin.
    assertBookOwnership: ownedBook,
    async getBookContext(user: CurrentUser | null, authorId: string, bookId: string) {
      const book = await ownedBook(user, authorId, bookId);
      return { source: 'catalog_snapshot' as const, currency: 'INR' as const, book };
    },
    async getAccountContext(user: CurrentUser | null, authorId: string) {
      const viewer = principal(user);
      idSchema.parse(authorId);
      if (viewer.role === 'AUTHOR' && viewer.authorId !== authorId) {
        throw new HttpError(404, 'NOT_FOUND', 'Author not found.');
      }
      const author = await client.author.findUnique({
        where: { id: authorId },
        select: { id: true },
      });
      if (!author) throw new HttpError(404, 'NOT_FOUND', 'Author not found.');
      const totals = await client.book.aggregate({
        where: { authorId },
        _count: { _all: true },
        _sum: { totalRoyaltyEarnedPaise: true, royaltyPaidPaise: true, royaltyPendingPaise: true },
      });
      return {
        source: 'catalog_snapshot' as const,
        currency: 'INR' as const,
        authorId: author.id,
        bookCount: totals._count._all,
        totalRoyaltyEarnedPaise: moneyPaiseSchema.parse(
          Number(totals._sum.totalRoyaltyEarnedPaise ?? 0n),
        ),
        royaltyPaidPaise: moneyPaiseSchema.parse(Number(totals._sum.royaltyPaidPaise ?? 0n)),
        royaltyPendingPaise: moneyPaiseSchema.parse(Number(totals._sum.royaltyPendingPaise ?? 0n)),
      };
    },
  };
}
export type CatalogService = ReturnType<typeof createCatalogService>;
