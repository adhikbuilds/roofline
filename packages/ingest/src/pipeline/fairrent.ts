/**
 * Stage 6: fair rent. Fit both models (robust-median v1, hedonic v2) with 5-fold CV, pick the active one,
 * write model_runs + fair_rent_estimates, denormalise onto `listings`, then run stage 7 (deals). One transaction.
 *
 * The engine is injected (`Models`) so the orchestration is testable with fakes; `engineModels()` is the real wiring.
 */
import { ENGINE_VERSION, NOT_ENOUGH_COMPS } from '@roofline/engine';
import type { FitListing, ModelKind, PgSubmodel, Prediction, PredictOptions } from '@roofline/engine';
import type { Db } from './db';
import { evaluateAll, writeDeals } from './deals';
import {
  chooseWindowStart, estimateRow, looMdape, planListing, toFitListing,
} from './fairrent-core';
import type { DbListingRow, EstimateRow, FitRecord } from './fairrent-core';

export interface CvLike {
  n: number;
  mdapeObs: number;
  coverageObs: number;
  mdapeObsBadged: number | null;
  nBadged: number;
  mdapeTruth?: number;
  coverageTruth?: number;
}
export interface ArtifactLike {
  kind: ModelKind;
  pg: PgSubmodel;
  [k: string]: unknown;
}
export interface Models {
  crossValidate(rows: readonly FitListing[], opts: { asOf: string; truth?: ReadonlyMap<string, number> }): { robustMedian: CvLike; hedonic: CvLike; active: ModelKind };
  fitRobustMedian(rows: readonly FitListing[], opts: { asOf: string }): ArtifactLike;
  fitHedonic(rows: readonly FitListing[], opts: { asOf: string; pg: PgSubmodel }): ArtifactLike;
  predict(a: ArtifactLike, x: FitListing, o: PredictOptions): Prediction | null;
}

export interface ModelStageOptions {
  models: Models;
  /** Defaults to the latest ingest_runs.as_of (never the wall clock). */
  asOf?: Date;
  /** Only fit listings first seen within this many days of asOf. Default: all active listings. */
  windowDays?: number;
  log?: (line: string) => void;
}

export interface ModelStageResult {
  asOf: string;
  fitCount: { flats: number; pg: number };
  active: ModelKind;
  runIds: Record<ModelKind, number>;
  cv: { robust_median: CvLike; hedonic: CvLike };
  estimates: { robust_median: number; hedonic: number };
  deals: { eligible: number; quarantined: number };
  truth: { mapped: number; exact: number; fallback: number };
}

const CHUNK = 1000;

const isTruthKey = (k: string): boolean => /truth/i.test(k);

/**
 * model_runs.metrics is readable by the web role, so every truth-derived field (any key containing "Truth", at any depth)
 * is split out here and stored in seed_truth.model_run_eval instead.
 */
export function splitTruthMetrics(metrics: Record<string, unknown>): { publicMetrics: Record<string, unknown>; truthMetrics: Record<string, unknown> } {
  const walk = (v: unknown): { pub: unknown; tru: unknown } => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return { pub: v, tru: undefined };
    const pub: Record<string, unknown> = {};
    const tru: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (isTruthKey(k)) {
        if (x !== undefined) tru[k] = x;
        continue;
      }
      const r = walk(x);
      pub[k] = r.pub;
      if (r.tru !== undefined && Object.keys(r.tru as object).length > 0) tru[k] = r.tru;
    }
    return { pub, tru };
  };
  const r = walk(metrics);
  return { publicMetrics: r.pub as Record<string, unknown>, truthMetrics: r.tru as Record<string, unknown> };
}

export async function latestAsOf(db: Db): Promise<Date> {
  const r = await db.query<{ as_of: Date | null }>(`SELECT max(as_of) AS as_of FROM ingest_runs WHERE status = 'ok'`);
  const v = r.rows[0]?.as_of;
  if (!v) throw new Error('no completed ingest run: run `pnpm db:fresh` or `pnpm ingest:run` first');
  return new Date(v);
}

