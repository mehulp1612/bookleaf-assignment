import { readFile } from 'node:fs/promises';
import { loadEnvironment } from './infrastructure/config.js';
import { createDatabase } from './infrastructure/database.js';
import { seedDemoData } from './seed-data.js';

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
    const counts = await seedDemoData(database.client, data, process.env);
    console.log(
      `Demo seed complete: ${counts.users} users, ${counts.authors} authors, ${counts.books} books.`,
    );
  } finally {
    await database.close();
  }
}
main().catch(() => {
  // Zod/SQL error detail can contain environment secrets; do not print it.
  console.error(
    'Demo seed failed. Check migrations, sample data, and demo environment configuration. No credentials are printed.',
  );
  process.exitCode = 1;
});
