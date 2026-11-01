import { createHash } from 'node:crypto';
import {
  adminTicketQuerySchema,
  authorTicketQuerySchema,
  allowedStatusTransitions,
  classificationResultSchema,
  createNoteRequestSchema,
  createReplyRequestSchema,
  createTicketRequestSchema,
  createdTicketSchema,
  currentUserSchema,
  idSchema,
  idempotencyKeySchema,
  updateTicketRequestSchema,
  type CurrentUser,
} from '@bookleaf/contracts';
import { Prisma, type PrismaClient, type Ticket } from '../../generated/prisma/client.js';
import { HttpError } from '../../infrastructure/errors.js';
import type { CatalogService } from '../catalog/service.js';
import { enqueueClassification, type EnqueueClassification } from '../jobs/enqueue.js';
import {
  detailDto,
  detailInclude,
  noteDto,
  replyDto,
  summaryDto,
  summaryInclude,
} from './projections.js';

const missing = () => new HttpError(404, 'NOT_FOUND', 'Ticket not found.');
const conflict = () =>
  new HttpError(
    409,
    'CONFLICT',
    'The ticket changed or the action is no longer valid. Reload the ticket before trying again.',
  );
function principal(value: CurrentUser | null, role?: 'AUTHOR' | 'ADMIN') {
  if (!value) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  const user = currentUserSchema.parse(value);
  if (role && user.role !== role)
    throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this action.');
  return user;
}
async function lock(tx: Prisma.TransactionClient, id: string) {
  idSchema.parse(id);
  const rows = await tx.$queryRaw<Ticket[]>`SELECT * FROM "Ticket" WHERE id = ${id} FOR UPDATE`;
  if (!rows[0]) throw missing();
  return rows[0];
}
function revision(ticket: Ticket, expected: number) {
  if (ticket.revision !== expected) throw conflict();
}
async function event(
  tx: Prisma.TransactionClient,
  ticketId: string,
  actorId: string | null,
  type: Prisma.TicketEventCreateInput['type'],
  oldValue: string | null,
  newValue: string | null,
  now: Date,
) {
  await tx.ticketEvent.create({
    data: { ticketId, actorId, type, oldValue, newValue, createdAt: now },
  });
}