/** Active listings whose canonical member is accepted, with the extras the models and deals need. */
export async function loadFitSet(db: Db, asOf: Date, windowDays?: number): Promise<FitRecord[]> {
  const start = chooseWindowStart(asOf, windowDays);
  const res = await db.query<DbListingRow>(
    `SELECT l.id, l.unit_kind::text AS unit_kind, l.bhk::int AS bhk, l.rent_inr, l.deposit_inr, l.area_sqft,
            l.furnishing::text AS furnishing, l.locality_id::int AS locality_id, loc.name AS locality_name, loc.zone::text AS zone,
            l.pg_sharing::text AS pg_sharing, l.pg_food_included, l.photo_seeds, l.source_count::int AS source_count,
            l.rent_min_inr, l.rent_max_inr, to_char(l.first_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS first_seen_at,
            c.parking::text AS c_parking, c.tags AS c_tags, c.floor::int AS c_floor, c.total_floors::int AS c_total_floors,
            c.quality_status::text AS c_quality_status,
            to_char(m.last_seen AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS m_last_seen_at, m.warnings AS m_warnings
       FROM listings l
       JOIN source_listings c ON c.id = l.canonical_source_listing_id
       JOIN localities loc ON loc.id = l.locality_id
       JOIN LATERAL (
         SELECT max(sm.last_seen_at) AS last_seen,
                COALESCE(array_agg(DISTINCT w ORDER BY w) FILTER (WHERE w IS NOT NULL), '{}') AS warnings
           FROM source_listings sm LEFT JOIN LATERAL unnest(sm.quality_warnings) AS w ON true
          WHERE sm.listing_id = l.id AND sm.is_active AND sm.quality_status = 'accepted'
       ) m ON m.last_seen IS NOT NULL
      WHERE l.is_active AND c.quality_status = 'accepted' AND l.first_seen_at <= $1
        AND ($2::timestamptz IS NULL OR l.first_seen_at >= $2)
      ORDER BY l.id`,
    [asOf.toISOString(), start ? start.toISOString() : null],
  );
  const out: FitRecord[] = [];
  for (const row of res.rows) {
    const listing = toFitListing(row);
    if (listing) out.push({ listing, row });
  }
  return out;
}

/** Synthetic mode only: listing -> true expected rent at asOf (or the latest point before it). Never stored. */
export async function loadTruth(db: Db, asOf: Date, ids: readonly string[]): Promise<{ map: Map<string, number>; exact: number; fallback: number }> {
  const map = new Map<string, number>();
  let exact = 0;
  for (let i = 0; i < ids.length; i += 5000) {
    const res = await db.query<{ id: string; rent: number; exact: boolean }>(
      `SELECT l.id, tr.true_expected_rent_inr AS rent, (tr.as_of = $1::timestamptz) AS exact
         FROM listings l
         JOIN source_listings sl ON sl.id = l.canonical_source_listing_id
         JOIN seed_truth.source_rows sr ON sr.source_id = sl.source_id AND sr.source_listing_id = sl.source_listing_id
         JOIN LATERAL (SELECT t.true_expected_rent_inr, t.as_of FROM seed_truth.true_rent t
                        WHERE t.unit_id = sr.unit_id AND t.as_of <= $1::timestamptz ORDER BY t.as_of DESC LIMIT 1) tr ON true
        WHERE l.id = ANY($2::uuid[])`,
      [asOf.toISOString(), ids.slice(i, i + 5000)],
    );
    for (const r of res.rows) {
      map.set(r.id, r.rent);
      if (r.exact) exact += 1;
    }
  }
  return { map, exact, fallback: map.size - exact };
}

function predictAll(models: Models, art: ArtifactLike, recs: readonly FitRecord[], runId: number): Map<string, EstimateRow> {
  const out = new Map<string, EstimateRow>();
  for (const rec of recs) {
    const p = models.predict(art, rec.listing, { inSample: true, modelRunId: String(runId) });
    if (!p) continue;
    const names = { localityName: rec.row.locality_name, zone: rec.listing.zone };
    out.set(rec.row.id, estimateRow(rec.row.id, p, rec.listing.rentInr, names, rec.listing));
  }
  return out;
}

