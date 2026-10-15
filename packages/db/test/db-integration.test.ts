import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { freshTestDb } from './helpers.js';
import { loadReference } from '../src/load-reference.js';
import { nearestLocality } from '../src/queries/locality.js';

let client: Client;
beforeAll(async () => {
  client = await freshTestDb();
});
afterAll(async () => {
  await client.end();
});

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ['localities', 'locality_aliases', 'metro_stations', 'metro_edges', 'work_presets', 'sources']) {
    const r = await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${t}`);
    out[t] = Number(r.rows[0]?.n);
  }
  return out;
}

describe('migrations 0002-0004', () => {
  it('create the reference, ingest and listing tables', async () => {
    const r = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    );
    const names = r.rows.map((x) => x.table_name);
    for (const t of ['localities', 'locality_aliases', 'locality_unmatched', 'metro_stations', 'metro_edges',
      'work_presets', 'sources', 'ingest_runs', 'raw_listings', 'source_listings', 'price_observations',
      'listings', 'listing_redirects', 'dedup_pairs', 'model_runs', 'fair_rent_estimates'])
      expect(names).toContain(t);
    const s = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='seed_truth'",
    );
    expect(s.rows.map((x) => x.table_name).sort()).toEqual(['model_run_eval', 'source_rows', 'true_deals', 'true_rent', 'units']);
  });

  it('create GIST indexes on geography columns', async () => {
    const r = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexdef ILIKE '%USING gist%'",
    );
    const names = r.rows.map((x) => x.indexname);
    for (const i of ['localities_centroid_gist', 'metro_stations_geom_gist', 'source_listings_geom_gist', 'listings_geom_gist'])
      expect(names).toContain(i);
  });

  it('enforce a single active model run', async () => {
    const ins = "INSERT INTO model_runs (kind, engine_version, as_of, artifact, is_active) VALUES ('hedonic','t',now(),'{}',$1)";
    await client.query(ins, [true]);
    await expect(client.query(ins, [true])).rejects.toThrow(/model_runs_one_active_idx/);
    await client.query(ins, [false]);
    await client.query('DELETE FROM model_runs');
  });

  it('generates move_in_inr = rent + deposit, null when deposit is null', async () => {
    await client.query(`INSERT INTO sources (id, display_name, license_kind, terms, attribution)
      VALUES ('t','T','x','x','x')`);
    await client.query(`INSERT INTO localities (slug, name, zone, centroid, radius_m)
      VALUES ('t','T','central', ST_SetSRID(ST_MakePoint(77.6,12.97),4326)::geography, 500)`);
    const sl = await client.query<{ id: string }>(`INSERT INTO source_listings
      (source_id, source_listing_id, unit_kind, quality_status) VALUES ('t','1','bhk','accepted') RETURNING id`);
    const id = sl.rows[0]?.id;
    for (const [dep, expected] of [[50000, 80000], [null, null]] as const) {
      const r = await client.query<{ m: number | null }>(
        `INSERT INTO listings (canonical_source_listing_id, unit_kind, rent_inr, deposit_inr, locality_id)
         VALUES ($1,'bhk',30000,$2,(SELECT id FROM localities WHERE slug='t')) RETURNING move_in_inr AS m`,
        [id, dep],
      );
      expect(r.rows[0]?.m).toBe(expected);
    }
    await client.query('DELETE FROM listings');
    await client.query('DELETE FROM source_listings');
    await client.query("DELETE FROM localities WHERE slug='t'");
    await client.query("DELETE FROM sources WHERE id='t'");
  });
});

describe('loadReference', () => {
  it('loads 69 localities and the other reference sets', async () => {
    await loadReference(client);
    const c = await counts();
    expect(c['localities']).toBe(69);
    expect(c['work_presets']).toBeGreaterThanOrEqual(7);
    expect(c['sources']).toBe(5);
    expect(c['metro_stations']).toBe(40);
    expect(c['locality_aliases']).toBeGreaterThanOrEqual(100);
    // ride edges both directions: (14+14+9)*2 = 74, plus 2 interchanges * 2 directions = 4
    expect(c['metro_edges']).toBe(78);
  });

  it('is idempotent: loading twice leaves identical counts', async () => {
    const first = await counts();
    await loadReference(client);
    expect(await counts()).toEqual(first);
  });

  it('refreshes changed rows instead of duplicating them', async () => {
    await client.query("UPDATE localities SET radius_m = 1 WHERE slug = 'koramangala'");
    await loadReference(client);
    const r = await client.query<{ radius_m: number }>("SELECT radius_m FROM localities WHERE slug='koramangala'");
    expect(r.rows[0]?.radius_m).toBe(1600);
  });

  it('resolves aliases to the right locality', async () => {
    const r = await client.query<{ slug: string }>(
      `SELECT l.slug FROM locality_aliases a JOIN localities l ON l.id = a.locality_id WHERE a.alias_norm = 'whitefeild'`,
    );
    expect(r.rows[0]?.slug).toBe('whitefield');
  });

  it('links interchange stations with 6-minute edges', async () => {
    const r = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM metro_edges WHERE kind = 'interchange' AND minutes = 6");
    expect(Number(r.rows[0]?.n)).toBe(4);
  });

  it('keeps every stored centroid inside the bbox', async () => {
    const r = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM localities WHERE NOT (
         ST_Y(centroid::geometry) BETWEEN 12.70 AND 13.25 AND ST_X(centroid::geometry) BETWEEN 77.35 AND 77.85)`);
    expect(Number(r.rows[0]?.n)).toBe(0);
  });

  it('holds no locality named From, Bangalore or Bengaluru', async () => {
    const r = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM localities WHERE lower(name) IN ('from','bangalore','bengaluru')");
    expect(Number(r.rows[0]?.n)).toBe(0);
  });
});

