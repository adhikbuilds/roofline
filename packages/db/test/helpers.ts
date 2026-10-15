import { Client } from 'pg';
import { loadEnv } from '../src/client.js';
import { runMigrations } from '../src/migrator.js';

loadEnv();

export function testUrl(): string {
  const url = process.env['DATABASE_URL_TEST'];
  if (!url) throw new Error('DATABASE_URL_TEST is not set (see .env.example)');
  if (!/roofline_test/.test(url)) throw new Error('DATABASE_URL_TEST must point at roofline_test');
  return url;
}

/** Connect to roofline_test, wipe public + seed_truth, apply every migration. */
export async function freshTestDb(): Promise<Client> {
  const client = new Client({ connectionString: testUrl() });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS seed_truth CASCADE');
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  await runMigrations(client);
  return client;
}
