import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type pg from 'pg';

export function repositoryRoot() {
  return process.cwd().replaceAll('\\', '/').endsWith('/apps/api')
    ? resolve('../..')
    : process.cwd();
}
export async function applyTestMigrations(
  connection: pg.Client,
  afterMigration?: (name: string) => Promise<void>,
) {
  const directory = resolve(repositoryRoot(), 'apps/api/prisma/migrations');
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries
    .filter((value) => value.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    await connection.query(await readFile(resolve(directory, entry.name, 'migration.sql'), 'utf8'));
    await afterMigration?.(entry.name);
  }
}
