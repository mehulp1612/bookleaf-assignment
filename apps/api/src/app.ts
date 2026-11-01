import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { healthResponseSchema } from '@bookleaf/contracts';
import type { DatabaseHealth } from './infrastructure/database.js';
import { HttpError, installErrorHandling } from './infrastructure/errors.js';
import { installAuthentication } from './modules/auth/http.js';
import type { AuthOptions } from './modules/auth/service.js';
import { installCatalog } from './modules/catalog/http.js';
import type { CatalogService } from './modules/catalog/service.js';
import { installTickets } from './modules/tickets/http.js';
import type { TicketService } from './modules/tickets/service.js';

interface AppOptions {
  database: DatabaseHealth;
  logLevel?: string;
  webRoot?: string;
  auth?: AuthOptions;
  catalog?: CatalogService;
  tickets?: TicketService;
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger:
      options.logLevel === 'silent'
        ? false
        : {
            level: options.logLevel ?? 'info',
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
          },
    disableRequestLogging: true,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024,
  });
  installErrorHandling(app);
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
  });
  app.addHook('onClose', async () => options.database.close());
  if (options.auth) await installAuthentication(app, options.auth);
  else
    app.addHook('onRequest', async (request) => {
      if (request.routeOptions.url?.startsWith('/api/v1/')) {
        throw new HttpError(503, 'INTERNAL_ERROR', 'Authentication is not configured.');
      }
    });

  if (options.catalog) installCatalog(app, options.catalog);
  if (options.tickets) installTickets(app, options.tickets);
  app.get('/health/live', async () => healthResponseSchema.parse({ data: { status: 'ok' } }));
  app.get('/health/ready', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      await options.database.check();
    } catch {
      throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.');
    }
    return healthResponseSchema.parse({ data: { status: 'ok' } });
  });

  if (options.webRoot) {
    const webRoot = options.webRoot;
    await access(join(webRoot, 'index.html'));
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      index: false,
      setHeaders(response, path) {
        response.setHeader(
          'Cache-Control',
          relative(webRoot, path).split(sep)[0] === 'assets'
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });
  }
  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const reserved = /^\/(api|health)(\/|$)/.test(pathname);
    const browserNavigation =
      (request.method === 'GET' || request.method === 'HEAD') &&
      request.headers.accept?.includes('text/html');
    if (options.webRoot && browserNavigation && !reserved && !pathname.includes('.')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    throw new HttpError(404, 'NOT_FOUND', 'Resource not found.');
  });
  return app;
}
