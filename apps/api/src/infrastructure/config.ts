import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

const originSchema = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
}, 'APP_ORIGIN must be an HTTP(S) origin without a path or trailing slash.');

const databaseUrlSchema = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['postgres:', 'postgresql:'].includes(url.protocol) && url.pathname.length > 1;
}, 'DATABASE_URL must identify a PostgreSQL database.');

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_ORIGIN: originSchema.default('http://localhost:5173'),
    DATABASE_URL: databaseUrlSchema,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && !value.APP_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'Production requires HTTPS.',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export class ConfigurationError extends Error {}

export function parseEnvironment(values: Record<string, string | undefined>): Environment {
  const result = environmentSchema.safeParse(values);
  if (!result.success) {
    // Never include raw values: database URLs can contain credentials.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new ConfigurationError(
      `Invalid environment configuration: ${fields.join(', ')}. Check .env.example.`,
    );
  }
  return result.data;
}

export function loadEnvironment(): Environment {
  config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
  return parseEnvironment(process.env);
}
