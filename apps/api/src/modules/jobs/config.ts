import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AiConfig } from '../ai/config.js';
import { ConfigurationError } from '../../infrastructure/config.js';

const schema = z.object({
  AI_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AI_JOB_POLL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  AI_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(100).default(6),
  AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  AI_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60000).default(2000),
});
export type JobConfig = z.infer<typeof schema>;
export function parseJobConfig(values: Record<string, string | undefined>): JobConfig {
  const parsed = schema.safeParse(values);
  if (!parsed.success)
    throw new ConfigurationError('Invalid AI worker configuration. Check .env.example.');
  return parsed.data;
}
export function providerKey(config: AiConfig) {
  // Private persisted identity. Key rotation creates a fresh pause/budget domain; never exposed.
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
export function retryDelay(attempt: number, config: JobConfig, retryAfterMs: number | null) {
  return Math.max(
    Math.min(60000, config.AI_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)),
    retryAfterMs ?? 0,
  );
}
