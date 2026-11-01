import { errorResponseSchema } from '@bookleaf/contracts';
import type { z } from 'zod';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

// Responses are validated; cookies remain same-origin and are never read by application code.
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
    throw new Error('Use a same-origin API path.');
  const headers = new Headers(init?.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes((init?.method ?? 'GET').toUpperCase())) {
    headers.set('x-bookleaf-request', '1');
  }
  if (init?.body) headers.set('content-type', 'application/json');
  const timeout = AbortSignal.timeout(15_000);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
  let body: unknown;
  try {
    body = response.status === 204 ? undefined : await response.json();
  } catch {
    throw new ApiClientError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned an unreadable response. Please try again.',
    );
  }
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(body);
    throw new ApiClientError(
      response.status,
      parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE',
      parsed.success ? parsed.data.error.message : 'The server returned an unexpected response.',
      parsed.success ? parsed.data.error.fieldErrors : undefined,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiClientError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned incomplete information. Please try again.',
    );
  return parsed.data;
}
