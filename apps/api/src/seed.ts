import { readFile } from 'node:fs/promises';
import { loadEnvironment } from './infrastructure/config.js';
import { createDatabase } from './infrastructure/database.js';
import { seedDemoData } from './seed-data.js';
import { seedFailureMessage, validateSeedCredentials, type SeedStage } from './seed-diagnostics.js';

let stage: SeedStage = 'environment';

function progress(next: SeedStage) {
  stage = next;
  console.log(`Demo seed: ${stage}.`);
}

function reportFailure(error: unknown) {
  console.error(seedFailureMessage(stage, error));
  process.exitCode = 1;
}

async function main() {
  progress('environment');
  const env = loadEnvironment();
  progress('credentials');
  validateSeedCredentials(process.env);
  const database = createDatabase(env.DATABASE_URL);
  try {
    progress('sample data');
    const data: unknown = JSON.parse(
      await readFile(
        new URL('../../../FULLSTACK-SAMPLEDATA (1) (1) (1).json', import.meta.url),
        'utf8',
      ),
    );
    progress('database connection');
    await database.check();
    progress('database seed');
    const counts = await seedDemoData(database.client, data, process.env, progress);
    console.log(
      `Demo seed complete: ${counts.users} users, ${counts.authors} authors, ${counts.books} books.`,
    );
  } catch (error: unknown) {
    // Report before disconnect: a stalled cleanup must not hide the original failure.
    reportFailure(error);
  } finally {
    progress('database cleanup');
    const timeout = setTimeout(() => {
      console.error('Demo seed: database cleanup exceeded 10 seconds; terminating with failure.');
      process.exit(1);
    }, 10000);
    try {
      await database.close();
    } finally {
      clearTimeout(timeout);
    }
  }
}
main().catch(reportFailure);
