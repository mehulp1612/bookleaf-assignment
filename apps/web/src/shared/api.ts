import { errorResponseSchema } from '@bookleaf/contracts';
import type { z } from 'zod';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
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
  const response = await fetch(path, { ...init, credentials: 'same-origin' });
  const body: unknown = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(body);
    throw new ApiClientError(
      response.status,
      parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE',
      parsed.success ? parsed.data.error.message : 'The server returned an unexpected response.',
    );
  }
  return schema.parse(body);
}
