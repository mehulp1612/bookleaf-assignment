import { readFile } from 'node:fs/promises';
import { loadEnvironment } from './infrastructure/config.js';
import { createDatabase } from './infrastructure/database.js';
import { seedDemoData } from './seed-data.js';
import { seedFailureMessage, validateSeedCredentials, type SeedStage } from './seed-diagnostics.js';

let stage: SeedStage = 'environment';

async function main() {
  const env = loadEnvironment();
  stage = 'credentials';
  validateSeedCredentials(process.env);
  const database = createDatabase(env.DATABASE_URL);
  try {
    stage = 'sample data';
    const data: unknown = JSON.parse(
      await readFile(
        new URL('../../../FULLSTACK-SAMPLEDATA (1) (1) (1).json', import.meta.url),
        'utf8',
      ),
    );
    stage = 'database seed';
    const counts = await seedDemoData(database.client, data, process.env);
    console.log(
      `Demo seed complete: ${counts.users} users, ${counts.authors} authors, ${counts.books} books.`,
    );
  } finally {
    await database.close();
  }
}
main().catch((error: unknown) => {
  // Zod/SQL error detail can contain environment secrets; do not print it.
  console.error(seedFailureMessage(stage, error));
  process.exitCode = 1;
});
