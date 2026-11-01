import type { FastifyInstance } from 'fastify';
import { API_PREFIX, idParamsSchema } from '@bookleaf/contracts';
import { requireRole } from '../auth/http.js';
import type { TicketService } from './service.js';

export function installTickets(app: FastifyInstance, tickets: TicketService) {
  const id = (params: unknown) => idParamsSchema.parse(params).id;
  app.post(`${API_PREFIX}/tickets`, { preHandler: requireRole('AUTHOR') }, async (req, reply) =>
    reply.status(201).send({ data: await tickets.create(req.user, req.body) }),
  );
  app.get(`${API_PREFIX}/tickets`, async (req) => tickets.list(req.user, req.query));
  app.get(`${API_PREFIX}/tickets/:id`, async (req) => ({
    data: await tickets.detail(req.user, id(req.params)),
  }));
  app.patch(`${API_PREFIX}/tickets/:id`, { preHandler: requireRole('ADMIN') }, async (req) => ({
    data: await tickets.update(req.user, id(req.params), req.body),
  }));
  app.post(
    `${API_PREFIX}/tickets/:id/replies`,
    { preHandler: requireRole('ADMIN') },
    async (req, reply) =>
      reply.status(201).send({
        data: await tickets.reply(
          req.user,
          id(req.params),
          req.body,
          req.headers['idempotency-key'],
        ),
      }),
  );
  app.post(
    `${API_PREFIX}/tickets/:id/notes`,
    { preHandler: requireRole('ADMIN') },
    async (req, reply) =>
      reply.status(201).send({ data: await tickets.note(req.user, id(req.params), req.body) }),
  );
}
