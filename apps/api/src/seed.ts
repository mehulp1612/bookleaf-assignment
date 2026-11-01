import { readFile } from 'node:fs/promises';
import { loadEnvironment } from './infrastructure/config.js';
import { createDatabase } from './infrastructure/database.js';
import { seedIdentity } from './modules/auth/seed.js';

async function main() {
  const env = loadEnvironment();
  const database = createDatabase(env.DATABASE_URL);
  try {
    const data: unknown = JSON.parse(
      await readFile(
        new URL('../../../FULLSTACK-SAMPLEDATA (1) (1) (1).json', import.meta.url),
        'utf8',
      ),
    );
    const counts = await seedIdentity(database.client, data, process.env);
    console.log(
      `Demo identity seed complete: ${counts.users} users, ${counts.authors} author identities. No books imported.`,
    );
  } finally {
    await database.close();
  }
}
main().catch(() => {
  // Zod/SQL error detail can contain environment secrets; do not print it.
  console.error(
    'Identity seed failed. Check migrations, sample data, and demo environment configuration. No credentials are printed.',
  );
  process.exitCode = 1;
});
