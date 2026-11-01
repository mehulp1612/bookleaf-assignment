import type { Prisma } from '../../generated/prisma/client.js';

export type EnqueueClassification = typeof enqueueClassification;

// Caller owns the transaction. No provider call or worker is started here.
export async function enqueueClassification(
  tx: Prisma.TransactionClient,
  ticketId: string,
  contextRevision: number,
) {
  const deduplicationKey = `${ticketId}:classification:${contextRevision}`;
  return tx.aiJob.upsert({
    where: { deduplicationKey },
    create: { ticketId, contextRevision, deduplicationKey },
    update: {},
  });
}