export function createTicketService(
  client: PrismaClient,
  catalog: CatalogService,
  options: {
    enqueue?: EnqueueClassification;
    clock?: () => Date;
  } = {},
) {
  const enqueue = options.enqueue ?? enqueueClassification;
  const clock = options.clock ?? (() => new Date());
  const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
    client.$transaction(work, { timeout: 15000 });
  return {
    async create(value: CurrentUser | null, raw: unknown) {
      const user = principal(value, 'AUTHOR');
      const input = createTicketRequestSchema.parse(raw);
      if (input.bookId) await catalog.assertBookOwnership(user, user.authorId!, input.bookId);
      return transaction(async (tx) => {
        // Recheck ownership while locking the selected book against concurrent import/update.
        if (input.bookId) {
          const books = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "Book" WHERE id = ${input.bookId} AND "authorId" = ${user.authorId} FOR SHARE`;
          if (!books.length) throw new HttpError(404, 'NOT_FOUND', 'Book not found.');
        }
        const now = clock();
        const row = await tx.ticket.create({
          data: { ...input, authorId: user.authorId!, createdAt: now, updatedAt: now },
        });
        const job = await enqueue(tx, row.id, row.classificationRevision);
        const saved = await tx.ticket.update({
          where: { id: row.id },
          data: { classificationJobId: job.id },
          include: detailInclude,
        });
        return createdTicketSchema.parse({
          ...detailDto(saved, user),
          classificationState: saved.classificationState,
        });
      });
    },
    async detail(value: CurrentUser | null, id: string) {
      const user = principal(value);
      idSchema.parse(id);
      const row = await client.ticket.findFirst({
        where: { id, ...(user.role === 'AUTHOR' ? { authorId: user.authorId! } : {}) },
        include: detailInclude,
      });
      if (!row) throw missing();
      return detailDto(row, user);
    },
    async list(value: CurrentUser | null, raw: unknown) {
      const user = principal(value);
      const query =
        user.role === 'ADMIN'
          ? adminTicketQuerySchema.parse(raw)
          : authorTicketQuerySchema.parse(raw);
      const offset = (query.page - 1) * query.pageSize;
      if (!Number.isSafeInteger(offset) || offset > 2147483647)
        throw new HttpError(400, 'VALIDATION_ERROR', 'Page offset is too large.');
      const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
      if (user.role === 'AUTHOR') conditions.push(Prisma.sql`"authorId" = ${user.authorId}`);
      if (query.status) conditions.push(Prisma.sql`status::text = ${query.status}`);
      if ('category' in query && query.category)
        conditions.push(Prisma.sql`category::text = ${query.category}`);
      if ('priority' in query && query.priority)
        conditions.push(Prisma.sql`priority::text = ${query.priority}`);
      if (query.createdFrom)
        conditions.push(
          Prisma.sql`"createdAt" >= ${new Date(query.createdFrom + 'T00:00:00.000Z')}`,
        );
      if (query.createdTo) {
        const end = new Date(query.createdTo + 'T00:00:00.000Z');
        end.setUTCDate(end.getUTCDate() + 1);
        conditions.push(Prisma.sql`"createdAt" < ${end}`);
      }
      const where = Prisma.join(conditions, ' AND ');
      const order =
        query.sort === 'queue'
          ? Prisma.sql`CASE WHEN status IN ('OPEN','IN_PROGRESS') THEN 0 ELSE 1 END ASC, priority ASC, "createdAt" ASC, id ASC`
          : query.sort === 'oldest'
            ? Prisma.sql`"createdAt" ASC, id ASC`
            : Prisma.sql`"createdAt" DESC, id ASC`;
      return client.$transaction(
        async (tx) => {
          const ids = await tx.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT id FROM "Ticket" WHERE ${where} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${offset}`,
          );
          const counts = await tx.$queryRaw<{ total: bigint }[]>(
            Prisma.sql`SELECT count(*) AS total FROM "Ticket" WHERE ${where}`,
          );
          const rows = await tx.ticket.findMany({
            where: { id: { in: ids.map((r) => r.id) } },
            include: summaryInclude,
          });
          const byId = new Map(rows.map((row) => [row.id, row]));
          return {
            data: ids.map(({ id }) => summaryDto(byId.get(id)!, user)),
            meta: { page: query.page, pageSize: query.pageSize, total: Number(counts[0]!.total) },
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
    async update(value: CurrentUser | null, id: string, raw: unknown) {
      const user = principal(value, 'ADMIN');
      const input = updateTicketRequestSchema.parse(raw);
      return transaction(async (tx) => {
        const row = await lock(tx, id);
        revision(row, input.expectedRevision);
        const now = clock();
        const data: Prisma.TicketUncheckedUpdateInput = {
          revision: { increment: 1 },
          updatedAt: now,
        };
        if (input.status !== undefined && input.status !== row.status) {
          if (!allowedStatusTransitions[row.status].includes(input.status)) throw conflict();
          data.status = input.status;
          await event(tx, id, user.id, 'STATUS_CHANGED', row.status, input.status, now);
        }
        if (input.category !== undefined) {
          data.category = input.category;
          data.categorySource = 'MANUAL';
          data.categoryOverridden = true;
          if (row.category !== input.category) data.contextRevision = { increment: 1 };
          if (row.category !== input.category || !row.categoryOverridden)
            await event(tx, id, user.id, 'CATEGORY_CHANGED', row.category, input.category, now);
        }
        if (input.priority !== undefined) {
          data.priority = input.priority;
          data.prioritySource = 'MANUAL';
          data.priorityOverridden = true;
          if (row.priority !== input.priority || !row.priorityOverridden)
            await event(tx, id, user.id, 'PRIORITY_CHANGED', row.priority, input.priority, now);
        }
        if (input.assignmentAction !== undefined) {
          const assigneeId = input.assignmentAction === 'SELF' ? user.id : null;
          data.assigneeId = assigneeId;
          if (row.assigneeId !== assigneeId)
            await event(tx, id, user.id, 'ASSIGNMENT_CHANGED', row.assigneeId, assigneeId, now);
        }
        const saved = await tx.ticket.update({ where: { id }, data, include: detailInclude });
        return detailDto(saved, user);
      });
    },
    async reply(value: CurrentUser | null, id: string, raw: unknown, rawKey: unknown) {
      const user = principal(value, 'ADMIN');
      const input = createReplyRequestSchema.parse(raw);
      const key = idempotencyKeySchema.parse(rawKey);
      const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      return transaction(async (tx) => {
        const row = await lock(tx, id);
        const previous = await tx.ticketReply.findUnique({
          where: {
            ticketId_senderId_idempotencyKey: {
              ticketId: id,
              senderId: user.id,
              idempotencyKey: key,
            },
          },
          include: { sender: { select: { displayName: true } } },
        });
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw new HttpError(
              409,
              'CONFLICT',
              'This idempotency key was already used for a different request.',
            );
          return replyDto(previous);
        }
        revision(row, input.expectedRevision);
        if (row.status === 'CLOSED') throw conflict();
        const now = clock();
        const saved = await tx.ticketReply.create({
          data: {
            ticketId: id,
            senderId: user.id,
            body: input.body,
            idempotencyKey: key,
            requestHash,
            createdAt: now,
          },
          include: { sender: { select: { displayName: true } } },
        });
        await tx.ticket.update({
          where: { id },
          data: { revision: { increment: 1 }, contextRevision: { increment: 1 }, updatedAt: now },
        });
        return replyDto(saved);
      });
    },
    async note(value: CurrentUser | null, id: string, raw: unknown) {
      const user = principal(value, 'ADMIN');
      const input = createNoteRequestSchema.parse(raw);
      return transaction(async (tx) => {
        await lock(tx, id);
        const now = clock();
        const saved = await tx.ticketNote.create({
          data: { ticketId: id, creatorId: user.id, body: input.body, createdAt: now },
          include: { creator: { select: { id: true, displayName: true } } },
        });
        await tx.ticket.update({
          where: { id },
          data: { revision: { increment: 1 }, updatedAt: now },
        });
        return noteDto(saved);
      });
    },
    // Internal M06 boundary: caller passes a claimed job's lease, never browser input.
    // Ticket and job completion commit atomically, with no provider call in this transaction.
    async applyClassification(jobId: string, leaseToken: string, raw: unknown) {
      idSchema.parse(jobId);
      idSchema.parse(leaseToken);
      const result = classificationResultSchema.parse(raw);
      return transaction(async (tx) => {
        const found = await tx.aiJob.findUnique({ where: { id: jobId } });
        if (!found) throw new HttpError(404, 'NOT_FOUND', 'Classification job not found.');
        const row = await lock(tx, found.ticketId);
        const jobs = await tx.$queryRaw<
          (typeof found)[]
        >`SELECT * FROM "AiJob" WHERE id = ${jobId} FOR UPDATE`;
        const job = jobs[0];
        const now = clock();
        if (
          !job ||
          job.task !== 'CLASSIFICATION' ||
          row.classificationJobId !== job.id ||
          row.classificationRevision !== job.contextRevision ||
          job.state !== 'RUNNING' ||
          job.leaseToken !== leaseToken ||
          !job.leaseExpiresAt ||
          job.leaseExpiresAt <= now
        )
          throw conflict();
        const data: Prisma.TicketUncheckedUpdateInput = {
          suggestedCategory: result.category,
          suggestedPriority: result.priority,
          classificationRationale: result.rationale,
          classificationState: 'SUCCEEDED',
          revision: { increment: 1 },
          updatedAt: now,
        };
        if (!row.categoryOverridden) {
          data.category = result.category;
          data.categorySource = 'AI';
          if (row.category !== result.category) {
            data.contextRevision = { increment: 1 };
            await event(tx, row.id, null, 'CATEGORY_CHANGED', row.category, result.category, now);
          }
        }
        if (!row.priorityOverridden) {
          data.priority = result.priority;
          data.prioritySource = 'AI';
          if (row.priority !== result.priority)
            await event(tx, row.id, null, 'PRIORITY_CHANGED', row.priority, result.priority, now);
        }
        await tx.ticket.update({ where: { id: row.id }, data });
        await tx.aiJob.update({
          where: { id: jobId },
          data: {
            state: 'SUCCEEDED',
            completedAt: now,
            leaseToken: null,
            leaseExpiresAt: null,
            failureReason: null,
          },
        });
        return { ticketId: row.id, state: 'SUCCEEDED' as const };
      });
    },
  };
}
export type TicketService = ReturnType<typeof createTicketService>;
