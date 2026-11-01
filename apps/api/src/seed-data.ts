import type { PrismaClient } from './generated/prisma/client.js';
import { prepareIdentitySeed, writeIdentitySeed } from './modules/auth/seed.js';
import { catalogImportSchema, writeCatalog } from './modules/catalog/import.js';

// Validate and hash outside the transaction; commit identities and catalog together.
export async function seedDemoData(client: PrismaClient, raw: unknown, credentials: unknown) {
  const catalog = catalogImportSchema.parse(raw);
  const identities = await prepareIdentitySeed(raw, credentials);
  return client.$transaction(
    async (tx) => {
      const counts = await writeCatalog(tx, catalog);
      const identityCounts = await writeIdentitySeed(tx, identities);
      return { ...counts, users: identityCounts.users };
    },
    { isolationLevel: 'Serializable', timeout: 15000 },
  );
}
