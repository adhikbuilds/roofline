import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { runMigrations } from '../src/migrator.js';
import { loadEnv } from '../src/client.js';

loadEnv();
const url = process.env['DATABASE_URL_TEST'];
if (!url) throw new Error('DATABASE_URL_TEST is not set (see .env.example)');
if (!/roofline_test/.test(url)) throw new Error('DATABASE_URL_TEST must point at roofline_test');

const client = new Client({ connectionString: url });

beforeAll(async () => {
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS seed_truth CASCADE');
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
});
afterAll(async () => {
  await client.end();
});

describe('migrations', () => {
  it('applies on a clean database and creates extensions, role and seed_truth', async () => {
    const first = await runMigrations(client);
    expect(first.applied).toContain('0001_extensions_roles.sql');

    const ext = await client.query<{ extname: string }>('SELECT extname FROM pg_extension');
    const names = ext.rows.map((r) => r.extname);
    for (const e of ['postgis', 'pg_trgm', 'citext', 'pgcrypto']) expect(names).toContain(e);

    const role = await client.query(
      "SELECT rolcanlogin FROM pg_roles WHERE rolname = 'roofline_app'",
    );
    expect(role.rows[0]?.rolcanlogin).toBe(false);

    const usage = await client.query<{ ok: boolean }>(
      "SELECT has_schema_privilege('roofline_app', 'seed_truth', 'USAGE') AS ok",
    );
    expect(usage.rows[0]?.ok).toBe(false);
  });

  it('is idempotent: a second run applies nothing and logs "=" and "Schema up to date"', async () => {
    const lines: string[] = [];
    const second = await runMigrations(client, { log: (l) => lines.push(l) });
    expect(second.applied).toEqual([]);
    expect(lines.some((l) => l.startsWith('  = 0001'))).toBe(true);
    expect(lines.join('\n')).toContain('Schema up to date');
  });

  it('refuses a migration whose recorded checksum no longer matches', async () => {
    await client.query("UPDATE schema_migrations SET checksum = 'deadbeefdeadbeef'");
    await expect(runMigrations(client)).rejects.toThrow(/has changed since it was applied/);
  });
});