async function writeEstimates(db: Db, runId: number, ests: ReadonlyMap<string, EstimateRow>): Promise<void> {
  const all = [...ests.values()];
  for (let i = 0; i < all.length; i += CHUNK) {
    const part = all.slice(i, i + CHUNK).map((e) => ({
      listing_id: e.listingId, expected: e.expectedInr, low: e.lowInr, high: e.highInr, delta: e.deltaStored,
      badge: e.badge, confidence: e.confidence, basis: e.basis, explanation: e.explanation,
    }));
    await db.query(
      `INSERT INTO fair_rent_estimates (listing_id, model_run_id, expected_inr, low_inr, high_inr, delta_pct, badge, confidence, basis, explanation)
       SELECT x.listing_id, $2, x.expected, x.low, x.high, x.delta, x.badge::fair_badge, x.confidence::fair_confidence, x.basis, x.explanation
         FROM jsonb_to_recordset($1::jsonb) AS x(listing_id uuid, expected int, low int, high int, delta real, badge text, confidence text, basis jsonb, explanation text)`,
      [JSON.stringify(part), runId],
    );
  }
}

/** Clear the fair + deal columns on EVERY listing (inactive ones too), then write the active run's values. */
async function denormalize(
  db: Db, recs: readonly FitRecord[], active: ReadonlyMap<string, EstimateRow>, runId: number, engineVersion: string,
): Promise<void> {
  await db.query(
    `UPDATE listings SET fair_rent_inr = NULL, fair_low_inr = NULL, fair_high_inr = NULL, fair_delta_pct = NULL, badge = NULL,
            confidence = NULL, fair_explanation = NULL, fair_model_run_id = NULL, fair_engine_version = NULL, is_deal = false, deal_score = NULL, deal_reason = NULL`,
  );
  for (let i = 0; i < recs.length; i += CHUNK) {
    // Provenance only where the active run actually scored the listing (a low-confidence refusal still came from the run).
    const part = recs.slice(i, i + CHUNK).map((r) => {
      const scored = active.has(r.row.id);
      return { id: r.row.id, ...planListing(active.get(r.row.id)), fair_model_run_id: scored ? runId : null, fair_engine_version: scored ? engineVersion : null };
    });
    await db.query(
      `UPDATE listings l SET fair_rent_inr = x.fair_rent_inr, fair_low_inr = x.fair_low_inr, fair_high_inr = x.fair_high_inr,
              fair_delta_pct = x.fair_delta_pct, badge = x.badge::fair_badge, confidence = x.confidence::fair_confidence,
              fair_explanation = x.fair_explanation, fair_model_run_id = x.fair_model_run_id, fair_engine_version = x.fair_engine_version
         FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, fair_rent_inr int, fair_low_inr int, fair_high_inr int,
                                                  fair_delta_pct real, badge text, confidence text, fair_explanation text,
                                                  fair_model_run_id bigint, fair_engine_version text)
        WHERE l.id = x.id`,
      [JSON.stringify(part)],
    );
  }
  // Active listings outside the fit set (canonical member rejected, unusable BHK, ...) also refuse a verdict.
  await db.query(
    `UPDATE listings SET confidence = 'low', fair_explanation = $1 WHERE is_active AND confidence IS NULL`,
    [NOT_ENOUGH_COMPS],
  );
}

