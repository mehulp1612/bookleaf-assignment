import type { PrismaClient } from '../../generated/prisma/client.js';
import type { AiRunStore, RunFinish, RunStart } from './service.js';

export function createPrismaAiRunStore(client: PrismaClient): AiRunStore {
  return {
    async start(run) {
      await client.aiRun.create({ data: run });
    },
    async finish(id, outcome) {
      const { result, failure, usage } = outcome;
      const changed = await client.aiRun.updateMany({
        where: { id, state: 'RUNNING' },
        data: {
          state: outcome.state,
          finishedAt: outcome.finishedAt,
          latencyMs: outcome.latencyMs,
          ...(result ? { result } : {}),
          ...(failure ? { failure } : {}),
          ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {}),
        },
      });
      if (changed.count !== 1) throw new Error('AI run already finished or missing.');
    },
  };
}

export function createMemoryAiRunStore(): AiRunStore & {
  records: Map<string, RunStart & { outcome?: RunFinish }>;
} {
  const records = new Map<string, RunStart & { outcome?: RunFinish }>();
  return {
    records,
    async start(run) {
      if (records.has(run.id)) throw new Error('Duplicate run.');
      records.set(run.id, structuredClone(run));
    },
    async finish(id, outcome) {
      const record = records.get(id);
      if (!record || record.outcome) throw new Error('AI run already finished or missing.');
      records.set(id, { ...record, outcome: structuredClone(outcome) });
    },
  };
}
