import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  currentUserSchema,
  aiDraftSchema,
  adminTicketDetailSchema,
  resourceResponseSchema,
} from '@bookleaf/contracts';
import { z } from 'zod';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { buildApp } from '../src/app.js';
import { seedDemoData } from '../src/seed-data.js';
import { createPrismaAuthStore } from '../src/modules/auth/prisma-store.js';
import { createCatalogService } from '../src/modules/catalog/service.js';
import { createTicketService } from '../src/modules/tickets/service.js';
import { parseAiConfig } from '../src/modules/ai/config.js';
import { createAiService } from '../src/modules/ai/service.js';
import { createPrismaAiRunStore } from '../src/modules/ai/store.js';
import { createFakeProvider } from '../src/modules/ai/provider.js';
import { AiFailure } from '../src/modules/ai/failures.js';
import type { Provider } from '../src/modules/ai/types.js';
import { parseJobConfig, providerKey, retryDelay } from '../src/modules/jobs/config.js';
import { createJobService, lockTicket } from '../src/modules/jobs/service.js';
import { createJobRunner } from '../src/modules/jobs/runner.js';
import { readContext } from '../src/modules/jobs/context.js';
import { qualityCases } from './fixtures/ai-quality.js';
import { applyTestMigrations, repositoryRoot } from './helpers/migrations.js';

const classification = JSON.stringify(qualityCases[0]!.classification);
const draft = JSON.stringify(qualityCases[0]!.draft);
const isConflict = (e: unknown) => e instanceof Error && 'statusCode' in e && e.statusCode === 409;
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('M06 configuration bounds, provider rotation and retry delay', () => {
  assert.throws(() => parseJobConfig({ AI_CONCURRENCY: '0' }));
  assert.throws(() => parseJobConfig({ AI_MAX_ATTEMPTS: '20' }));
  const config = parseJobConfig({});
  assert.equal(retryDelay(1, config, 30000), 30000);
  assert.equal(retryDelay(5, config, null), 32000);
  const ai = parseAiConfig({});
  assert.notEqual(providerKey(ai), providerKey({ ...ai, AI_API_KEY: 'rotated-test-key' }));
  assert.ok(!providerKey({ ...ai, AI_API_KEY: 'test-secret' }).includes('test-secret'));
});

