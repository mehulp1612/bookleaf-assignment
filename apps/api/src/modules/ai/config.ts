import { z } from 'zod';
import { ConfigurationError } from '../../infrastructure/config.js';

const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
});
const schema = z
  .object({
    AI_PROVIDER: z.enum(['disabled', 'openrouter', 'compatible']).default('disabled'),
    AI_BASE_URL: endpoint.default('https://openrouter.ai/api/v1'),
    AI_API_KEY: z.string().trim().max(4096).default(''),
    AI_CLASSIFICATION_MODEL: z.string().trim().max(200).default(''),
    AI_DRAFT_MODEL: z.string().trim().max(200).default(''),
    AI_OUTPUT_MODE: z.enum(['prompt', 'json_object', 'json_schema']).default('prompt'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(20000),
    AI_CLASSIFICATION_MAX_TOKENS: z.coerce.number().int().min(100).max(4000).default(400),
    AI_DRAFT_MAX_TOKENS: z.coerce.number().int().min(100).max(8000).default(1200),
  })
  .superRefine((value, ctx) => {
    if (value.AI_PROVIDER === 'disabled') return;
    for (const key of ['AI_API_KEY', 'AI_CLASSIFICATION_MODEL', 'AI_DRAFT_MODEL'] as const) {
      if (!value[key])
        ctx.addIssue({ code: 'custom', path: [key], message: 'Required when enabled.' });
    }
    if (
      value.AI_PROVIDER === 'openrouter' &&
      value.AI_BASE_URL.replace(/\/$/, '') !== 'https://openrouter.ai/api/v1'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_BASE_URL'],
        message: 'Use compatible for other endpoints.',
      });
    }
  });
export type AiConfig = z.infer<typeof schema>;
export function parseAiConfig(values: Record<string, string | undefined>): AiConfig {
  const parsed = schema.safeParse(values);
  if (!parsed.success)
    throw new ConfigurationError(
      `Invalid AI configuration: ${[...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ')}. Check .env.example.`,
    );
  return parsed.data;
}
