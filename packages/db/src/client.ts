import { Pool, type PoolClient } from 'pg';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Walk up from cwd loading `.env.local` then `.env` (first value wins, host env beats both).
 * import.meta.dirname is unavailable once bundled by Next, so we resolve from cwd, which finds
 * the repo-root file for both package scripts and the web server.
 */
export function loadEnv(startDir: string = process.cwd()): void {
  if (process.env['DATABASE_URL']) return;
  let dir = startDir;
  for (let depth = 0; depth < 6; depth++) {
    let found = false;
    for (const name of ['.env.local', '.env']) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        config({ path: candidate, quiet: true });
        found = true;
      }
    }
    if (found) return;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadEnv();

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local at the repository root, then run `pnpm db:up`.',
  );
}
const DSN: string = connectionString;

const isLocalHost = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DSN);

export const pool = new Pool({
  connectionString: DSN,
  // TLS for anything that is not localhost, regardless of sslmode in the URL.
  ssl: isLocalHost ? undefined : { rejectUnauthorized: true },
  max: 10,
});

export const isRemote = !isLocalHost;

/** Pooled (transaction-mode) endpoints break SET ROLE and advisory locks; migrations must avoid them. */
export const isPooledEndpoint = /-pooler\./.test(DSN);

export function describeTarget(): string {
  const host = /@([^/:]+)/.exec(DSN)?.[1] ?? 'unknown host';
  return `${host}${isPooledEndpoint ? ' (pooled)' : ''}`;
}

/**
 * Run work in a transaction as the unprivileged `roofline_app` role with the user id set.
 * SET LOCAL scopes both to this transaction so a pooled connection cannot leak context.
 */
export async function withUser<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE roofline_app');
    await client.query('SELECT set_config($1, $2, true)', ['roofline.user_id', userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Admin work (migrations, ingest, seeding). Runs as owner and bypasses RLS. */
export async function withAdmin<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function close(): Promise<void> {
  await pool.end();
}
