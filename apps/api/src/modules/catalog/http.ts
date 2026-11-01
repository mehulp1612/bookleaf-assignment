import type { FastifyInstance } from 'fastify';
import {
  API_PREFIX,
  bookSchema,
  idParamsSchema,
  resourceResponseSchema,
} from '@bookleaf/contracts';
import type { CatalogService } from './service.js';

export function installCatalog(app: FastifyInstance, catalog: CatalogService) {
  app.get(`${API_PREFIX}/books`, async (request) => catalog.listBooks(request.user, request.query));
  app.get(`${API_PREFIX}/books/:id`, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return resourceResponseSchema(bookSchema).parse({
      data: await catalog.getBook(request.user, id),
    });
  });
}
