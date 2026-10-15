/**
 * Stage 5 must not leave a stale fair-rent verdict behind. After stages 6-7 have scored the seed, an incremental
 * week changes one deal's rent: the listings upsert has to clear that listing's fair + deal + provenance columns
 * (in the same statement), while every listing whose scored inputs did not change keeps its verdict.
 * Also covers the migration-0007 provenance CHECK constraints.
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fitRobustMedian, predictRobustMedian } from '@roofline/engine';
import type { RobustMedianArtifact } from '@roofline/engine';
import type { RawListing, SourceAdapter } from '../src/adapter';
import { createSyntheticAdapters, generateSeed, weekAsOf, WEEKS } from '../src/adapters/synthetic';
import { runModelStages } from '../src/pipeline/fairrent';
import type { ArtifactLike, CvLike, Models } from '../src/pipeline/fairrent';
import { runWeek } from '../src/pipeline';
import { loadSeedRefs, seedSynthetic } from '../src/seed';
import { freshIngestDb } from './helpers/db';

const cvStub = (m: number): CvLike => ({ n: 100, mdapeObs: m, coverageObs: 0.66, mdapeObsBadged: m, nBadged: 90, mdapeTruth: 0.05, coverageTruth: 0.7 });
const stubModels: Models = {
  crossValidate: () => ({ robustMedian: cvStub(0.08), hedonic: cvStub(0.07), active: 'hedonic' }),
  fitRobustMedian: (rows, o) => fitRobustMedian(rows, o) as unknown as ArtifactLike,
  fitHedonic: (rows, o) => ({ ...(fitRobustMedian(rows, o) as unknown as ArtifactLike), kind: 'hedonic' }),
  predict: (a, x, o) => predictRobustMedian({ ...a, kind: 'robust_median' } as unknown as RobustMedianArtifact, x, o),
};

const FAIR_COLS = [
  'fair_rent_inr', 'fair_low_inr', 'fair_high_inr', 'fair_delta_pct', 'badge', 'confidence', 'fair_explanation',
  'fair_model_run_id', 'fair_engine_version', 'deal_score', 'deal_reason',
] as const;
const FAIR_SQL = FAIR_COLS.join(', ');

let db: Client;
let dealId: string;
let dealNewRent: number;
let dealOldRent: number;
let nudgedId: string;
let nudgedBefore: Record<string, unknown>;
let snapshotBefore: Map<string, string>;
let dealsBefore: number;
let weekStats: Awaited<ReturnType<typeof runWeek>>;

const snapshot = async (excluding: string[]): Promise<Map<string, string>> => {
  const r = await db.query<{ id: string; h: string }>(
    `SELECT id, md5(row(${FAIR_SQL}, is_deal)::text) AS h FROM listings WHERE NOT (id = ANY($1::uuid[]))`,
    [excluding],
  );
  return new Map(r.rows.map((x) => [x.id, x.h]));
};

beforeAll(async () => {
  db = await freshIngestDb('roofline_ingest_fairreset_test');
  await seedSynthetic(db);
  await runModelStages(db, { models: stubModels });

  const deal = await db.query<{ id: string; rent_inr: number; fair_rent_inr: number; source_id: string; source_listing_id: string }>(
    `SELECT l.id, l.rent_inr, l.fair_rent_inr, sl.source_id, sl.source_listing_id
       FROM listings l JOIN source_listings sl ON sl.id = l.canonical_source_listing_id
      WHERE l.is_deal AND l.member_count = 1 AND l.is_active ORDER BY l.id LIMIT 1`,
  );
  expect(deal.rows, 'seed must contain a singleton deal').toHaveLength(1);
  const d = deal.rows[0] as (typeof deal.rows)[number];
  dealId = d.id;
  dealOldRent = d.rent_inr;
  dealNewRent = d.fair_rent_inr; // rent rises to the fair rent: no longer a deal
  expect(dealNewRent).toBeGreaterThan(dealOldRent);

  // a second, scored singleton gets a change that no model reads (geo nudge of ~11 m)
  const other = await db.query<{ id: string; source_id: string; source_listing_id: string }>(
    `SELECT l.id, sl.source_id, sl.source_listing_id
       FROM listings l JOIN source_listings sl ON sl.id = l.canonical_source_listing_id
      WHERE l.fair_rent_inr IS NOT NULL AND l.member_count = 1 AND l.is_active AND l.id <> $1 AND sl.geom IS NOT NULL
      ORDER BY l.id LIMIT 1`,
    [dealId],
  );
  expect(other.rows, 'seed must contain a second scored singleton').toHaveLength(1);
  const o = other.rows[0] as (typeof other.rows)[number];
  nudgedId = o.id;
  nudgedBefore = (await db.query(`SELECT ${FAIR_SQL}, is_deal, ST_AsText(geom::geometry) AS g FROM listings WHERE id = $1`, [nudgedId])).rows[0];

  snapshotBefore = await snapshot([dealId, nudgedId]);
  dealsBefore = Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM listings WHERE is_deal')).rows[0]?.n);

  // replay the final seeded week under a later as-of (no delisting), with the two edits
  const { refs } = await loadSeedRefs(db);
  const inner = createSyntheticAdapters(generateSeed(refs));
  const wrapped: SourceAdapter[] = inner.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    license: a.license,
    async *fetch({ signal }) {
      for await (const r of a.fetch({ asOf: weekAsOf(WEEKS - 1), signal })) {
        let row: RawListing = r;
        if (a.id === d.source_id && r.sourceListingId === d.source_listing_id) row = { ...r, rentText: String(dealNewRent) };
        if (a.id === o.source_id && r.sourceListingId === o.source_listing_id && r.lat !== undefined) row = { ...r, lat: r.lat + 0.0001 };
        yield row;
      }
    },
  }));
  weekStats = await runWeek(db, wrapped, weekAsOf(WEEKS));
}, 480_000);

afterAll(async () => {
  await db.end();
});

describe('incremental week after stages 6-7', () => {
  it('ran incrementally, and the edits landed on the same, still-accepted listings', async () => {
    const stats = weekStats[0]?.stats;
    expect(stats?.dedup).toMatchObject({ mode: 'incremental' });
    const l = await db.query<{ is_active: boolean; rent_inr: number; q: string }>(
      `SELECT l.is_active, l.rent_inr, sl.quality_status AS q FROM listings l JOIN source_listings sl ON sl.id = l.canonical_source_listing_id WHERE l.id = $1`,
      [dealId],
    );
    expect(l.rows[0]).toEqual({ is_active: true, rent_inr: dealNewRent, q: 'accepted' });
  });

  it('clears every fair, deal and provenance column on the listing whose rent changed', async () => {
    const r = await db.query(`SELECT ${FAIR_SQL}, is_deal, rent_inr FROM listings WHERE id = $1`, [dealId]);
    expect(r.rows[0]).toEqual({
      fair_rent_inr: null, fair_low_inr: null, fair_high_inr: null, fair_delta_pct: null, badge: null, confidence: null,
      fair_explanation: null, fair_model_run_id: null, fair_engine_version: null, deal_score: null, deal_reason: null,
      is_deal: false, rent_inr: dealNewRent,
    });
    expect(dealOldRent).toBeLessThan(dealNewRent);
  });

  it('removes exactly that one deal and leaves every other listing untouched', async () => {
    const dealsAfter = Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM listings WHERE is_deal')).rows[0]?.n);
    expect(dealsAfter).toBe(dealsBefore - 1);
    const after = await snapshot([dealId, nudgedId]);
    expect(after.size).toBe(snapshotBefore.size);
    const changed = [...snapshotBefore].filter(([id, h]) => after.get(id) !== h).map(([id]) => id);
    expect(changed).toEqual([]);
  });

  it('keeps the verdict when only an unscored column (geo) changed, even though the row was rewritten', async () => {
    const r = (await db.query(`SELECT ${FAIR_SQL}, is_deal, ST_AsText(geom::geometry) AS g FROM listings WHERE id = $1`, [nudgedId])).rows[0] as Record<string, unknown>;
    expect(r['g']).not.toEqual(nudgedBefore['g']); // the upsert did run on this row
    const kept = { ...r };
    const was = { ...nudgedBefore };
    delete kept['g'];
    delete was['g'];
    expect(kept).toEqual(was);
    expect(kept['fair_rent_inr']).not.toBeNull();
    expect(kept['fair_model_run_id']).not.toBeNull();
  });
});

describe('migration 0007 provenance constraints', () => {
  // Nulling one provenance column breaks both constraints; Postgres reports whichever it evaluates first.
  const violate = async (sql: string, ...constraints: string[]): Promise<void> => {
    const err = await db.query(sql).then(() => null, (e: unknown) => e as { code?: string; constraint?: string });
    expect(err?.code).toBe('23514');
    expect(constraints).toContain(err?.constraint);
  };
  let scored: string;
  beforeAll(async () => {
    const r = await db.query<{ id: string }>('SELECT id FROM listings WHERE fair_rent_inr IS NOT NULL ORDER BY id LIMIT 1');
    scored = r.rows[0]?.id as string;
    expect(scored).toBeTruthy();
  });

  it('rejects a fair rent without a model run id', async () => {
    await violate(`UPDATE listings SET fair_model_run_id = NULL WHERE id = '${scored}'`, 'listings_fair_requires_provenance', 'listings_fair_provenance_paired');
  });
  it('rejects a fair rent without an engine version', async () => {
    await violate(`UPDATE listings SET fair_engine_version = NULL WHERE id = '${scored}'`, 'listings_fair_requires_provenance', 'listings_fair_provenance_paired');
  });
  it('rejects a lone provenance column even with no fair rent', async () => {
    await violate(`UPDATE listings SET fair_rent_inr = NULL, fair_model_run_id = NULL WHERE id = '${scored}'`, 'listings_fair_provenance_paired');
    await violate(`UPDATE listings SET fair_rent_inr = NULL, fair_engine_version = NULL WHERE id = '${scored}'`, 'listings_fair_provenance_paired');
  });
  it('rejects a fair rent written with no provenance on an unscored listing', async () => {
    await violate(`UPDATE listings SET fair_rent_inr = 1000 WHERE id = '${dealId}'`, 'listings_fair_requires_provenance');
  });
  it('allows a low-confidence refusal that still carries provenance, and the all-null state', async () => {
    await db.query(`UPDATE listings SET fair_rent_inr = NULL WHERE id = '${scored}' RETURNING id`);
    await db.query(`UPDATE listings SET fair_rent_inr = NULL, fair_model_run_id = NULL, fair_engine_version = NULL WHERE id = '${scored}'`);
  });
  it('stage 6 denormalisation satisfies both constraints for every listing', async () => {
    await runModelStages(db, { models: stubModels });
    const bad = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM listings WHERE NOT ((fair_rent_inr IS NULL OR (fair_model_run_id IS NOT NULL AND fair_engine_version IS NOT NULL))
         AND ((fair_model_run_id IS NULL) = (fair_engine_version IS NULL)))`,
    );
    expect(Number(bad.rows[0]?.n)).toBe(0);
    const scoredN = await db.query<{ n: string }>('SELECT count(*) AS n FROM listings WHERE fair_rent_inr IS NOT NULL AND fair_model_run_id IS NOT NULL');
    expect(Number(scoredN.rows[0]?.n)).toBeGreaterThan(1000);
  });
});
