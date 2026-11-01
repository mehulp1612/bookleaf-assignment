import { readFile } from 'node:fs/promises';
import { loadEnvironment } from './infrastructure/config.js';
import { createDatabase } from './infrastructure/database.js';
import { importCatalog } from './modules/catalog/import.js';

async function main() {
  const database = createDatabase(loadEnvironment().DATABASE_URL);
  try {
    const raw: unknown = JSON.parse(
      await readFile(
        new URL('../../../FULLSTACK-SAMPLEDATA (1) (1) (1).json', import.meta.url),
        'utf8',
      ),
    );
    const result = await importCatalog(database.client, raw);
    console.log(
      `Catalog imported: ${result.authors} authors, ${result.books} books. Login credentials unchanged.`,
    );
  } finally {
    await database.close();
  }
}
main().catch(() => {
  console.error(
    'Catalog import failed. Check migrations and sample data. No data values are printed.',
  );
  process.exitCode = 1;
});
