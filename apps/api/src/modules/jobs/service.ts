import { randomUUID } from 'node:crypto';
import {
  aiDraftSchema,
  currentUserSchema,
  draftRequestSchema,
  idSchema,
  type CurrentUser,
} from '@bookleaf/contracts';
import {
  Prisma,
  type PrismaClient,
  type AiJob,
  type Ticket,
  type AiProviderState,
} from '../../generated/prisma/client.js';
import { HttpError } from '../../infrastructure/errors.js';
import type { createAiService } from '../ai/service.js';
import { classificationSchema, draftSchema } from '../ai/types.js';
import { AiFailure, failureMessages, type FailureCode } from '../ai/failures.js';
import type { TicketService } from '../tickets/service.js';
import { enqueueClassification } from './enqueue.js';
import { readContext } from './context.js';
import { retryDelay, type JobConfig } from './config.js';

type AiService = ReturnType<typeof createAiService>;
type Claim = { job: AiJob; blocked: AiFailure | null };
const active = ['QUEUED', 'RUNNING'] as const;
const STALE = 'Ticket context changed. Request a new AI suggestion.';
const EXHAUSTED = 'AI attempt limit reached. Retry explicitly after reviewing the configuration.';
const missing = () => new HttpError(404, 'NOT_FOUND', 'Ticket not found.');
function admin(value: CurrentUser | null) {
  if (!value) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  if (currentUserSchema.parse(value).role !== 'ADMIN')
    throw new HttpError(403, 'FORBIDDEN', 'Administrator access required.');
}
export async function lockTicket(tx: Prisma.TransactionClient, id: string) {
  idSchema.parse(id);
  const rows = await tx.$queryRaw<Ticket[]>`SELECT * FROM "Ticket" WHERE id=${id} FOR UPDATE`;
  if (!rows[0]) throw missing();
  return rows[0];
}
const current = (ticket: Ticket, job: AiJob) =>
  job.task === 'CLASSIFICATION'
    ? ticket.classificationJobId === job.id && ticket.classificationRevision === job.contextRevision
    : ticket.draftJobId === job.id;
const leased = (job: AiJob, token: string, now: Date) =>
  job.state === 'RUNNING' &&
  job.leaseToken === token &&
  !!job.leaseExpiresAt &&
  job.leaseExpiresAt > now;

