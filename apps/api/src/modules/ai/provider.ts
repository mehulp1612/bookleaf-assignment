import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AiConfig } from './config.js';
import { AiFailure } from './failures.js';
import type { GenerationRequest, Provider } from './types.js';

const envelope = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().min(1).max(32000), refusal: z.string().nullish() }),
        finish_reason: z.string().nullable(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
const errorEnvelope = z.object({
  error: z.object({
    code: z.union([z.number(), z.string()]).optional(),
    type: z.string().optional(),
  }),
});

export function retryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const numeric = Number(value);
  const milliseconds = /^\d+(\.\d+)?$/.test(value) ? numeric * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? Math.min(milliseconds, 86400000)
    : null;
}
function httpFailure(status: number, code: string, delay: number | null) {
  if (status === 402 || ['insufficient_quota', 'quota_exceeded', 'budget_exceeded'].includes(code))
    return new AiFailure('QUOTA', delay);
  if (status === 401 || status === 403) return new AiFailure('AUTHENTICATION');
  if (status === 429) return new AiFailure('RATE_LIMIT', delay);
  if (status === 408 || status === 504) return new AiFailure('TIMEOUT', delay);
  if (status >= 500) return new AiFailure('UPSTREAM', delay);
  return new AiFailure('CONFIGURATION');
}

// One request only. No SDK retries, model fallbacks, tools, or redirects carrying keys.
export function createChatProvider(config: AiConfig, fetcher: typeof fetch = fetch): Provider {
  const base = config.AI_BASE_URL.replace(/\/+$/, '');
  return {
    identity: `${config.AI_PROVIDER}:${createHash('sha256').update(base).digest('hex')}:${config.AI_OUTPUT_MODE}`,
    async generate(request: GenerationRequest) {
      if (config.AI_PROVIDER === 'disabled') throw new AiFailure('DISABLED');
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      if (request.signal?.aborted) throw new AiFailure('CANCELLED');
      request.signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.AI_TIMEOUT_MS);
      try {
        const response = await fetcher(`${base}/chat/completions`, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${config.AI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            max_tokens: request.maxTokens,
            stream: false,
            ...(config.AI_PROVIDER === 'openrouter'
              ? {
                  provider: {
                    allow_fallbacks: false,
                    ...(config.AI_OUTPUT_MODE === 'json_schema'
                      ? { require_parameters: true }
                      : {}),
                  },
                }
              : {}),
            ...(config.AI_OUTPUT_MODE === 'json_schema'
              ? {
                  response_format: {
                    type: 'json_schema',
                    json_schema: { name: request.schemaName, strict: true, schema: request.schema },
                  },
                }
              : {}),
            ...(config.AI_OUTPUT_MODE === 'json_object'
              ? { response_format: { type: 'json_object' } }
              : {}),
          }),
        });
        // Bound even streamed HTTP bodies; do not retain or log upstream error text.
        const reader = response.body?.getReader();
        let raw = '';
        if (reader) {
          const decoder = new TextDecoder();
          let bytes = 0;
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > 128000) {
                await reader.cancel();
                throw new AiFailure('INVALID_OUTPUT');
              }
              raw += decoder.decode(chunk.value, { stream: true });
            }
            raw += decoder.decode();
          } finally {
            reader.releaseLock();
          }
        }
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          if (!response.ok)
            throw httpFailure(response.status, '', retryAfter(response.headers.get('retry-after')));
          throw new AiFailure('INVALID_OUTPUT');
        }
        const remoteError = errorEnvelope.safeParse(body);
        if (!response.ok || remoteError.success) {
          const code = remoteError.success
            ? String(remoteError.data.error.code ?? remoteError.data.error.type ?? '')
            : '';
          const status = response.ok ? Number(code) || 502 : response.status;
          throw httpFailure(status, code, retryAfter(response.headers.get('retry-after')));
        }
        const result = envelope.safeParse(body);
        if (!result.success) throw new AiFailure('INVALID_OUTPUT');
        const choice = result.data.choices[0]!;
        if (choice.finish_reason !== 'stop' || choice.message.refusal)
          throw new AiFailure('INVALID_OUTPUT');
        return {
          text: choice.message.content,
          ...(result.data.usage
            ? {
                usage: {
                  inputTokens: result.data.usage.prompt_tokens,
                  outputTokens: result.data.usage.completion_tokens,
                },
              }
            : {}),
        };
      } catch (error) {
        if (request.signal?.aborted) throw new AiFailure('CANCELLED');
        if (timedOut) throw new AiFailure('TIMEOUT');
        if (error instanceof AiFailure) throw error;
        throw new AiFailure('UPSTREAM');
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', cancel);
      }
    },
  };
}

// Explicitly injected in tests only; configuration cannot silently select a fake model.
export function createFakeProvider(
  outputs: (string | AiFailure)[],
): Provider & { calls: GenerationRequest[] } {
  const remaining = [...outputs];
  const calls: GenerationRequest[] = [];
  return {
    identity: 'fake:deterministic-v1',
    calls,
    async generate(request) {
      calls.push(request);
      if (request.signal?.aborted) throw new AiFailure('CANCELLED');
      const next = remaining.shift();
      if (next instanceof AiFailure) throw next;
      if (next === undefined) throw new AiFailure('CONFIGURATION');
      return { text: next };
    },
  };
}
