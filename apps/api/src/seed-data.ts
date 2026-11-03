import type { PrismaClient } from './generated/prisma/client.js';
import { prepareIdentitySeed, writeIdentitySeed } from './modules/auth/seed.js';
import { catalogImportSchema, writeCatalog } from './modules/catalog/import.js';

// Validate and hash outside the transaction; commit identities and catalog together.
export async function seedDemoData(
  client: PrismaClient,
  raw: unknown,
  credentials: unknown,
  progress: (stage: 'password hashing' | 'database seed') => void = () => {},
) {
  const catalog = catalogImportSchema.parse(raw);
  progress('password hashing');
  const identities = await prepareIdentitySeed(raw, credentials);
  progress('database seed');
  return client.$transaction(
    async (tx) => {
      const counts = await writeCatalog(tx, catalog);
      const identityCounts = await writeIdentitySeed(tx, identities);
      return { ...counts, users: identityCounts.users };
    },
    // Startup-only batch: dozens of sequential writes can exceed 15s over a hosted link.
    // Keep all-or-nothing semantics and a finite bound; API transaction limits are unchanged.
    { isolationLevel: 'Serializable', maxWait: 10000, timeout: 120000 },
  );
}