export function createJobService(options: {
  client: PrismaClient;
  ai: AiService;
  tickets: TicketService;
  config: JobConfig;
  providerKey: string;
  providerEnabled: boolean;
  timeoutMs: number;
  clock?: () => Date;
}) {
  const { client, ai, tickets, config } = options;
  const clock = options.clock ?? (() => new Date());
  // Longer than the bounded HTTP request plus short DB preparation/completion. No heartbeat needed.
  const leaseMs = options.timeoutMs + 30000;
  const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
    client.$transaction(work, { timeout: 15000 });
  async function providerLock(tx: Prisma.TransactionClient, now: Date) {
    await tx.$executeRaw`INSERT INTO "AiProviderState" (id,"windowStartedAt") VALUES (${options.providerKey},${now}) ON CONFLICT (id) DO NOTHING`;
    const rows = await tx.$queryRaw<
      AiProviderState[]
    >`SELECT * FROM "AiProviderState" WHERE id=${options.providerKey} FOR UPDATE`;
    return rows[0]!;
  }
  async function resume(tx: Prisma.TransactionClient) {
    // Explicit POST clears permanent pause only; rate-limit cooldown and consumed budget remain.
    await tx.aiProviderState.update({
      where: { id: options.providerKey },
      data: { paused: false, pauseReason: null },
    });
  }
  async function terminal(
    tx: Prisma.TransactionClient,
    ticket: Ticket,
    job: AiJob,
    reason: string,
    stale = false,
  ) {
    await tx.aiJob.update({
      where: { id: job.id },
      data: {
        state: 'FAILED',
        failureReason: reason,
        stale,
        completedAt: clock(),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    if (job.task === 'CLASSIFICATION' && current(ticket, job))
      await tx.ticket.update({ where: { id: ticket.id }, data: { classificationState: 'FAILED' } });
  }
  async function draftDto(tx: Prisma.TransactionClient, ticket: Ticket, job: AiJob | null) {
    if (!job) return aiDraftSchema.parse({ state: 'NOT_REQUESTED' });
    const ctx = await readContext(tx, ticket, 'DRAFT');
    const stale =
      job.stale ||
      job.contextRevision !== ticket.contextRevision ||
      job.contextFingerprint !== ai.fingerprint(ctx, 'DRAFT');
    const metadata = {
      id: job.id,
      contextRevision: job.contextRevision,
      createdAt: job.createdAt.toISOString(),
      stale,
    };
    if (job.state === 'SUCCEEDED') {
      const run = job.resultRunId
        ? await tx.aiRun.findUnique({ where: { id: job.resultRunId } })
        : null;
      const result = draftSchema.safeParse(run?.result);
      if (!result.success || run?.state !== 'SUCCEEDED')
        return aiDraftSchema.parse({
          ...metadata,
          state: 'FAILED',
          failureReason: 'Saved draft is unavailable. Request regeneration.',
        });
      return aiDraftSchema.parse({ ...metadata, state: 'SUCCEEDED', text: result.data.text });
    }
    return aiDraftSchema.parse({
      ...metadata,
      state: job.state,
      ...(job.state === 'FAILED'
        ? { failureReason: job.failureReason ?? 'AI assistance failed.' }
        : {}),
    });
  }
  async function latestDraft(value: CurrentUser | null, id: string) {
    admin(value);
    return transaction(async (tx) => {
      const ticket = await lockTicket(tx, id);
      return draftDto(
        tx,
        ticket,
        ticket.draftJobId ? await tx.aiJob.findUnique({ where: { id: ticket.draftJobId } }) : null,
      );
    });
  }
  async function requestDraft(value: CurrentUser | null, id: string, raw: unknown) {
    admin(value);
    const input = draftRequestSchema.parse(raw);
    return transaction(async (tx) => {
      await providerLock(tx, clock());
      const ticket = await lockTicket(tx, id);
      const previous = ticket.draftJobId
        ? await tx.aiJob.findUnique({ where: { id: ticket.draftJobId } })
        : null;
      if (previous && active.some((state) => state === previous.state))
        return draftDto(tx, ticket, previous);
      const ctx = await readContext(tx, ticket, 'DRAFT');
      const hash = ai.fingerprint(ctx, 'DRAFT');
      if (
        previous?.state === 'SUCCEEDED' &&
        !input.regenerate &&
        previous.contextFingerprint === hash &&
        previous.contextRevision === ticket.contextRevision
      )
        return draftDto(tx, ticket, previous);
      await resume(tx);
      const job = await tx.aiJob.create({
        data: {
          ticketId: id,
          task: 'DRAFT',
          contextRevision: ticket.contextRevision,
          contextFingerprint: hash,
          force: input.regenerate,
          deduplicationKey: `${id}:draft:${hash}:${randomUUID()}`,
        },
      });
      const saved = await tx.ticket.update({ where: { id }, data: { draftJobId: job.id } });
      return draftDto(tx, saved, job);
    });
  }
  async function retryClassification(value: CurrentUser | null, id: string) {
    admin(value);
    return transaction(async (tx) => {
      await providerLock(tx, clock());
      const ticket = await lockTicket(tx, id);
      const old = ticket.classificationJobId
        ? await tx.aiJob.findUnique({ where: { id: ticket.classificationJobId } })
        : null;
      if (old && active.some((state) => state === old.state))
        return { ticketId: id, state: old.state };
      const ctx = await readContext(tx, ticket, 'CLASSIFICATION');
      const hash = ai.fingerprint(ctx, 'CLASSIFICATION');
      if (old?.state === 'SUCCEEDED' && old.contextFingerprint === hash)
        return { ticketId: id, state: 'SUCCEEDED' as const };
      await resume(tx);
      const generation = ticket.classificationRevision + 1;
      const job = await enqueueClassification(tx, id, generation);
      await tx.ticket.update({
        where: { id },
        data: {
          classificationRevision: generation,
          classificationJobId: job.id,
          classificationState: 'QUEUED',
        },
      });
      return { ticketId: id, state: 'QUEUED' as const };
    });
  }
  async function claim(): Promise<Claim | null> {
    return transaction(async (tx) => {
      const now = clock();
      let state = await providerLock(tx, now);
      if (state.windowStartedAt.getTime() + 60000 <= now.getTime())
        state = await tx.aiProviderState.update({
          where: { id: state.id },
          data: { windowStartedAt: now, requests: 0 },
        });
      const blocked = !options.providerEnabled
        ? new AiFailure('DISABLED')
        : state.paused
          ? new AiFailure(
              state.pauseReason && state.pauseReason in failureMessages
                ? (state.pauseReason as FailureCode)
                : 'CONFIGURATION',
            )
          : null;
      if (
        !blocked &&
        ((state.resumeAt && state.resumeAt > now) ||
          state.requests >= config.AI_REQUESTS_PER_MINUTE)
      )
        return null;
      const live = await tx.aiJob.count({
        where: { providerKey: options.providerKey, state: 'RUNNING', leaseExpiresAt: { gt: now } },
      });
      if (live >= config.AI_CONCURRENCY) return null;
      // Consistent lock order: provider -> ticket -> job. SKIP LOCKED permits independent runners.
      const rows = await tx.$queryRaw<Ticket[]>`SELECT t.* FROM "Ticket" t WHERE EXISTS (
        SELECT 1 FROM "AiJob" j WHERE j."ticketId"=t.id AND
        ((j.state='QUEUED' AND j."availableAt"<=${now}) OR (j.state='RUNNING' AND j."leaseExpiresAt"<=${now})))
        ORDER BY t."createdAt",t.id LIMIT 1 FOR UPDATE OF t SKIP LOCKED`;
      const ticket = rows[0];
      if (!ticket) return null;
      const jobs = await tx.$queryRaw<
        AiJob[]
      >`SELECT * FROM "AiJob" WHERE "ticketId"=${ticket.id} AND
        ((state='QUEUED' AND "availableAt"<=${now}) OR (state='RUNNING' AND "leaseExpiresAt"<=${now}))
        ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const job = jobs[0];
      if (!job) return null;
      if (!current(ticket, job)) {
        await terminal(tx, ticket, job, STALE, true);
        return null;
      }
      if (job.state === 'RUNNING')
        await tx.aiRun.updateMany({
          where: { ticketId: job.ticketId, task: job.task, state: 'RUNNING' },
          data: { state: 'FAILED', finishedAt: now, failure: new AiFailure('TIMEOUT').toJSON() },
        });
      if (job.attempts >= config.AI_MAX_ATTEMPTS) {
        await terminal(tx, ticket, job, EXHAUSTED);
        return null;
      }
      const saved = await tx.aiJob.update({
        where: { id: job.id },
        data: {
          state: 'RUNNING',
          attempts: { increment: 1 },
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          providerKey: options.providerKey,
          failureReason: null,
        },
      });
      if (!blocked)
        await tx.aiProviderState.update({
          where: { id: state.id },
          data: { requests: { increment: 1 } },
        });
      if (job.task === 'CLASSIFICATION')
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { classificationState: 'RUNNING' },
        });
      return { job: saved, blocked };
    });
  }
  async function failure(claimed: AiJob, error: AiFailure) {
    await transaction(async (tx) => {
      // Provider lock first so pause/cooldown and job outcome become visible together.
      await providerLock(tx, clock());
      const ticket = await lockTicket(tx, claimed.ticketId);
      const job = await tx.aiJob.findUniqueOrThrow({ where: { id: claimed.id } });
      if (!leased(job, claimed.leaseToken!, clock())) return;
      if (error.pauseConfiguration)
        await tx.aiProviderState.update({
          where: { id: options.providerKey },
          data: { paused: true, pauseReason: error.code },
        });
      const delay = retryDelay(job.attempts, config, error.retryAfterMs);
      if (error.code === 'RATE_LIMIT')
        await tx.aiProviderState.update({
          where: { id: options.providerKey },
          data: { resumeAt: new Date(clock().getTime() + delay) },
        });
      const retry =
        (error.retryable || error.code === 'CANCELLED') &&
        job.attempts < config.AI_MAX_ATTEMPTS &&
        current(ticket, job);
      if (retry) {
        await tx.aiJob.update({
          where: { id: job.id },
          data: {
            state: 'QUEUED',
            availableAt: new Date(clock().getTime() + delay),
            leaseToken: null,
            leaseExpiresAt: null,
            failureReason: error.message,
          },
        });
        if (job.task === 'CLASSIFICATION')
          await tx.ticket.update({
            where: { id: ticket.id },
            data: { classificationState: 'QUEUED' },
          });
      } else await terminal(tx, ticket, job, error.message);
    });
  }
  async function execute(claimed: Claim, signal?: AbortSignal) {
    const job = claimed.job;
    try {
      if (claimed.blocked) {
        await failure(job, claimed.blocked);
        return;
      }
      const prepared = await transaction(async (tx) => {
        const ticket = await lockTicket(tx, job.ticketId);
        const saved = await tx.aiJob.findUniqueOrThrow({ where: { id: job.id } });
        if (!leased(saved, job.leaseToken!, clock())) return null;
        if (!current(ticket, saved)) {
          await terminal(tx, ticket, saved, STALE, true);
          return null;
        }
        const context = await readContext(tx, ticket, job.task);
        const hash = ai.fingerprint(context, job.task);
        if (
          job.task === 'DRAFT' &&
          (job.contextRevision !== context.contextRevision || job.contextFingerprint !== hash)
        ) {
          await terminal(tx, ticket, saved, STALE, true);
          return null;
        }
        await tx.aiJob.update({ where: { id: job.id }, data: { contextFingerprint: hash } });
        const cached = await tx.aiRun.findFirst({
          where: {
            ticketId: job.ticketId,
            task: job.task,
            contextFingerprint: hash,
            state: 'SUCCEEDED',
            ...(job.force ? { jobId: job.id } : {}),
          },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        });
        return { context, hash, cached };
      });
      if (!prepared) return;
      if (signal?.aborted) throw new AiFailure('CANCELLED');
      let runId = prepared.cached?.id;
      if (!runId) {
        // No transaction is open while the model is executing.
        const result =
          job.task === 'CLASSIFICATION'
            ? await ai.classifyTicket(prepared.context, signal, job.id)
            : await ai.draftResponse(prepared.context, signal, job.id);
        if (result.state === 'FAILED') {
          await failure(job, new AiFailure(result.failure.code, result.failure.retryAfterMs));
          return;
        }
        runId = result.runId;
      }
      if (signal?.aborted) throw new AiFailure('CANCELLED');
      const run = await client.aiRun.findUniqueOrThrow({ where: { id: runId } });
      if (job.task === 'CLASSIFICATION') {
        await tickets.applyClassification(
          job.id,
          job.leaseToken!,
          classificationSchema.parse(run.result),
          runId,
        );
      } else
        await transaction(async (tx) => {
          const ticket = await lockTicket(tx, job.ticketId);
          const saved = await tx.aiJob.findUniqueOrThrow({ where: { id: job.id } });
          if (!leased(saved, job.leaseToken!, clock())) return;
          const context = await readContext(tx, ticket, 'DRAFT');
          if (
            !current(ticket, saved) ||
            ticket.contextRevision !== job.contextRevision ||
            ai.fingerprint(context, 'DRAFT') !== prepared.hash
          ) {
            await terminal(tx, ticket, saved, STALE, true);
            return;
          }
          draftSchema.parse(run.result);
          await tx.aiJob.update({
            where: { id: job.id },
            data: {
              state: 'SUCCEEDED',
              resultRunId: runId,
              completedAt: clock(),
              leaseToken: null,
              leaseExpiresAt: null,
              failureReason: null,
            },
          });
        });
    } catch (error) {
      // Lost lease/conflict cannot overwrite the replacement worker. Other exceptions stay safe.
      await failure(job, error instanceof AiFailure ? error : new AiFailure('PERSISTENCE'));
    }
  }
  return {
    latestDraft,
    requestDraft,
    retryClassification,
    claim,
    execute,
    leaseMs,
    async runOnce(signal?: AbortSignal) {
      if (signal?.aborted) return false;
      const claimed = await claim();
      if (!claimed) return false;
      await execute(claimed, signal);
      return true;
    },
  };
}
export type JobService = ReturnType<typeof createJobService>;