describe('roofline_app privileges', () => {
  async function asApp<T>(sql: string): Promise<T> {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE roofline_app');
      const r = await client.query(sql);
      return r.rows as T;
    } finally {
      await client.query('ROLLBACK');
    }
  }
  const denied = async (sql: string) => {
    await expect(asApp(sql)).rejects.toMatchObject({ code: '42501' });
  };

  it('cannot read seed_truth tables or the schema', async () => {
    for (const t of ['units', 'source_rows', 'true_rent', 'true_deals'])
      await denied(`SELECT 1 FROM seed_truth.${t} LIMIT 1`);
  });
  it('cannot read raw_listings', () => denied('SELECT 1 FROM raw_listings LIMIT 1'));
  it('cannot read dedup_pairs', () => denied('SELECT 1 FROM dedup_pairs LIMIT 1'));
  it('can read reference data and listings', async () => {
    const rows = await asApp<{ n: string }[]>('SELECT count(*) AS n FROM localities');
    expect(Number(rows[0]?.n)).toBe(69);
    await asApp('SELECT 1 FROM listings LIMIT 1');
    await asApp('SELECT 1 FROM source_listings LIMIT 1');
  });
  it('cannot write reference data', () => denied("UPDATE localities SET name = 'x'"));
  it('has no privilege at all on seed_truth or raw_listings (catalog check)', async () => {
    const r = await client.query<{ ok: boolean }>(`SELECT
      has_table_privilege('roofline_app','public.raw_listings','SELECT')
      OR has_table_privilege('roofline_app','seed_truth.units','SELECT')
      OR has_schema_privilege('roofline_app','seed_truth','USAGE') AS ok`);
    expect(r.rows[0]?.ok).toBe(false);
  });
});

describe('nearestLocality', () => {
  it('returns Koramangala for a point on its centroid', async () => {
    const hit = await nearestLocality(12.9352, 77.6245, client);
    expect(hit?.slug).toBe('koramangala');
    expect(hit?.distanceM).toBeLessThan(5);
  });
  it('picks the nearest of several candidates', async () => {
    expect((await nearestLocality(12.9698, 77.75, client))?.slug).toBe('whitefield');
    expect((await nearestLocality(12.845, 77.66, client))?.slug).toBe('electronic-city');
    expect((await nearestLocality(13.1, 77.5963, client))?.slug).toBe('yelahanka');
  });
  it('returns the id, name and a positive distance for an off-centroid point', async () => {
    const hit = await nearestLocality(12.94, 77.63, client);
    expect(hit).toMatchObject({ name: expect.any(String), id: expect.any(Number) });
    expect(hit?.distanceM).toBeGreaterThan(0);
  });
  it('is not injectable: coordinates are bound parameters, bad input is rejected', async () => {
    await expect(nearestLocality(Number.NaN, 77.6, client)).rejects.toThrow(/lat/i);
    await expect(nearestLocality(12.9, Number.POSITIVE_INFINITY, client)).rejects.toThrow(/lng/i);
    await expect(nearestLocality(91, 77.6, client)).rejects.toThrow(/lat/i);
    await expect(nearestLocality("1'; DROP TABLE localities; --" as unknown as number, 77.6, client)).rejects.toThrow(/lat/i);
    expect((await client.query('SELECT count(*) FROM localities')).rows).toHaveLength(1);
  });
  it('returns null when there are no localities', async () => {
    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM localities');
      expect(await nearestLocality(12.97, 77.6, client)).toBeNull();
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
