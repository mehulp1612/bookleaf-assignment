import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  API_PREFIX,
  currentUserSchema,
  loginRequestSchema,
  resourceResponseSchema,
  type CurrentUser,
  type Role,
} from '@bookleaf/contracts';
import { HttpError } from '../../infrastructure/errors.js';
import { createAuthService, type AuthOptions } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: CurrentUser | null;
  }
}

function sessionCookie(header: string | undefined, name: string): string | null {
  const values = (header ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${name}=`));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : null;
}

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest) => {
    if (!request.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    if (!roles.includes(request.user.role))
      throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this action.');
  };
}

export async function installAuthentication(app: FastifyInstance, options: AuthOptions) {
  const service = await createAuthService(options);
  const name = options.production ? '__Host-bookleaf_session' : 'bookleaf_session';
  const attributes = `Path=/; HttpOnly; SameSite=Lax${options.production ? '; Secure' : ''}`;
  const clearCookie = (reply: FastifyReply) =>
    reply.header(
      'set-cookie',
      `${name}=; ${attributes}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    );
  app.decorateRequest('user', null);

  // Protect every registered business route by default. Only the login POST is public.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.routeOptions.url?.startsWith(`${API_PREFIX}/`)) return;
    reply.header('cache-control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.headers.origin !== options.appOrigin ||
        request.headers['x-bookleaf-request'] !== '1' ||
        request.headers['sec-fetch-site'] === 'cross-site'
      ) {
        throw new HttpError(403, 'FORBIDDEN', 'A same-origin application request is required.');
      }
    }
    const isLogin =
      request.method === 'POST' && request.routeOptions.url === `${API_PREFIX}/auth/login`;
    if (isLogin) {
      const retryAfter = await service.throttle('ip', request.ip);
      if (retryAfter) {
        reply.header('retry-after', retryAfter);
        throw new HttpError(
          429,
          'RATE_LIMITED',
          'Too many sign-in attempts. Please try again later.',
        );
      }
      return;
    }
    request.user = await service.resolve(sessionCookie(request.headers.cookie, name));
    if (!request.user) {
      clearCookie(reply);
      throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    }
  });

  app.post(`${API_PREFIX}/auth/login`, async (request, reply) => {
    const input = loginRequestSchema.parse(request.body);
    // IP was counted before body parsing; account bucket is counted separately here.
    const retryAfter = await service.throttle('email', input.email);
    if (retryAfter) {
      reply.header('retry-after', retryAfter);
      throw new HttpError(
        429,
        'RATE_LIMITED',
        'Too many sign-in attempts. Please try again later.',
      );
    }
    const result = await service.login(
      input.email,
      input.password,
      sessionCookie(request.headers.cookie, name),
    );
    reply.header(
      'set-cookie',
      `${name}=${result.token}; ${attributes}; Max-Age=${options.sessionTtlSeconds}; Expires=${result.expiresAt.toUTCString()}`,
    );
    return resourceResponseSchema(currentUserSchema).parse({ data: result.principal });
  });
  app.get(`${API_PREFIX}/auth/me`, async (request) =>
    resourceResponseSchema(currentUserSchema).parse({ data: request.user }),
  );
  app.post(`${API_PREFIX}/auth/logout`, async (request, reply) => {
    await service.logout(sessionCookie(request.headers.cookie, name));
    clearCookie(reply);
    return reply.status(204).send();
  });
}