export async function runModelStages(db: Db, opts: ModelStageOptions): Promise<ModelStageResult> {
  const { models, log = () => {} } = opts;
  const asOf = opts.asOf ?? (await latestAsOf(db));
  const asOfIso = asOf.toISOString();
  const recs = await loadFitSet(db, asOf, opts.windowDays);
  const listings = recs.map((r) => r.listing);
  const flats = listings.filter((l) => l.kind === 'flat').length;
  log(`stage 6: ${recs.length} fit listings (${flats} flats, ${recs.length - flats} PG) as of ${asOfIso.slice(0, 10)}`);

  const truth = await loadTruth(db, asOf, recs.map((r) => r.row.id));
  if (truth.map.size > 0) {
    log(`truth: ${truth.map.size} listings mapped (${truth.exact} at exactly asOf, ${truth.fallback} from the latest earlier point)`);
  }
  const cv = models.crossValidate(listings, { asOf: asOfIso, truth: truth.map.size > 0 ? truth.map : undefined });
  const rm = models.fitRobustMedian(listings, { asOf: asOfIso });
  const hd = models.fitHedonic(listings, { asOf: asOfIso, pg: rm.pg });
  const cvBy: Record<ModelKind, CvLike> = { robust_median: cv.robustMedian, hedonic: cv.hedonic };
  const artBy: Record<ModelKind, ArtifactLike> = { robust_median: rm, hedonic: hd };
  const kinds: ModelKind[] = ['robust_median', 'hedonic'];

  await db.query('BEGIN');
  try {
    await db.query('UPDATE model_runs SET is_active = false WHERE is_active');
    const runIds = {} as Record<ModelKind, number>;
    for (const kind of kinds) {
      const { publicMetrics, truthMetrics } = splitTruthMetrics({
        cv: { folds: 5, ...cvBy[kind] }, selection: { rule: 'lower_mdape_obs_strict_ties_v1', active: kind === cv.active },
      });
      const ins = await db.query<{ id: string }>(
        `INSERT INTO model_runs (kind, engine_version, as_of, artifact, metrics, is_active)
         VALUES ($1::model_kind, $2, $3, $4::jsonb, $5::jsonb, $6) RETURNING id`,
        [kind, ENGINE_VERSION, asOfIso, JSON.stringify(artBy[kind]), JSON.stringify(publicMetrics), kind === cv.active],
      );
      runIds[kind] = Number(ins.rows[0]?.id);
      await db.query(`INSERT INTO seed_truth.model_run_eval (model_run_id, metrics) VALUES ($1, $2::jsonb)`, [runIds[kind], JSON.stringify(truthMetrics)]);
    }

    const estBy = {} as Record<ModelKind, Map<string, EstimateRow>>;
    for (const kind of kinds) {
      estBy[kind] = predictAll(models, artBy[kind], recs, runIds[kind]);
      await writeEstimates(db, runIds[kind], estBy[kind]);
    }

    const active = estBy[cv.active];
    await denormalize(db, recs, active, runIds[cv.active], ENGINE_VERSION);

    // stage 7
    const deals = evaluateAll(recs, active, asOfIso);
    await writeDeals(db, deals.ranked);

    const pgPairs = recs.flatMap((r) => {
      const e = active.get(r.row.id);
      return r.listing.kind === 'pg' && e ? [{ expected: e.expectedInr, rent: r.listing.rentInr }] : [];
    });
    for (const kind of kinds) {
      const extra: Record<string, unknown> = { pg: { looMdapeObs: looMdape(pgPairs) } };
      if (kind === cv.active) extra['deals'] = { eligible: deals.eligible, evaluated: deals.evaluated, quarantined: deals.quarantined, failed: deals.failed };
      await db.query(`UPDATE model_runs SET metrics = metrics || $2::jsonb WHERE id = $1`, [runIds[kind], JSON.stringify(extra)]);
    }
    await db.query('COMMIT');

    log(`stage 6: active=${cv.active} (robust_median mdapeObs=${cv.robustMedian.mdapeObs.toFixed(4)}, hedonic mdapeObs=${cv.hedonic.mdapeObs.toFixed(4)})`);
    log(`stage 7: ${deals.eligible} deals, ${deals.quarantined.count} quarantined`);
    return {
      asOf: asOfIso, fitCount: { flats, pg: recs.length - flats }, active: cv.active, runIds,
      cv: { robust_median: cv.robustMedian, hedonic: cv.hedonic },
      estimates: { robust_median: estBy.robust_median.size, hedonic: estBy.hedonic.size },
      deals: { eligible: deals.eligible, quarantined: deals.quarantined.count },
      truth: { mapped: truth.map.size, exact: truth.exact, fallback: truth.fallback },
    };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}
