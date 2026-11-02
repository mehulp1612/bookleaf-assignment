import type { PrismaClient } from '../../generated/prisma/client.js';
import { parseAiConfig } from './config.js';
import { createChatProvider } from './provider.js';
import { createAiService } from './service.js';
import { createPrismaAiRunStore } from './store.js';

// M06 will call this after loading root environment configuration. No worker/HTTP side effects.
export function createConfiguredAiService(
  client: PrismaClient,
  values: Record<string, string | undefined> = process.env,
) {
  const config = parseAiConfig(values);
  return createAiService({
    config,
    provider: createChatProvider(config),
    store: createPrismaAiRunStore(client),
  });
}
