import type { FastifyInstance } from 'fastify';
import { API_PREFIX, idParamsSchema, classificationJobSchema } from '@bookleaf/contracts';
import { z } from 'zod';
import { requireRole } from '../auth/http.js';
import type { JobService } from './service.js';

export function installAiJobs(app: FastifyInstance, jobs: JobService) {
  const id = (params: unknown) => idParamsSchema.parse(params).id;
  app.get(
    `${API_PREFIX}/tickets/:id/ai-drafts/latest`,
    { preHandler: requireRole('ADMIN') },
    async (req) => ({ data: await jobs.latestDraft(req.user, id(req.params)) }),
  );
  app.post(
    `${API_PREFIX}/tickets/:id/ai-drafts`,
    { preHandler: requireRole('ADMIN') },
    async (req, reply) => {
      const draft = await jobs.requestDraft(req.user, id(req.params), req.body ?? {});
      return reply
        .status(draft.state === 'QUEUED' || draft.state === 'RUNNING' ? 202 : 200)
        .send({ data: draft });
    },
  );
  app.post(
    `${API_PREFIX}/tickets/:id/ai-classification`,
    { preHandler: requireRole('ADMIN') },
    async (req, reply) => {
      z.strictObject({}).parse(req.body ?? {});
      const result = classificationJobSchema.parse(
        await jobs.retryClassification(req.user, id(req.params)),
      );
      return reply.status(result.state === 'SUCCEEDED' ? 200 : 202).send({ data: result });
    },
  );
}
