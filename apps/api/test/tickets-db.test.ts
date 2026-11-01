import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  allowedStatusTransitions,
  currentUserSchema,
  ticketStatusSchema,
  adminTicketDetailSchema,
  authorTicketDetailSchema,
  endpoints,
} from '@bookleaf/contracts';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { buildApp } from '../src/app.js';
import { seedDemoData } from '../src/seed-data.js';
import { createCatalogService } from '../src/modules/catalog/service.js';
import { createTicketService } from '../src/modules/tickets/service.js';
import { enqueueClassification } from '../src/modules/jobs/enqueue.js';
import { createPrismaAuthStore } from '../src/modules/auth/prisma-store.js';
import { applyTestMigrations, repositoryRoot } from './helpers/migrations.js';

const statusError = (status: number) => (error: unknown) =>
  error instanceof Error && 'statusCode' in error && error.statusCode === status;

test(
  'M04 real PostgreSQL and HTTP ticket workflow',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const connectionString = process.env.TEST_DATABASE_URL!;
    const schema = `bookleaf_tickets_test_${randomBytes(8).toString('hex')}`;
    assert.match(schema, /^bookleaf_tickets_test_[a-f0-9]{16}$/);
    const connection = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
      log: [],
    });
    let created = false;
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
      const other = currentUserSchema.parse(
        await client.user.findUniqueOrThrow({ where: { id: 'demo-author-AUTH002' } }),
      );
      const productionAuthor = currentUserSchema.parse(
        await client.user.findUniqueOrThrow({ where: { id: 'demo-author-AUTH007' } }),
      );
      const admin = currentUserSchema.parse(
        await client.user.findUniqueOrThrow({ where: { id: 'demo-admin' } }),
      );
      const catalog = createCatalogService(client);
      const service = createTicketService(client, catalog);
      const input = {
        bookId: null,
        subject: 'Royalty question',
        description: 'Please explain my royalty statement.',
      };
      const detail = async (id: string) =>
        adminTicketDetailSchema.parse(await service.detail(admin, id));
      const create = () => service.create(author, input);

      await t.test(
        'atomic submission, production books, ownership and role isolation',
        async () => {
          const first = await service.create(author, { ...input, bookId: 'BK001' });
          assert.equal(first.status, 'OPEN');
          assert.equal(first.classificationState, 'QUEUED');
          const stored = await client.ticket.findUniqueOrThrow({ where: { id: first.id } });
          assert.equal(stored.priority, 'MEDIUM');
          assert.equal(stored.category, null);
          const job = await client.aiJob.findUniqueOrThrow({
            where: { id: stored.classificationJobId! },
          });
          assert.equal(job.state, 'QUEUED');
          assert.equal(job.attempts, 0);
          assert.equal(job.ticketId, first.id);
          await assert.rejects(
            service.applyClassification(job.id, 'unclaimed', {
              category: 'GENERAL_INQUIRY',
              priority: 'LOW',
              rationale: 'Unclaimed job',
            }),
            statusError(409),
          );
          await client.$transaction(async (tx) => {
            assert.equal((await enqueueClassification(tx, first.id, 0)).id, job.id);
          });
          assert.equal(await client.aiJob.count({ where: { ticketId: first.id } }), 1);
          assert.equal(
            (await service.create(productionAuthor, { ...input, bookId: 'BK013' })).book?.id,
            'BK013',
          );
          await assert.rejects(
            service.create(author, { ...input, bookId: 'BK003' }),
            statusError(404),
          );
          await assert.rejects(service.create(author, { ...input, authorId: 'AUTH002' }));
          await assert.rejects(service.create(admin, input), statusError(403));
          await assert.rejects(service.create(null, input), statusError(401));
          await assert.rejects(service.detail(other, first.id), statusError(404));
          await assert.rejects(service.detail(other, 'missing'), statusError(404));
          assert.ok(!(await service.list(other, {})).data.some((row) => row.id === first.id));
          await assert.rejects(
            service.update(author, first.id, { expectedRevision: 0, status: 'RESOLVED' }),
            statusError(403),
          );
          await assert.rejects(
            service.reply(
              author,
              first.id,
              { expectedRevision: 0, body: 'Not allowed' },
              'author-key',
            ),
            statusError(403),
          );
          await assert.rejects(
            service.note(author, first.id, { body: 'Not allowed' }),
            statusError(403),
          );
        },
      );

      await t.test('every status transition, self-assignment and audited overrides', async () => {
        const ticket = await create();
        for (const from of ticketStatusSchema.options)
          for (const to of ticketStatusSchema.options) {
            await client.ticket.update({
              where: { id: ticket.id },
              data: { status: from, revision: 0 },
            });
            const action = service.update(admin, ticket.id, { expectedRevision: 0, status: to });
            if (from === to || allowedStatusTransitions[from].includes(to)) {
              assert.equal((await action).status, to);
            } else {
              await assert.rejects(action, statusError(409));
              assert.equal((await detail(ticket.id)).status, from);
            }
          }
        let current = await detail(ticket.id);
        current = adminTicketDetailSchema.parse(
          await service.update(admin, ticket.id, {
            expectedRevision: current.revision,
            assignmentAction: 'SELF',
            category: 'ISBN_METADATA',
            priority: 'HIGH',
          }),
        );
        assert.equal(current.assignee?.id, admin.id);
        assert.equal(current.categorySource, 'MANUAL');
        assert.equal(current.prioritySource, 'MANUAL');
        const events = current.events.filter((e) => e.type !== 'STATUS_CHANGED');
        assert.equal(events.length, 3);
        assert.ok(events.every((e) => e.actor?.id === admin.id));
        current = adminTicketDetailSchema.parse(
          await service.update(admin, ticket.id, {
            expectedRevision: current.revision,
            assignmentAction: 'UNASSIGN',
          }),
        );
        assert.equal(current.assignee, null);
        assert.ok(
          current.events.some(
            (e) =>
              e.type === 'ASSIGNMENT_CHANGED' && e.oldValue === admin.id && e.newValue === null,
          ),
        );
      });

      await t.test(
        'private notes and events cannot leak through author detail or list; seed preserves real support data',
        async () => {
          const ticket = await create();
          await service.note(admin, ticket.id, { body: 'INTERNAL_SECRET_MARKER' });
          let current = await detail(ticket.id);
          assert.equal(current.notes[0]?.body, 'INTERNAL_SECRET_MARKER');
          await service.update(admin, ticket.id, {
            expectedRevision: current.revision,
            priority: 'CRITICAL',
          });
          current = await detail(ticket.id);
          await service.reply(
            admin,
            ticket.id,
            { expectedRevision: current.revision, body: 'Reviewed public answer' },
            'privacy-reply',
          );
          const publicDetail = await service.detail(author, ticket.id);
          assert.equal(authorTicketDetailSchema.parse(publicDetail).replies.length, 1);
          const forbidden = [
            'notes',
            'events',
            'category',
            'priority',
            'revision',
            'assignee',
            'draftState',
            'classificationState',
            'classificationRationale',
            'categoryOverridden',
            'author',
          ];
          for (const key of forbidden) assert.equal(key in publicDetail, false, key);
          assert.equal(
            JSON.stringify(await service.list(author, {})).includes('INTERNAL_SECRET_MARKER'),
            false,
          );
          const before = await detail(ticket.id);
          await seedDemoData(client, raw, credentials);
          assert.deepEqual(await detail(ticket.id), before);
          assert.equal(await client.aiJob.count({ where: { ticketId: ticket.id } }), 1);
        },
      );

      await t.test(
        'stale and concurrent edits conflict; notes increment revision without changing AI context',
        async () => {
          const ticket = await create();
          const edits = await Promise.allSettled([
            service.update(admin, ticket.id, { expectedRevision: 0, priority: 'HIGH' }),
            service.update(admin, ticket.id, { expectedRevision: 0, priority: 'LOW' }),
          ]);
          assert.equal(edits.filter((r) => r.status === 'fulfilled').length, 1);
          const rejected = edits.find((r) => r.status === 'rejected');
          assert.ok(rejected?.status === 'rejected' && statusError(409)(rejected.reason));
          await assert.rejects(
            service.update(admin, ticket.id, { expectedRevision: 0, status: 'RESOLVED' }),
            statusError(409),
          );
          const before = await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
          await service.note(admin, ticket.id, { body: 'Internal review' });
          const after = await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
          assert.equal(after.revision, before.revision + 1);
          assert.equal(after.contextRevision, before.contextRevision);
        },
      );

      await t.test(
        'concurrent reply retries commit once, mismatched keys conflict, closed tickets require reopening',
        async () => {
          const ticket = await create();
          const body = { body: 'Final reviewed answer', expectedRevision: 0 };
          const [a, b] = await Promise.all([
            service.reply(admin, ticket.id, body, 'retry-key'),
            service.reply(admin, ticket.id, body, 'retry-key'),
          ]);
          assert.deepEqual(a, b);
          const restartedService = createTicketService(client, catalog);
          assert.deepEqual(await restartedService.reply(admin, ticket.id, body, 'retry-key'), a);
          assert.equal(await client.ticketReply.count({ where: { ticketId: ticket.id } }), 1);
          assert.equal((await detail(ticket.id)).revision, 1);
          assert.equal((await detail(ticket.id)).status, 'OPEN');
          await assert.rejects(
            service.reply(admin, ticket.id, { ...body, body: 'Different content' }, 'retry-key'),
            statusError(409),
          );
          await assert.rejects(service.reply(admin, ticket.id, body, 'new-key'), statusError(409));
          await assert.rejects(service.reply(admin, ticket.id, body, undefined));
          await service.update(admin, ticket.id, { expectedRevision: 1, status: 'RESOLVED' });
          await service.update(admin, ticket.id, { expectedRevision: 2, status: 'CLOSED' });
          assert.deepEqual(await service.reply(admin, ticket.id, body, 'retry-key'), a);
          await assert.rejects(
            service.reply(
              admin,
              ticket.id,
              { body: 'New reply', expectedRevision: 3 },
              'closed-key',
            ),
            statusError(409),
          );
          await service.update(admin, ticket.id, { expectedRevision: 3, status: 'IN_PROGRESS' });
          await service.reply(
            admin,
            ticket.id,
            { body: 'New reply', expectedRevision: 4 },
            'reopened-key',
          );
          assert.equal((await detail(ticket.id)).status, 'IN_PROGRESS');
        },
      );

      await t.test(
        'queue urgency, age, stable ties, inclusive dates, filters, pagination and author filter rejection',
        async () => {
          for (const data of [
            {
              id: 'queue-a',
              status: 'OPEN' as const,
              priority: 'LOW' as const,
              createdAt: new Date('2001-01-01T00:00:00Z'),
            },
            {
              id: 'queue-b',
              status: 'IN_PROGRESS' as const,
              priority: 'CRITICAL' as const,
              createdAt: new Date('2001-01-02T23:59:59.999Z'),
            },
            {
              id: 'queue-c',
              status: 'OPEN' as const,
              priority: 'CRITICAL' as const,
              createdAt: new Date('2001-01-01T01:00:00Z'),
            },
            {
              id: 'queue-d',
              status: 'CLOSED' as const,
              priority: 'CRITICAL' as const,
              createdAt: new Date('2001-01-01T00:00:00Z'),
            },
            {
              id: 'queue-e',
              status: 'RESOLVED' as const,
              priority: 'HIGH' as const,
              createdAt: new Date('2001-01-03T00:00:00Z'),
            },
            {
              id: 'queue-f',
              status: 'OPEN' as const,
              priority: 'CRITICAL' as const,
              createdAt: new Date('2001-01-01T01:00:00Z'),
            },
          ])
            await client.ticket.create({
              data: { ...input, ...data, authorId: author.authorId!, category: 'ISBN_METADATA' },
            });
          const range = { createdFrom: '2001-01-01', createdTo: '2001-01-03' };
          const ids = async (query: object) =>
            (await service.list(admin, query)).data.map((r) => r.id);
          assert.deepEqual(await ids(range), [
            'queue-c',
            'queue-f',
            'queue-b',
            'queue-a',
            'queue-d',
            'queue-e',
          ]);
          assert.deepEqual(await ids({ ...range, pageSize: 2, page: 2 }), ['queue-b', 'queue-a']);
          assert.equal((await service.list(admin, { ...range, pageSize: 2 })).meta.total, 6);
          assert.deepEqual(
            await ids({
              ...range,
              status: 'OPEN',
              priority: 'CRITICAL',
              category: 'ISBN_METADATA',
            }),
            ['queue-c', 'queue-f'],
          );
          assert.deepEqual(
            await ids({ ...range, createdFrom: '2001-01-02', createdTo: '2001-01-02' }),
            ['queue-b'],
          );
          assert.deepEqual(await ids({ ...range, sort: 'oldest' }), [
            'queue-a',
            'queue-d',
            'queue-c',
            'queue-f',
            'queue-b',
            'queue-e',
          ]);
          assert.deepEqual(await ids({ ...range, sort: 'newest' }), [
            'queue-e',
            'queue-b',
            'queue-c',
            'queue-f',
            'queue-a',
            'queue-d',
          ]);
          assert.equal((await service.list(other, range)).meta.total, 0);
          assert.deepEqual(await ids({ ...range, page: 999 }), []);
          for (const query of [
            { priority: 'HIGH' },
            { category: 'ISBN_METADATA' },
            { sort: 'queue' },
            { authorId: 'AUTH002' },
          ])
            await assert.rejects(service.list(author, query));
          for (const query of [
            { page: 0 },
            { pageSize: 101 },
            { createdFrom: '2001-02-30' },
            { createdFrom: '2002-01-01', createdTo: '2001-01-01' },
            { page: Number.MAX_SAFE_INTEGER },
          ])
            await assert.rejects(service.list(admin, query));
        },
      );

      await t.test(
        'enqueue failure rolls back ticket and job; reply and event writes roll back on later failure',
        async () => {
          const before = [await client.ticket.count(), await client.aiJob.count()];
          const failing = createTicketService(client, catalog, {
            enqueue: async (tx, id, rev) => {
              await enqueueClassification(tx, id, rev);
              throw new Error('Injected enqueue failure');
            },
          });
          await assert.rejects(failing.create(author, input), /Injected enqueue/);
          assert.deepEqual([await client.ticket.count(), await client.aiJob.count()], before);
          const ticket = await create();
          await connection.query(
            `CREATE FUNCTION reject_ticket_update() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''Injected update failure''; END'; CREATE TRIGGER reject_update BEFORE UPDATE ON "Ticket" FOR EACH ROW EXECUTE FUNCTION reject_ticket_update()`,
          );
          try {
            await assert.rejects(
              service.reply(
                admin,
                ticket.id,
                { expectedRevision: 0, body: 'Rollback' },
                'rollback-key',
              ),
            );
            await assert.rejects(
              service.update(admin, ticket.id, { expectedRevision: 0, status: 'RESOLVED' }),
            );
            assert.equal(await client.ticketReply.count({ where: { ticketId: ticket.id } }), 0);
            assert.equal(await client.ticketEvent.count({ where: { ticketId: ticket.id } }), 0);
            assert.equal((await detail(ticket.id)).revision, 0);
          } finally {
            await connection.query(
              'DROP TRIGGER reject_update ON "Ticket"; DROP FUNCTION reject_ticket_update()',
            );
          }
        },
      );

      const claimForTest = async (id: string) => {
        const row = await client.ticket.findUniqueOrThrow({ where: { id } });
        const token = randomBytes(16).toString('hex');
        const job = await client.aiJob.update({
          where: { id: row.classificationJobId! },
          data: {
            state: 'RUNNING',
            leaseToken: token,
            leaseExpiresAt: new Date(Date.now() + 60000),
            attempts: { increment: 1 },
          },
        });
        return { job, token };
      };
      const suggestion = {
        category: 'ROYALTY_PAYMENTS',
        priority: 'CRITICAL',
        rationale: 'Test-only validated suggestion',
      };
      await t.test(
        'delayed AI respects independent overrides and completes job atomically without changing lifecycle',
        async () => {
          for (const manual of [
            { category: 'ISBN_METADATA' },
            { priority: 'LOW' },
            { category: 'ISBN_METADATA', priority: 'LOW' },
            {},
          ]) {
            const ticket = await create();
            const { job, token } = await claimForTest(ticket.id);
            if (Object.keys(manual).length)
              await service.update(admin, ticket.id, { expectedRevision: 0, ...manual });
            await service.applyClassification(job.id, token, suggestion);
            const stored = await client.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
            assert.equal(stored.category, manual.category ?? suggestion.category);
            assert.equal(stored.priority, manual.priority ?? suggestion.priority);
            assert.equal(stored.suggestedCategory, suggestion.category);
            assert.equal(stored.suggestedPriority, suggestion.priority);
            assert.equal(stored.categorySource, manual.category ? 'MANUAL' : 'AI');
            assert.equal(stored.prioritySource, manual.priority ? 'MANUAL' : 'AI');
            assert.equal(stored.status, 'OPEN');
            assert.equal(stored.assigneeId, null);
            const completed = await client.aiJob.findUniqueOrThrow({ where: { id: job.id } });
            assert.equal(completed.state, 'SUCCEEDED');
            assert.equal(completed.leaseToken, null);
            await assert.rejects(
              service.applyClassification(job.id, token, suggestion),
              statusError(409),
            );
          }
          // Explicitly choosing the current default also creates an override.
          const ticket = await create();
          const { job, token } = await claimForTest(ticket.id);
          await service.update(admin, ticket.id, { expectedRevision: 0, priority: 'MEDIUM' });
          await service.applyClassification(job.id, token, suggestion);
          assert.equal((await detail(ticket.id)).priority, 'MEDIUM');
        },
      );

      await t.test(
        'invalid, expired, reclaimed and superseded AI results cannot mutate tickets',
        async () => {
          const ticket = await create();
          const { job, token } = await claimForTest(ticket.id);
          await assert.rejects(
            service.applyClassification(job.id, token, { ...suggestion, category: 'INVALID' }),
          );
          await assert.rejects(
            service.applyClassification(job.id, 'wrong-token', suggestion),
            statusError(409),
          );
          await client.aiJob.update({
            where: { id: job.id },
            data: { leaseExpiresAt: new Date(0) },
          });
          await assert.rejects(
            service.applyClassification(job.id, token, suggestion),
            statusError(409),
          );
          await client.aiJob.update({
            where: { id: job.id },
            data: { leaseToken: 'new-lease', leaseExpiresAt: new Date(Date.now() + 60000) },
          });
          await assert.rejects(
            service.applyClassification(job.id, token, suggestion),
            statusError(409),
          );
          await client.ticket.update({
            where: { id: ticket.id },
            data: { classificationRevision: 1 },
          });
          await assert.rejects(
            service.applyClassification(job.id, 'new-lease', suggestion),
            statusError(409),
          );
          await client.ticket.update({
            where: { id: ticket.id },
            data: { classificationRevision: 0, classificationJobId: 'newer-job' },
          });
          await assert.rejects(
            service.applyClassification(job.id, 'new-lease', suggestion),
            statusError(409),
          );
          assert.equal((await detail(ticket.id)).category, null);
          assert.equal((await detail(ticket.id)).revision, 0);
        },
      );

      await t.test(
        'AI completion rolls back when job persistence fails and manual edits remain possible with queued jobs',
        async () => {
          const ticket = await create();
          const { job, token } = await claimForTest(ticket.id);
          await connection.query(
            `CREATE FUNCTION reject_job_update() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''Injected job failure''; END'; CREATE TRIGGER reject_job BEFORE UPDATE ON "AiJob" FOR EACH ROW EXECUTE FUNCTION reject_job_update()`,
          );
          try {
            await assert.rejects(service.applyClassification(job.id, token, suggestion));
            assert.equal((await detail(ticket.id)).category, null);
            assert.equal(await client.ticketEvent.count({ where: { ticketId: ticket.id } }), 0);
            assert.equal(
              (await client.aiJob.findUniqueOrThrow({ where: { id: job.id } })).state,
              'RUNNING',
            );
          } finally {
            await connection.query(
              'DROP TRIGGER reject_job ON "AiJob"; DROP FUNCTION reject_job_update()',
            );
          }
          await service.applyClassification(job.id, token, suggestion);
          const queued = await create();
          await service.reply(
            admin,
            queued.id,
            { expectedRevision: 0, body: 'Manual support still works' },
            'manual-key',
          );
          assert.equal((await detail(queued.id)).classificationState, 'QUEUED');
        },
      );

      await t.test(
        'real HTTP login, authorization, CSRF, envelopes and public/admin projections',
        async () => {
          const app = await buildApp({
            logLevel: 'silent',
            database: {
              check: async () => {
                await client.$queryRaw`SELECT 1`;
              },
              close: async () => {},
            },
            auth: {
              store: createPrismaAuthStore(client),
              appOrigin: 'http://localhost:5173',
              production: false,
              sessionTtlSeconds: 3600,
            },
            catalog,
            tickets: service,
          });
          try {
            const base = await app.listen({ host: '127.0.0.1', port: 0 });
            const headers = {
              origin: 'http://localhost:5173',
              'x-bookleaf-request': '1',
              'content-type': 'application/json',
            };
            const login = async (email: string, password: string) => {
              const response = await fetch(`${base}/api/v1/auth/login`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ email, password }),
              });
              assert.equal(response.status, 200);
              await response.text();
              const cookie = response.headers.get('set-cookie')?.split(';')[0];
              assert.ok(cookie);
              return cookie;
            };
            const authorCookie = await login(author.email, credentials.DEMO_AUTHOR_PASSWORD);
            const adminCookie = await login(admin.email, credentials.DEMO_ADMIN_PASSWORD);
            const otherCookie = await login(other.email, credentials.DEMO_AUTHOR_PASSWORD);
            const request = async (
              path: string,
              method = 'GET',
              cookie?: string,
              body?: unknown,
              extra?: Record<string, string>,
            ) =>
              fetch(`${base}/api/v1${path}`, {
                method,
                headers: { ...headers, ...(cookie ? { cookie } : {}), ...extra },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
              });
            assert.equal((await request('/tickets')).status, 401);
            assert.equal((await request('/tickets', 'POST', adminCookie, input)).status, 403);
            assert.equal(
              (
                await request('/tickets', 'POST', authorCookie, input, {
                  origin: 'https://evil.example',
                })
              ).status,
              403,
            );
            const createdResponse = await request('/tickets', 'POST', authorCookie, input);
            assert.equal(createdResponse.status, 201);
            const ticket = endpoints.createTicket.response.parse(await createdResponse.json()).data;
            assert.equal((await request(`/tickets/${ticket.id}`, 'GET', otherCookie)).status, 404);
            for (const [suffix, method, body] of [
              ['', 'PATCH', { expectedRevision: 0, status: 'RESOLVED' }],
              ['/notes', 'POST', { body: 'Secret' }],
              ['/replies', 'POST', { body: 'Reply', expectedRevision: 0 }],
            ] as const) {
              assert.equal(
                (await request(`/tickets/${ticket.id}${suffix}`, method, authorCookie, body))
                  .status,
                403,
              );
            }
            assert.equal(
              (await request('/tickets?priority=HIGH', 'GET', authorCookie)).status,
              400,
            );
            const note = await request(`/tickets/${ticket.id}/notes`, 'POST', adminCookie, {
              body: 'HTTP_PRIVATE_MARKER',
            });
            assert.equal(note.status, 201);
            const stale = await request(`/tickets/${ticket.id}`, 'PATCH', adminCookie, {
              expectedRevision: 0,
              status: 'RESOLVED',
            });
            assert.equal(stale.status, 409);
            const staleBody = (await stale.json()) as {
              error: { code: string; requestId: string };
            };
            assert.equal(staleBody.error.code, 'CONFLICT');
            assert.ok(staleBody.error.requestId);
            const adminResponse = await request(`/tickets/${ticket.id}`, 'GET', adminCookie);
            const adminDetail = endpoints.adminTicket.response.parse(
              await adminResponse.json(),
            ).data;
            assert.equal(adminDetail.notes[0]?.body, 'HTTP_PRIVATE_MARKER');
            const replyBody = {
              body: 'HTTP public answer',
              expectedRevision: adminDetail.revision,
            };
            assert.equal(
              (await request(`/tickets/${ticket.id}/replies`, 'POST', adminCookie, replyBody))
                .status,
              400,
            );
            const replyResponse = await request(
              `/tickets/${ticket.id}/replies`,
              'POST',
              adminCookie,
              replyBody,
              { 'idempotency-key': 'http-retry' },
            );
            assert.equal(replyResponse.status, 201);
            const firstReply = await replyResponse.json();
            const retry = await request(
              `/tickets/${ticket.id}/replies`,
              'POST',
              adminCookie,
              replyBody,
              { 'idempotency-key': 'http-retry' },
            );
            assert.equal(retry.status, 201);
            assert.deepEqual(await retry.json(), firstReply);
            const authorResponse = await request(`/tickets/${ticket.id}`, 'GET', authorCookie);
            const authorJson = await authorResponse.json();
            assert.equal(JSON.stringify(authorJson).includes('HTTP_PRIVATE_MARKER'), false);
            assert.equal(endpoints.authorTicket.response.parse(authorJson).data.replies.length, 1);
            const authorList = await request('/tickets', 'GET', authorCookie);
            endpoints.authorTickets.response.parse(await authorList.json());
            const adminList = await request('/tickets', 'GET', adminCookie);
            endpoints.adminTickets.response.parse(await adminList.json());
            assert.equal(
              (await request(`/tickets/${ticket.id}/ai-drafts`, 'POST', adminCookie, {})).status,
              404,
            );
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
