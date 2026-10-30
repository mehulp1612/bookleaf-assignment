import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export interface DatabaseHealth {
  check(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string) {
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
    statement_timeout: 2000,
  });
  const client = new PrismaClient({ adapter, log: [] });
  return {
    client,
    async check(): Promise<void> {
      await client.$queryRaw`SELECT 1`;
    },
    async close(): Promise<void> {
      await client.$disconnect();
    },
  } satisfies DatabaseHealth & { client: PrismaClient };
}
