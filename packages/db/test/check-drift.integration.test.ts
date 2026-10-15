import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { freshTestDb } from './helpers.js';
import { findDrift } from '../src/check-drift.js';

let client: Client;
beforeAll(async () => {
  client = await freshTestDb();
});
afterAll(async () => {
  await client.end();
});

describe('findDrift', () => {
  it('reports no drift on a freshly migrated database', async () => {
    expect(await findDrift(client)).toEqual([]);
  });

  it('catches a column missing from the database', async () => {
    await client.query('BEGIN');
    try {
      await client.query('ALTER TABLE localities DROP COLUMN radius_m');
      const drift = await findDrift(client);
      expect(drift.join('\n')).toMatch(/localities\.radius_m.*missing/i);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('catches a missing table', async () => {
    await client.query('BEGIN');
    try {
      await client.query('DROP TABLE price_observations');
      expect((await findDrift(client)).join('\n')).toMatch(/price_observations.*missing/i);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('catches a column the Drizzle schema does not know about', async () => {
    await client.query('BEGIN');
    try {
      await client.query('ALTER TABLE localities ADD COLUMN surprise text');
      expect((await findDrift(client)).join('\n')).toMatch(/localities\.surprise.*not in drizzle/i);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('catches a type mismatch and a nullability mismatch', async () => {
    await client.query('BEGIN');
    try {
      await client.query('ALTER TABLE localities ALTER COLUMN base_2bhk_hint TYPE bigint');
      await client.query('ALTER TABLE localities ALTER COLUMN name DROP NOT NULL');
      const out = (await findDrift(client)).join('\n');
      expect(out).toMatch(/localities\.base_2bhk_hint.*type/i);
      expect(out).toMatch(/localities\.name.*nullab/i);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('catches enum label drift', async () => {
    await client.query('BEGIN');
    try {
      await client.query("ALTER TYPE furnishing ADD VALUE 'bare'");
      expect((await findDrift(client)).join('\n')).toMatch(/enum furnishing/i);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