test(
  'M06 PostgreSQL orchestration and protected HTTP endpoints',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const connectionString = process.env.TEST_DATABASE_URL!;
    const schema = `bookleaf_jobs_test_${randomBytes(8).toString('hex')}`;
    assert.match(schema, /^bookleaf_jobs_test_[a-f0-9]{16}$/);
    const connection = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
      log: [],
    });
    let created = false;
    let now = new Date('2027-01-01T00:00:00Z');
    const clock = () => now;
    const advance = (ms: number) => {
      now = new Date(now.getTime() + ms);
    };
    try {
      await connection.connect();
      await connection.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      await connection.query(`SET search_path TO "${schema}"`);
      await applyTestMigrations(connection);
      const raw: unknown = JSON.parse(
        await readFile(resolve(repositoryRoot(), 'FULLSTACK-SAMPLEDATA (1) (1) (1).json'), 'utf8'),
      );
      const credentials = {
        DEMO_ADMIN_EMAIL: 'admin@example.test',
        DEMO_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
        DEMO_AUTHOR_PASSWORD: randomBytes(24).toString('hex'),
      };
      await seedDemoData(client, raw, credentials);
      const author = currentUserSchema.parse(
        await client.user.findUniqueOrThrow({ where: { id: 'demo-author-AUTH001' } }),
      );
      const admin = currentUserSchema.parse(
        await client.user.findUniqueOrThrow({ where: { id: 'demo-admin' } }),
      );
      const tickets = createTicketService(client, createCatalogService(client), { clock });
      const makeTicket = () =>
        tickets.create(author, {
          bookId: 'BK001',
          subject: 'Royalty payout',
          description: 'Please explain my pending royalties.',
        });
      const reset = async () => {
        await client.aiJob.updateMany({
          where: { state: { in: ['QUEUED', 'RUNNING'] } },
          data: { state: 'FAILED', leaseToken: null, leaseExpiresAt: null },
        });
        advance(60001);
      };
      const runtime = (
        outputs: (string | AiFailure)[],
        settings: Record<string, string> = {},
        key = randomBytes(8).toString('hex'),
        override?: Provider,
      ) => {
        const provider = createFakeProvider(outputs);
        const config = parseJobConfig(settings);
        const ai = createAiService({
          config: parseAiConfig({}),
          provider: override ?? provider,
          store: createPrismaAiRunStore(client),
          now: clock,
        });
        const jobs = createJobService({
          client,
          ai,
          tickets,
          config,
          providerKey: key,
          providerEnabled: true,
          timeoutMs: 100,
          clock,
        });
        return { provider, ai, jobs, config, key };
      };

      await t.test(
        'automatic enqueue is independent of provider; completion preserves manual overrides',
        async () => {
          await reset();
          const r = runtime([classification]);
          const ticket = await makeTicket();
          assert.equal(r.provider.calls.length, 0);
          assert.equal(ticket.classificationState, 'QUEUED');
          await tickets.update(admin, ticket.id, {
            expectedRevision: 0,
            category: 'GENERAL_INQUIRY',
            priority: 'LOW',
          });
          assert.equal(await r.jobs.runOnce(), true);
          const row = await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
          assert.equal(row.category, 'GENERAL_INQUIRY');
          assert.equal(row.priority, 'LOW');
          assert.equal(row.suggestedCategory, 'ROYALTY_PAYMENTS');
          assert.equal(row.classificationState, 'SUCCEEDED');
          assert.equal(await client.ticketReply.count({ where: { ticketId: ticket.id } }), 0);
          const job = await client.aiJob.findUniqueOrThrow({
            where: { id: row.classificationJobId! },
          });
          assert.ok(job.resultRunId);
          assert.equal(job.leaseToken, null);
        },
      );
      await t.test(
        'duplicate claims across runners, shared concurrency and recovery of expired leases',
        async () => {
          await reset();
          const r = runtime([classification]);
          const other = runtime([classification], {}, r.key);
          const ticket = await makeTicket();
          const claims = await Promise.all([r.jobs.claim(), other.jobs.claim()]);
          assert.equal(claims.filter(Boolean).length, 1);
          const claimed = claims.find(Boolean)!;
          assert.equal(await other.jobs.claim(), null);
          advance(r.jobs.leaseMs + 1);
          const reclaimed = await other.jobs.claim();
          assert.ok(reclaimed);
          assert.notEqual(reclaimed.job.leaseToken, claimed.job.leaseToken);
          assert.equal(reclaimed.job.attempts, 2);
          await r.jobs.execute(claimed);
          assert.equal(r.provider.calls.length, 0);
          await other.jobs.execute(reclaimed);
          assert.equal(other.provider.calls.length, 1);
          assert.equal(
            (await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } }))
              .classificationState,
            'SUCCEEDED',
          );
          await assert.rejects(
            tickets.applyClassification(
              claimed.job.id,
              claimed.job.leaseToken!,
              qualityCases[0]!.classification,
            ),
            isConflict,
          );
        },
      );
      await t.test(
        'restart after persisted model success reuses the result without another provider call',
        async () => {
          await reset();
          const r = runtime([classification]);
          const ticket = await makeTicket();
          const claim = await r.jobs.claim();
          assert.ok(claim);
          const context = await client.$transaction(async (tx) =>
            readContext(tx, await lockTicket(tx, ticket.id), 'CLASSIFICATION'),
          );
          await client.aiJob.update({
            where: { id: claim.job.id },
            data: { contextFingerprint: r.ai.fingerprint(context, 'CLASSIFICATION') },
          });
          const result = await r.ai.classifyTicket(context);
          assert.equal(result.state, 'SUCCEEDED');
          // Simulate process death before ticket/job completion; create a fresh runtime after expiry.
          advance(r.jobs.leaseMs + 1);
          const restarted = runtime([], {}, r.key);
          assert.equal(await restarted.jobs.runOnce(), true);
          assert.equal(restarted.provider.calls.length, 0);
          const saved = await client.aiJob.findUniqueOrThrow({ where: { id: claim.job.id } });
          assert.equal(saved.resultRunId, result.runId);
          assert.equal(saved.state, 'SUCCEEDED');
        },
      );
      await t.test(
        'lease recovery and transient failures have a bounded attempt count',
        async () => {
          await reset();
          const r = runtime([], { AI_MAX_ATTEMPTS: '2' });
          await makeTicket();
          const first = await r.jobs.claim();
          assert.ok(first);
          advance(r.jobs.leaseMs + 1);
          assert.ok(await r.jobs.claim());
          advance(r.jobs.leaseMs + 1);
          assert.equal(await r.jobs.claim(), null);
          assert.equal(
            (await client.aiJob.findUniqueOrThrow({ where: { id: first.job.id } })).state,
            'FAILED',
          );
          assert.equal(r.provider.calls.length, 0);
          const limited = runtime([new AiFailure('TIMEOUT'), new AiFailure('TIMEOUT')], {
            AI_MAX_ATTEMPTS: '2',
            AI_RETRY_BASE_MS: '100',
          });
          const ticket = await makeTicket();
          await limited.jobs.runOnce();
          assert.equal(await limited.jobs.runOnce(), false);
          advance(100);
          await limited.jobs.runOnce();
          assert.equal(limited.provider.calls.length, 2);
          assert.equal(
            (await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } }))
              .classificationState,
            'FAILED',
          );
        },
      );
      await t.test(
        'Retry-After cools down all jobs and request budgets survive runner restart',
        async () => {
          await reset();
          const r = runtime([new AiFailure('RATE_LIMIT', 30000), classification]);
          await makeTicket();
          await r.jobs.runOnce();
          const restarted = runtime([classification], {}, r.key);
          assert.equal(await restarted.jobs.claim(), null);
          advance(29999);
          assert.equal(await restarted.jobs.claim(), null);
          advance(1);
          assert.equal(await restarted.jobs.runOnce(), true);
          await reset();
          const budget = runtime([classification], { AI_REQUESTS_PER_MINUTE: '1' });
          await makeTicket();
          await budget.jobs.runOnce();
          await makeTicket();
          const second = runtime([classification], { AI_REQUESTS_PER_MINUTE: '1' }, budget.key);
          assert.equal(await second.jobs.claim(), null);
          advance(60000);
          assert.equal(await second.jobs.runOnce(), true);
        },
      );
      await t.test(
        'quota/auth failures pause configuration; explicit retry and key rotation recover',
        async () => {
          for (const code of ['QUOTA', 'AUTHENTICATION'] as const) {
            await reset();
            const r = runtime([new AiFailure(code), classification]);
            const ticket = await makeTicket();
            await r.jobs.runOnce();
            assert.equal(
              (await client.aiProviderState.findUniqueOrThrow({ where: { id: r.key } })).paused,
              true,
            );
            const second = await makeTicket();
            await r.jobs.runOnce();
            assert.equal(r.provider.calls.length, 1);
            assert.equal(
              (await client.ticket.findUniqueOrThrow({ where: { id: second.id } }))
                .classificationState,
              'FAILED',
            );
            await r.jobs.retryClassification(admin, ticket.id);
            await r.jobs.runOnce();
            assert.equal(r.provider.calls.length, 2);
            const rotated = runtime([classification]);
            await rotated.jobs.retryClassification(admin, second.id);
            await rotated.jobs.runOnce();
            assert.equal(rotated.provider.calls.length, 1);
          }
        },
      );
      await t.test(
        'draft POST deduplicates active jobs; GET and successful cache reuse are provider-free',
        async () => {
          await reset();
          const r = runtime([classification, draft, draft]);
          const ticket = await makeTicket();
          await r.jobs.runOnce();
          const count = r.provider.calls.length;
          const requests = await Promise.all([
            r.jobs.requestDraft(admin, ticket.id, {}),
            r.jobs.requestDraft(admin, ticket.id, { regenerate: true }),
          ]);
          assert.ok('id' in requests[0]! && 'id' in requests[1]!);
          assert.equal(requests[0].id, requests[1].id);
          for (let i = 0; i < 3; i++)
            assert.equal((await r.jobs.latestDraft(admin, ticket.id)).state, 'QUEUED');
          assert.equal(r.provider.calls.length, count);
          await r.jobs.runOnce();
          const complete = await r.jobs.latestDraft(admin, ticket.id);
          assert.equal(complete.state, 'SUCCEEDED');
          assert.deepEqual(await r.jobs.requestDraft(admin, ticket.id, {}), complete);
          assert.equal(r.provider.calls.length, count + 1);
          const regenerated = await r.jobs.requestDraft(admin, ticket.id, { regenerate: true });
          assert.equal(regenerated.state, 'QUEUED');
          await r.jobs.runOnce();
          assert.equal(r.provider.calls.length, count + 2);
          assert.equal(
            adminTicketDetailSchema.parse(await tickets.detail(admin, ticket.id)).draftState,
            'SUCCEEDED',
          );
        },
      );
      await t.test(
        'delayed drafts cannot overwrite changed context; manual workflow does not wait for AI',
        async () => {
          await reset();
          const started = barrier();
          const release = barrier();
          const scripted = createFakeProvider([classification, draft]);
          const provider: Provider = {
            identity: scripted.identity,
            async generate(req) {
              if (req.schemaName === 'draft') {
                started.release();
                await release.promise;
              }
              return scripted.generate(req);
            },
          };
          const r = runtime([], {}, undefined, provider);
          const ticket = await makeTicket();
          await r.jobs.runOnce();
          await r.jobs.requestDraft(admin, ticket.id, {});
          const work = r.jobs.runOnce();
          await started.promise;
          try {
            const saved = await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
            await tickets.update(admin, ticket.id, {
              expectedRevision: saved.revision,
              category: 'GENERAL_INQUIRY',
            });
            await tickets.note(admin, ticket.id, {
              body: 'Private text must never enter the prompt.',
            });
          } finally {
            release.release();
          }
          await work;
          const latest = await r.jobs.latestDraft(admin, ticket.id);
          assert.equal(latest.state, 'FAILED');
          assert.ok('stale' in latest && latest.stale);
          assert.ok(!JSON.stringify(scripted.calls).includes('Private text'));
          assert.equal(await client.ticketReply.count({ where: { ticketId: ticket.id } }), 0);
        },
      );
      await t.test(
        'public replies and catalog updates invalidate cached drafts; notes do not',
        async () => {
          await reset();
          const r = runtime([classification, draft]);
          const ticket = await makeTicket();
          await r.jobs.runOnce();
          await r.jobs.requestDraft(admin, ticket.id, {});
          await r.jobs.runOnce();
          await tickets.note(admin, ticket.id, { body: 'Internal only.' });
          let latest = await r.jobs.latestDraft(admin, ticket.id);
          assert.ok('stale' in latest && !latest.stale);
          const saved = await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
          await tickets.reply(
            admin,
            ticket.id,
            { body: 'Please contact support for review.', expectedRevision: saved.revision },
            'm06-public-reply-key',
          );
          latest = await r.jobs.latestDraft(admin, ticket.id);
          assert.ok('stale' in latest && latest.stale);
          const another = await makeTicket();
          const second = runtime([classification, draft]);
          await second.jobs.runOnce();
          await second.jobs.requestDraft(admin, another.id, {});
          await second.jobs.runOnce();
          const original = await client.book.findUniqueOrThrow({ where: { id: 'BK001' } });
          await client.book.update({ where: { id: 'BK001' }, data: { royaltyPendingPaise: 1n } });
          try {
            const changed = await second.jobs.latestDraft(admin, another.id);
            assert.ok('stale' in changed && changed.stale);
          } finally {
            await client.book.update({
              where: { id: 'BK001' },
              data: { royaltyPendingPaise: original.royaltyPendingPaise },
            });
          }
        },
      );
      await t.test(
        'disabled provider leaves manual ticket handling available without a call',
        async () => {
          await reset();
          const r = runtime([]);
          const jobs = createJobService({
            client,
            ai: r.ai,
            tickets,
            config: r.config,
            providerKey: r.key,
            providerEnabled: false,
            timeoutMs: 100,
            clock,
          });
          const ticket = await makeTicket();
          await jobs.runOnce();
          assert.equal(r.provider.calls.length, 0);
          const row = await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
          assert.equal(row.classificationState, 'FAILED');
          await tickets.reply(
            admin,
            ticket.id,
            { body: 'Manual assistance is available.', expectedRevision: row.revision },
            'disabled-manual-reply',
          );
          await jobs.requestDraft(admin, ticket.id, {});
          await jobs.runOnce();
          const latest = await jobs.latestDraft(admin, ticket.id);
          assert.equal(latest.state, 'FAILED');
          assert.ok(latest.state === 'FAILED' && latest.failureReason.includes('not configured'));
        },
      );
      await t.test(
        'stale queued context consumes no provider call and draft completion rollback is recoverable',
        async () => {
          await reset();
          const r = runtime([classification, draft]);
          const ticket = await makeTicket();
          await r.jobs.runOnce();
          await r.jobs.requestDraft(admin, ticket.id, {});
          const row = await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
          await tickets.reply(
            admin,
            ticket.id,
            { body: 'A public update.', expectedRevision: row.revision },
            'queued-stale-reply',
          );
          await r.jobs.runOnce();
          assert.equal(r.provider.calls.length, 1);
          assert.equal((await r.jobs.latestDraft(admin, ticket.id)).state, 'FAILED');
          await r.jobs.requestDraft(admin, ticket.id, {});
          await connection.query(
            `CREATE FUNCTION reject_draft_completion() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.task::text = ''DRAFT'' AND NEW.state::text = ''SUCCEEDED'' THEN RAISE EXCEPTION ''Injected completion failure''; END IF; RETURN NEW; END'; CREATE TRIGGER reject_draft BEFORE UPDATE ON "AiJob" FOR EACH ROW EXECUTE FUNCTION reject_draft_completion()`,
          );
          try {
            await r.jobs.runOnce();
            assert.equal((await r.jobs.latestDraft(admin, ticket.id)).state, 'FAILED');
          } finally {
            await connection.query(
              'DROP TRIGGER reject_draft ON "AiJob"; DROP FUNCTION reject_draft_completion()',
            );
          }
          await r.jobs.requestDraft(admin, ticket.id, {});
          await r.jobs.runOnce();
          assert.equal((await r.jobs.latestDraft(admin, ticket.id)).state, 'SUCCEEDED');
          assert.equal(r.provider.calls.length, 2);
        },
      );
      await t.test(
        'shutdown aborts in-flight work and leaves bounded recoverable retry',
        async () => {
          await reset();
          const started = barrier();
          const provider: Provider = {
            identity: 'fake:abort',
            generate: async (req) =>
              new Promise((_resolve, reject) => {
                req.signal?.addEventListener('abort', () => reject(new AiFailure('CANCELLED')), {
                  once: true,
                });
                started.release();
              }),
          };
          const r = runtime([], { AI_JOB_POLL_MS: '100' }, undefined, provider);
          const ticket = await makeTicket();
          const runner = createJobRunner(r.jobs, r.config);
          runner.start();
          await started.promise;
          await runner.stop();
          assert.equal(
            (await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } }))
              .classificationState,
            'QUEUED',
          );
          const job = await client.aiJob.findFirstOrThrow({ where: { ticketId: ticket.id } });
          assert.equal(job.leaseToken, null);
          assert.equal(job.attempts, 1);
        },
      );
      await t.test(
        'HTTP role/CSRF validation, real GET/POST integration and continued manual replies',
        async () => {
          await reset();
          const r = runtime([classification, draft]);
          const ticket = await makeTicket();
          const app = await buildApp({
            database: { check: async () => {}, close: async () => {} },
            logLevel: 'silent',
            tickets,
            jobs: r.jobs,
            auth: {
              store: createPrismaAuthStore(client),
              appOrigin: 'http://localhost:5173',
              production: false,
              sessionTtlSeconds: 3600,
            },
          });
          await app.listen({ host: '127.0.0.1', port: 0 });
          const address = app.server.address();
          assert.ok(address && typeof address !== 'string');
          const base = `http://127.0.0.1:${address.port}`;
          const headers = {
            Origin: 'http://localhost:5173',
            'X-BookLeaf-Request': '1',
            'Content-Type': 'application/json',
          };
          const login = async (email: string, password: string) => {
            const response = await fetch(`${base}/api/v1/auth/login`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ email, password }),
            });
            assert.equal(response.status, 200);
            return response.headers.get('set-cookie')!.split(';')[0]!;
          };
          try {
            const adminCookie = await login(admin.email, credentials.DEMO_ADMIN_PASSWORD);
            const authorCookie = await login(author.email, credentials.DEMO_AUTHOR_PASSWORD);
            const path = `${base}/api/v1/tickets/${ticket.id}/ai-drafts`;
            assert.equal((await fetch(`${path}/latest`)).status, 401);
            assert.equal(
              (await fetch(`${path}/latest`, { headers: { Cookie: authorCookie } })).status,
              403,
            );
            assert.equal(
              (
                await fetch(path, {
                  method: 'POST',
                  headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
                  body: '{}',
                })
              ).status,
              403,
            );
            assert.equal(
              (
                await fetch(path, {
                  method: 'POST',
                  headers: { ...headers, Cookie: adminCookie },
                  body: '{"regenerate":"yes"}',
                })
              ).status,
              400,
            );
            const initial = await fetch(`${path}/latest`, { headers: { Cookie: adminCookie } });
            assert.equal(initial.status, 200);
            assert.equal(
              resourceResponseSchema(aiDraftSchema).parse(await initial.json()).data.state,
              'NOT_REQUESTED',
            );
            assert.equal(r.provider.calls.length, 0);
            await r.jobs.runOnce();
            const queued = await fetch(path, {
              method: 'POST',
              headers: { ...headers, Cookie: adminCookie },
              body: '{}',
            });
            assert.equal(queued.status, 202);
            await r.jobs.runOnce();
            const complete = await fetch(`${path}/latest`, { headers: { Cookie: adminCookie } });
            assert.equal(
              resourceResponseSchema(aiDraftSchema).parse(await complete.json()).data.state,
              'SUCCEEDED',
            );
            const retry = await fetch(`${base}/api/v1/tickets/${ticket.id}/ai-classification`, {
              method: 'POST',
              headers: { ...headers, Cookie: adminCookie },
              body: '{}',
            });
            assert.equal(retry.status, 200);
            assert.equal(r.provider.calls.length, 2);
            const authorView = await fetch(`${base}/api/v1/tickets/${ticket.id}`, {
              headers: { Cookie: authorCookie },
            });
            const view = z
              .object({ data: z.record(z.string(), z.unknown()) })
              .parse(await authorView.json()).data;
            assert.ok(!('draftState' in view));
            assert.ok(!('notes' in view));
            assert.ok(!('resultRunId' in view));
            const saved = await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
            const reply = await fetch(`${base}/api/v1/tickets/${ticket.id}/replies`, {
              method: 'POST',
              headers: {
                ...headers,
                Cookie: adminCookie,
                'Idempotency-Key': 'm06-http-manual-reply',
              },
              body: JSON.stringify({
                body: 'A manually reviewed response.',
                expectedRevision: saved.revision,
              }),
            });
            assert.equal(reply.status, 201);
          } finally {
            await app.close();
          }
        },
      );
    } finally {
      await client.$disconnect();
      if (created) await connection.query(`DROP SCHEMA "${schema}" CASCADE`);
      await connection.end();
    }
  },
);
