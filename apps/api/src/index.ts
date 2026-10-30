import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { ConfigurationError, loadEnvironment } from './infrastructure/config.js';
import { createDatabase } from './infrastructure/database.js';

async function main() {
  const env = loadEnvironment();
  const database = createDatabase(env.DATABASE_URL);
  const app = await buildApp({
    database,
    logLevel: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'production'
      ? { webRoot: fileURLToPath(new URL('../../web/dist', import.meta.url)) }
      : {}),
  });
  const shutdown = async () => {
    try {
      await app.close();
    } catch {
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
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
