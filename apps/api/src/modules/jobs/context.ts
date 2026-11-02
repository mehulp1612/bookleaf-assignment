import { moneyPaiseSchema } from '@bookleaf/contracts';
import type { Prisma, Ticket } from '../../generated/prisma/client.js';
import { toBook } from '../catalog/service.js';
import type { AiContext, Task } from '../ai/types.js';

// Called only inside short transactions after locking the persisted ticket. No browser author IDs.
export async function readContext(
  tx: Prisma.TransactionClient,
  ticket: Ticket,
  task: Task,
): Promise<AiContext> {
  const base: AiContext = {
    ticketId: ticket.id,
    authorId: ticket.authorId,
    subject: ticket.subject,
    description: ticket.description,
    category: ticket.category,
    contextRevision: ticket.contextRevision,
    book: null,
    account: null,
    publicReplies: [],
  };
  if (task === 'CLASSIFICATION') return base;
  // Lock catalog snapshots during the read and during final freshness checks, never during AI calls.
  await tx.$queryRaw`SELECT id FROM "Book" WHERE "authorId" = ${ticket.authorId} ORDER BY id FOR SHARE`;
  if (ticket.bookId) {
    const book = await tx.book.findFirst({
      where: { id: ticket.bookId, authorId: ticket.authorId },
    });
    if (!book) throw new Error('Ticket book ownership mismatch.');
    base.book = toBook(book);
  } else {
    const totals = await tx.book.aggregate({
      where: { authorId: ticket.authorId },
      _count: { _all: true },
      _sum: { totalRoyaltyEarnedPaise: true, royaltyPaidPaise: true, royaltyPendingPaise: true },
    });
    base.account = {
      authorId: ticket.authorId,
      bookCount: totals._count._all,
      totalRoyaltyEarnedPaise: moneyPaiseSchema.parse(
        Number(totals._sum.totalRoyaltyEarnedPaise ?? 0n),
      ),
      royaltyPaidPaise: moneyPaiseSchema.parse(Number(totals._sum.royaltyPaidPaise ?? 0n)),
      royaltyPendingPaise: moneyPaiseSchema.parse(Number(totals._sum.royaltyPendingPaise ?? 0n)),
    };
  }
  base.publicReplies = (
    await tx.ticketReply.findMany({
      where: { ticketId: ticket.id },
      select: { body: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    })
  ).reverse();
  return base;
}
