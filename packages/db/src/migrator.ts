import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../migrations');

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

/** Apply numbered SQL migrations in order. Refuses migrations edited after being applied. */
export async function runMigrations(
  client: Pick<PoolClient, 'query'>,
  opts: { dir?: string; log?: (line: string) => void } = {},
): Promise<{ applied: string[]; skipped: string[] }> {
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const log = opts.log ?? (() => {});
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await client.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  const known = new Map(rows.map((r) => [r.name, r.checksum]));
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sql = await readFile(resolve(dir, file), 'utf8');
    const checksum = checksumOf(sql);
    const previous = known.get(file);

    if (previous === checksum) {
      log(`  = ${file}`);
      skipped.push(file);
      continue;
    }
    if (previous !== undefined) {
      throw new Error(
        `${file} has changed since it was applied (${previous} -> ${checksum}). ` +
          `Add a new migration instead of editing this one, or run \`pnpm db:reset\` locally.`,
      );
    }

    log(`  + ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`${file} failed: ${(error as Error).message}`, { cause: error });
    }
    applied.push(file);
  }

  log(`\nSchema up to date (${files.length} migration${files.length === 1 ? '' : 's'}).`);
  return { applied, skipped };
}
