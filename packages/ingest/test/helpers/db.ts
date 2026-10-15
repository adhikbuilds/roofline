import { Client } from 'pg';
import { loadEnv } from '@roofline/db';
import { runMigrations } from '@roofline/db/migrator';
import { loadReference } from '@roofline/db/load-reference';

loadEnv();

const DB_NAME = 'roofline_ingest_test';

/**
 * A private database for ingest integration tests, so they never race the db package's tests, which drop
 * the schema of roofline_test. Created on demand, wiped, migrated and loaded with reference data.
 */
export async function freshIngestDb(): Promise<Client> {
  const base = process.env['DATABASE_URL_TEST'];
  if (!base || !/roofline_test/.test(base)) throw new Error('DATABASE_URL_TEST must point at roofline_test (see .env.example)');
  const admin = new Client({ connectionString: base });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${DB_NAME}`);
  } finally {
    await admin.end();
  }
  const client = new Client({ connectionString: base.replace(/roofline_test(?!\w)/, DB_NAME) });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS seed_truth CASCADE');
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  await runMigrations(client);
  await loadReference(client);
  return client;
}
