import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { ConfigurationError, loadEnvironment } from './infrastructure/config.js';
import { createDatabase } from './infrastructure/database.js';
import { createPrismaAuthStore } from './modules/auth/prisma-store.js';
import { createCatalogService } from './modules/catalog/service.js';
import { createTicketService } from './modules/tickets/service.js';
import { parseAiConfig } from './modules/ai/config.js';
import { createAiService } from './modules/ai/service.js';
import { createChatProvider } from './modules/ai/provider.js';
import { createPrismaAiRunStore } from './modules/ai/store.js';
import { parseJobConfig, providerKey } from './modules/jobs/config.js';
import { createJobService } from './modules/jobs/service.js';
import { createJobRunner } from './modules/jobs/runner.js';

async function main() {
  const env = loadEnvironment();
  const database = createDatabase(env.DATABASE_URL);
  const catalog = createCatalogService(database.client);
  const tickets = createTicketService(database.client, catalog);
  let aiConfig;
  let jobConfig;
  try {
    aiConfig = parseAiConfig(process.env);
    jobConfig = parseJobConfig(process.env);
  } catch {
    console.warn(
      'AI configuration is invalid; AI is disabled. Manual ticket handling remains available.',
    );
    aiConfig = parseAiConfig({});
    jobConfig = parseJobConfig({});
  }
  const ai = createAiService({
    config: aiConfig,
    provider: createChatProvider(aiConfig),
    store: createPrismaAiRunStore(database.client),
  });
  const jobs = createJobService({
    client: database.client,
    ai,
    tickets,
    config: jobConfig,
    providerKey: providerKey(aiConfig),
    providerEnabled: aiConfig.AI_PROVIDER !== 'disabled',
    timeoutMs: aiConfig.AI_TIMEOUT_MS,
  });
  const runner = createJobRunner(jobs, jobConfig, () =>
    console.warn(
      'AI worker storage operation failed; it will retry. Manual ticket handling remains available.',
    ),
  );
  const app = await buildApp({
    database,
    logLevel: env.LOG_LEVEL,
    catalog,
    tickets,
    jobs,
    runner,
    auth: {
      store: createPrismaAuthStore(database.client),
      appOrigin: env.APP_ORIGIN,
      production: env.NODE_ENV === 'production',
      sessionTtlSeconds: env.SESSION_TTL_SECONDS,
    },
    ...(env.NODE_ENV === 'production'
      ? { webRoot: fileURLToPath(new URL('../../web/dist', import.meta.url)) }
      : {}),
  });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Watchers may retain IPC handles after the HTTP server closes. Explicitly finish
    // after graceful cleanup so a restart cannot leave a non-listening child alive.
    const deadline = setTimeout(() => process.exit(1), 4000);
    deadline.unref();
    let exitCode = 0;
    try {
      await app.close();
    } catch {
      exitCode = 1;
    }
    clearTimeout(deadline);
    process.exit(exitCode);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    runner.start();
  } catch {
    await app.close();
    throw new Error('API startup failed. Check the host, port, and production build.');
  }
}

main().catch((error: unknown) => {
  // Configuration or dependency errors can contain secrets; keep startup output safe.
  console.error(
    error instanceof ConfigurationError
      ? error.message
      : 'API could not start. Check environment configuration and build prerequisites.',
  );
  process.exitCode = 1;
});
