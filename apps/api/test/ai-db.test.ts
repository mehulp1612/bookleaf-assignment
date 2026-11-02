import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { parseAiConfig } from '../src/modules/ai/config.js';
import { createAiService } from '../src/modules/ai/service.js';
import { createPrismaAiRunStore } from '../src/modules/ai/store.js';
import { createFakeProvider } from '../src/modules/ai/provider.js';
import { AiFailure } from '../src/modules/ai/failures.js';
import { applyTestMigrations } from './helpers/migrations.js';
import { baseContext, qualityCases } from './fixtures/ai-quality.js';

test(
  'M05 PostgreSQL run persistence is safe, immutable on completion, and independent of tickets',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const connectionString = process.env.TEST_DATABASE_URL!;
    const schema = `bookleaf_ai_test_${randomBytes(8).toString('hex')}`;
    assert.match(schema, /^bookleaf_ai_test_[a-f0-9]{16}$/);
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
      await client.author.create({ data: { id: baseContext.authorId } });
      await client.ticket.create({
        data: {
          id: baseContext.ticketId,
          authorId: baseContext.authorId,
          subject: baseContext.subject,
          description: baseContext.description,
        },
      });
      const store = createPrismaAiRunStore(client);
      const service = createAiService({
        config: parseAiConfig({}),
        provider: createFakeProvider([
          JSON.stringify(qualityCases[0]!.classification),
          new AiFailure('RATE_LIMIT', 2000),
        ]),
        store,
      });
      const success = await service.classifyTicket(baseContext);
      const failed = await service.draftResponse(baseContext);
      assert.equal(success.state, 'SUCCEEDED');
      assert.equal(failed.state, 'FAILED');
      const rows = await client.aiRun.findMany({ orderBy: { startedAt: 'asc' } });
      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.state, 'SUCCEEDED');
      assert.deepEqual(rows[0]!.result, qualityCases[0]!.classification);
      assert.deepEqual(rows[1]!.failure, new AiFailure('RATE_LIMIT', 2000).toJSON());
      assert.equal(rows[1]!.result, null);
      assert.ok(!JSON.stringify(rows).includes(baseContext.description));
      await assert.rejects(store.finish(success.runId, success), /already finished/);
      const ticket = await client.ticket.findUniqueOrThrow({ where: { id: baseContext.ticketId } });
      assert.equal(ticket.category, null);
      assert.equal(ticket.status, 'OPEN');
      assert.equal(await client.ticketReply.count(), 0);
      assert.equal(await client.aiJob.count(), 0);
      await assert.rejects(
        service.classifyTicket({ ...baseContext, ticketId: 'missing' }),
        (e) => e instanceof AiFailure && e.code === 'PERSISTENCE',
      );
    } finally {
      await client.$disconnect();
      if (created) await connection.query(`DROP SCHEMA "${schema}" CASCADE`);
      await connection.end();
    }
  },
);
