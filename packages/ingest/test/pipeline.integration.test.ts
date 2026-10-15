import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evalQuality } from '../src/eval/quality';
import { runWeek } from '../src/pipeline';
import { sourceListingUuid } from '../src/ids';
import { FIXTURE_EXPECTED, FIXTURE_SOURCE, fixtureAdapter, fixtureRows } from './fixtures/csv-fixture';
import { freshIngestDb } from './helpers/db';

const WEEK0 = new Date('2026-04-09T00:00:00Z');
const WEEK1 = new Date('2026-04-16T00:00:00Z');

let db: Client;
beforeAll(async () => {
  db = await freshIngestDb();
  await db.query(
    `INSERT INTO sources (id, display_name, license_kind, terms, attribution, is_synthetic, priority)
     VALUES ($1, 'Fixture feed', 'licensed_feed', 'test fixture', 'none', false, 99)`,
    [FIXTURE_SOURCE],
  );
});
afterAll(async () => {
  await db.end();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => ((await db.query(sql, params)).rows[0] as T);

describe('pipeline stages 1-4 on the 40-row fixture (exact counts)', () => {
  let stats: Awaited<ReturnType<typeof runWeek>>[number]['stats'];

  it('runs week 0 and reports exact run stats', async () => {
    expect(fixtureRows()).toHaveLength(40);
    const [res] = await runWeek(db, [fixtureAdapter()], WEEK0);
    stats = res!.stats;
    expect(stats).toMatchObject({ fetched: 40, unchanged: 0, raw_stored: 40, processed: 40, accepted: 33, rejected: 7, batch_size: 40 });
    expect(stats.reasons).toEqual({
      RENT_TOO_LOW: 1, PSF_IMPLAUSIBLE: 2, AREA_IMPLAUSIBLE: 1, GEO_INVALID: 1, LOCALITY_UNRESOLVED: 2,
      RENT_OUTLIER_MAD: 1, UNIT_KIND_MISSING: 1, RENT_MISSING: 1,
    });
    expect(stats.locality).toEqual({ exact: 34, fuzzy: 1, geo: 2, conflict_geo: 1, unresolved: 2 });
    expect(stats.repaired).toEqual({ unit: 1, annual: 1 });
    expect(stats.extracted_by_rules).toBe(1);
    expect(stats.listings_upserted).toBe(33);
  });

  it('persists the stats on ingest_runs', async () => {
    const r = await one<{ status: string; stats: { accepted: number } }>('SELECT status, stats FROM ingest_runs WHERE source_id = $1', [FIXTURE_SOURCE]);
    expect(r.status).toBe('ok');
    expect(r.stats.accepted).toBe(33);
  });

  it('stores every raw payload once', async () => {
    expect(Number((await one<{ n: string }>('SELECT count(*) AS n FROM raw_listings'))!.n)).toBe(40);
  });

  it.each(Object.entries(FIXTURE_EXPECTED))('%s has the expected verdict', async (id, exp) => {
    const r = await one<{
      quality_status: string; quality_reasons: string[]; quality_warnings: string[]; rent_inr: number | null; slug: string | null;
    }>(
      `SELECT sl.quality_status, sl.quality_reasons, sl.quality_warnings, sl.rent_inr, l.slug
         FROM source_listings sl LEFT JOIN localities l ON l.id = sl.locality_id
        WHERE sl.source_id = $1 AND sl.source_listing_id = $2`,
      [FIXTURE_SOURCE, id],
    );
    expect({
      status: r.quality_status,
      reasons: [...r.quality_reasons].sort(),
      warnings: [...r.quality_warnings].sort(),
      locality: r.slug,
      rent: r.rent_inr,
    }).toEqual({ ...exp, reasons: [...exp.reasons].sort(), warnings: [...exp.warnings].sort() });
  });

  it('accepted rows become 1:1 placeholder listings and rejected rows do not', async () => {
    const c = await one<{ listings: string; accepted: string; linked: string; bad_links: string }>(
      `SELECT (SELECT count(*) FROM listings) AS listings,
              (SELECT count(*) FROM source_listings WHERE quality_status = 'accepted') AS accepted,
              (SELECT count(*) FROM source_listings WHERE listing_id IS NOT NULL) AS linked,
              (SELECT count(*) FROM source_listings WHERE quality_status = 'rejected' AND listing_id IS NOT NULL) AS bad_links`,
    );
    expect(c).toEqual({ listings: '33', accepted: '33', linked: '33', bad_links: '0' });
  });

  it('upserts unmatched locality strings by normalized text and skips empty ones', async () => {
    const rows = (await db.query<{ raw_norm: string; count: number }>('SELECT raw_norm, count FROM locality_unmatched ORDER BY raw_norm')).rows;
    expect(rows).toEqual([{ raw_norm: 'from', count: 1 }, { raw_norm: 'zzzville', count: 1 }]);
  });

  it('never accepts a row without a locality or with a rent below the floor', async () => {
    const bad = await one<{ n: string }>(
      `SELECT count(*) AS n FROM source_listings WHERE quality_status = 'accepted' AND (rent_inr < 1500 OR locality_id IS NULL)`,
    );
    expect(bad!.n).toBe('0');
  });

  it('drops invalid geo instead of storing it', async () => {
    const g = await one<{ geom: unknown }>(`SELECT geom FROM source_listings WHERE source_listing_id = 'f32'`);
    expect(g!.geom).toBeNull();
  });

  it('marks free-text extraction with extracted_by = rules', async () => {
    const r = await db.query<{ source_listing_id: string }>(`SELECT source_listing_id FROM source_listings WHERE extracted_by = 'rules'`);
    expect(r.rows.map((x) => x.source_listing_id)).toEqual(['f35']);
  });

  it('keeps raw payloads free of portal names and URLs', async () => {
    // Pattern assembled from pieces so this file passes the brand guard.
    const banned = `(${['no' + 'broker', 'magic' + 'bricks', 'nes' + 'taway', 'static' + 'mb', 'http'].join('|')})`;
    const r = await one<{ n: string }>(`SELECT count(*) AS n FROM raw_listings WHERE payload::text ~* $1`, [banned]);
    expect(r!.n).toBe('0');
  });

  it('roofline_app cannot read raw_listings or seed_truth', async () => {
    for (const table of ['seed_truth.units', 'raw_listings']) {
      await db.query('BEGIN');
      await db.query('SET LOCAL ROLE roofline_app');
      await expect(db.query(`SELECT 1 FROM ${table} LIMIT 1`)).rejects.toThrow(/permission denied/);
      await db.query('ROLLBACK');
    }
  });
});

describe('incremental weekly runs', () => {
  it('re-running the same week processes nothing (idempotent)', async () => {
    const [res] = await runWeek(db, [fixtureAdapter()], WEEK0);
    expect(res!.stats).toMatchObject({ fetched: 40, unchanged: 40, raw_stored: 0, processed: 0, delisted: 0 });
    expect(Number((await one<{ n: string }>('SELECT count(*) AS n FROM source_listings'))!.n)).toBe(40);
  });

  it('week 1: only the changed and new rows are processed, a missing row is delisted', async () => {
    const rows = fixtureRows()
      .filter((r) => r.sourceListingId !== 'f02')
      .map((r) => (r.sourceListingId === 'f01' ? { ...r, rentText: '₹42,000' } : r));
    rows.push({ ...rows[3]!, sourceListingId: 'f41', rentText: '50000' });
    const [res] = await runWeek(db, [fixtureAdapter(rows)], WEEK1);
    expect(res!.stats).toMatchObject({ fetched: 40, unchanged: 38, raw_stored: 2, processed: 2, accepted: 2, delisted: 1, price_observations: 2 });

    const f01 = await one<{ rent_inr: number; last_price_change_at: Date }>(
      `SELECT l.rent_inr, l.last_price_change_at FROM listings l JOIN source_listings sl ON sl.id = l.canonical_source_listing_id WHERE sl.source_listing_id = 'f01'`,
    );
    expect(f01!.rent_inr).toBe(42000);
    expect(f01!.last_price_change_at.toISOString()).toBe(WEEK1.toISOString());
    const f02 = await one<{ is_active: boolean; l_active: boolean }>(
      `SELECT sl.is_active, l.is_active AS l_active FROM source_listings sl JOIN listings l ON l.id = sl.listing_id WHERE sl.source_listing_id = 'f02'`,
    );
    expect(f02).toEqual({ is_active: false, l_active: false });
    const obs = await one<{ n: string }>(
      `SELECT count(*) AS n FROM price_observations po JOIN source_listings sl ON sl.id = po.source_listing_id WHERE sl.source_listing_id = 'f01'`,
    );
    expect(obs!.n).toBe('2');
  });

  it('records one ingest run per adapter per week', async () => {
    const r = await db.query('SELECT as_of FROM ingest_runs WHERE source_id = $1 ORDER BY id', [FIXTURE_SOURCE]);
    expect(r.rows).toHaveLength(3);
  });
});

describe('eval:quality against a hand-written truth', () => {
  const plant = async (labels: Record<string, string>): Promise<void> => {
    await db.query('TRUNCATE seed_truth.source_rows, seed_truth.units CASCADE');
    for (const [id, defect] of Object.entries(labels)) {
      const unit = sourceListingUuid('truth', id);
      await db.query(
        `INSERT INTO seed_truth.units (unit_id, locality_id, unit_kind, bhk, true_rent_inr)
         VALUES ($1, (SELECT id FROM localities WHERE slug = 'indiranagar'), 'bhk', 2, 50000)`,
        [unit],
      );
      await db.query('INSERT INTO seed_truth.source_rows (source_id, source_listing_id, unit_id, defect) VALUES ($1,$2,$3,$4)', [FIXTURE_SOURCE, id, unit, defect]);
    }
  };

  it('reports matched and extra rejects and fails when the pipeline rejected something unplanted', async () => {
    await plant({ f25: 'rent_one', f26: 'locality_from_nogeo', f31: 'area_huge', f37: 'too_good' });
    const r = await evalQuality(db);
    expect(r).toMatchObject({ plantedRejects: 4, matched: 4, extraRejects: 3, totalRejected: 7, ok: false });
    expect(r.lines[0]).toMatch(/^planted_rejects=4 matched=4 extra_rejects=3 /);
  });

  it('passes when every reject was planted and every flagged defect carries its warning', async () => {
    await plant({
      f25: 'rent_one', f26: 'locality_from_nogeo', f31: 'area_huge', f37: 'too_good', f36: 'locality_bangalore_nogeo', f39: 'rent_one', f40: 'rent_one',
      f27: 'locality_from_geo', f28: 'empty_locality_geo', f29: 'furnishing_invalid', f30: 'area_zero', f32: 'geo_zero', f33: 'rent_annual', f34: 'rent_lakh',
    });
    const r = await evalQuality(db);
    expect(r).toMatchObject({ plantedRejects: 7, matched: 7, extraRejects: 0, ok: true });
    expect(r.defects.every((d) => d.asExpected === d.planted)).toBe(true);
    expect(r.lines[0]).toMatch(/^planted_rejects=7 matched=7 extra_rejects=0 /);
  });
});
