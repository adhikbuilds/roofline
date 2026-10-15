/**
 * `pnpm eval:deals`: precision / recall of listings.is_deal against truth derived here from seed_truth (never stored in a web-readable table).
 * Gate = the REVISED definition in PLAN.md Phase 3 (flats with area and an active listing, grey zone excluded, too_good never deals).
 * The original strict numbers (observed rent in [0.45, 0.80] x true expected rent) are printed and stored next to it, but do not gate.
 */
import { DEAL_BAND_PCT } from '../adapters/synthetic/truth';
import type { Db } from '../pipeline/db';

export const DEALS_LIMITS = { minPrecision: 0.85, minRecall: 0.75 } as const;
/**
 * Revised gate (PLAN.md Phase 3, 2026-10-16). Fixed before scoring: a true ratio (observed / true expected rent) <= 0.76 is a deal,
 * (0.76, 0.84] is the grey zone (excluded from precision and recall; its 0.08 width is below the observed MdAPE and must not be widened).
 */
export const GREY_ZONE_PCT = { dealMax: 76, greyMax: 84 } as const;

export type RatioClass = 'deal' | 'grey' | 'fair';

/** Exact integer arithmetic, boundary-inclusive on the upper side of each band. */
export function classifyRatio(rentInr: number, trueRentInr: number): RatioClass {
  if (rentInr * 100 <= GREY_ZONE_PCT.dealMax * trueRentInr) return 'deal';
  if (rentInr * 100 <= GREY_ZONE_PCT.greyMax * trueRentInr) return 'grey';
  return 'fair';
}

/** One row per active listing of a deal-eligible unit (flat with a known area). Low-confidence flats are included. */
export interface EligibleListing {
  listingId: string;
  unitId: string;
  rentInr: number;
  trueRentInr: number;
  shown: boolean;
  tooGood: boolean;
}
export interface RevisedScore {
  shown: number;
  shownOutsideGrey: number;
  shownTruePositives: number;
  precision: number;
  dealUnits: number;
  dealUnitsHit: number;
  recall: number;
  greyUnits: number;
  units: number;
}

export function scoreRevised(rows: readonly EligibleListing[]): RevisedScore {
  let shown = 0;
  let shownOutsideGrey = 0;
  let shownTruePositives = 0;
  const units = new Map<string, { deal: boolean; hit: boolean; grey: boolean }>();
  for (const r of rows) {
    const cls = classifyRatio(r.rentInr, r.trueRentInr);
    const isDeal = cls === 'deal' && !r.tooGood; // too_good plants are never true deals
    if (r.shown) {
      shown += 1;
      if (cls !== 'grey') {
        shownOutsideGrey += 1;
        if (isDeal) shownTruePositives += 1;
      }
    }
    const u = units.get(r.unitId) ?? { deal: false, hit: false, grey: false };
    if (isDeal) {
      u.deal = true;
      if (r.shown) u.hit = true;
    }
    if (cls === 'grey') u.grey = true;
    units.set(r.unitId, u);
  }
  let dealUnits = 0;
  let dealUnitsHit = 0;
  let greyUnits = 0;
  for (const u of units.values()) {
    if (u.deal) {
      dealUnits += 1;
      if (u.hit) dealUnitsHit += 1;
    } else if (u.grey) greyUnits += 1;
  }
  return {
    shown, shownOutsideGrey, shownTruePositives,
    precision: shownOutsideGrey === 0 ? 0 : shownTruePositives / shownOutsideGrey,
    dealUnits, dealUnitsHit, recall: dealUnits === 0 ? 0 : dealUnitsHit / dealUnits,
    greyUnits, units: units.size,
  };
}

/** The original (pre-revision) band-0.45..0.80 counts, printed and stored but never gating. */
export interface StrictCounts {
  deals: number;
  truePositives: number;
  /** Distinct real-deal units covered by a deal listing (defaults to truePositives). */
  hitUnits?: number;
  trueDeals: number;
  trueDealsActive: number;
  tooGoodInDeals: number;
  quarantined: number;
  plantedUnits?: number;
  naturalUnits?: number;
}
export interface StrictScore {
  precision: number;
  recall: number;
  recallAll: number;
}
export interface DealsVerdict {
  ok: boolean;
  /** Revised-gate numbers. */
  precision: number;
  recall: number;
  strict: StrictScore;
  revised: RevisedScore;
  lines: string[];
}

export function scoreStrict(c: StrictCounts): StrictScore {
  const hits = c.hitUnits ?? c.truePositives;
  return {
    precision: c.deals === 0 ? 0 : c.truePositives / c.deals,
    recall: c.trueDealsActive === 0 ? 0 : hits / c.trueDealsActive,
    recallAll: c.trueDeals === 0 ? 0 : hits / c.trueDeals,
  };
}

const f4 = (v: number): string => v.toFixed(4);

export function judgeDeals(x: { strict: StrictCounts; revised: RevisedScore }): DealsVerdict {
  const c = x.strict;
  const rv = x.revised;
  const strict = scoreStrict(c);
  const fails: string[] = [];
  if (rv.precision < DEALS_LIMITS.minPrecision) fails.push(`revised precision ${f4(rv.precision)} must be >= ${DEALS_LIMITS.minPrecision}`);
  if (rv.recall < DEALS_LIMITS.minRecall) fails.push(`revised recall ${f4(rv.recall)} must be >= ${DEALS_LIMITS.minRecall}`);
  if (c.tooGoodInDeals !== 0) fails.push(`too_good_in_deals=${c.tooGoodInDeals} must be 0`);
  const ok = fails.length === 0;
  const lines = [
    `deals=${c.deals} quarantined=${c.quarantined}`,
    `revised (gate; grey zone true ratio in (0.76, 0.84] excluded): precision=${f4(rv.precision)} (>= ${DEALS_LIMITS.minPrecision}) recall=${f4(rv.recall)} (>= ${DEALS_LIMITS.minRecall})`,
    `  population: ${rv.units} eligible units (flats with area and an active listing), ${rv.dealUnits} true-deal units (${rv.dealUnitsHit} shown), ${rv.greyUnits} grey-zone units excluded; ` +
      `${rv.shown} shown deals, ${rv.shownOutsideGrey} outside the grey zone, ${rv.shownTruePositives} true`,
    `strict (informational, not gating; band 0.45-0.80): precision=${f4(strict.precision)} recall=${f4(strict.recall)} (over deal units with an active listing) ` +
      `recall_all_units=${f4(strict.recallAll)} true_positives=${c.truePositives} true_deal_units=${c.trueDeals} with_active_listing=${c.trueDealsActive}`,
    ...(c.plantedUnits !== undefined ? [`label_set: planted=${c.plantedUnits} natural=${c.naturalUnits ?? 0}`] : []),
    `too_good_in_deals=${c.tooGoodInDeals} (must be 0)`,
    ...fails.map((m) => `  FAIL ${m}`),
    ok ? 'eval:deals OK' : 'eval:deals FAILED',
  ];
  return { ok, precision: rv.precision, recall: rv.recall, strict, revised: rv, lines };
}

/** Truth is derived here from seed_truth + listings at the active model's as-of; nothing is stored. */
export async function evalDeals(db: Db): Promise<DealsVerdict> {
  const res = await db.query<{ deals: string; tp: string; hits: string; units: string; units_active: string; planted: string; natural: string; too_good: string }>(
    `WITH as_of AS (
       SELECT COALESCE((SELECT as_of FROM model_runs WHERE is_active LIMIT 1),
                       (SELECT max(as_of) FROM ingest_runs WHERE status = 'ok')) AS t),
     pairs AS (
       SELECT DISTINCT sl.listing_id, sr.unit_id, sl.is_active AS member_active
         FROM source_listings sl
         JOIN seed_truth.source_rows sr ON sr.source_id = sl.source_id AND sr.source_listing_id = sl.source_listing_id
        WHERE sl.listing_id IS NOT NULL),
     labelled AS (
       SELECT p.listing_id, p.unit_id, (p.member_active AND l.is_active) AS active,
              CASE WHEN td.kind = 'deal' THEN 'deal' ELSE 'natural' END AS kind
         FROM pairs p
         JOIN listings l ON l.id = p.listing_id
         JOIN as_of ON true
         JOIN LATERAL (SELECT t.true_expected_rent_inr AS rent FROM seed_truth.true_rent t
                        WHERE t.unit_id = p.unit_id AND t.as_of <= as_of.t ORDER BY t.as_of DESC LIMIT 1) tr ON true
         LEFT JOIN seed_truth.true_deals td ON td.unit_id = p.unit_id
        WHERE COALESCE(td.kind, '') <> 'too_good'
          AND l.rent_inr * 100 <= ${DEAL_BAND_PCT.max}::int * tr.rent
          AND l.rent_inr * 100 >= ${DEAL_BAND_PCT.min}::int * tr.rent),
     deal_listings AS (SELECT id FROM listings WHERE is_deal),
     deal_units AS (SELECT DISTINCT unit_id, kind FROM labelled),
     active_units AS (SELECT DISTINCT unit_id FROM labelled WHERE active),
     hit_units AS (SELECT DISTINCT lb.unit_id FROM labelled lb JOIN deal_listings d ON d.id = lb.listing_id WHERE lb.active)
     SELECT (SELECT count(*) FROM deal_listings) AS deals,
            (SELECT count(*) FROM deal_listings d WHERE EXISTS (SELECT 1 FROM labelled lb WHERE lb.listing_id = d.id)) AS tp,
            (SELECT count(*) FROM hit_units) AS hits,
            (SELECT count(*) FROM deal_units) AS units,
            (SELECT count(*) FROM active_units) AS units_active,
            (SELECT count(*) FROM deal_units WHERE kind = 'deal') AS planted,
            (SELECT count(*) FROM deal_units WHERE kind = 'natural') AS natural,
            (SELECT count(*) FROM listings l JOIN source_listings sl ON sl.listing_id = l.id
               JOIN seed_truth.source_rows s ON s.source_id = sl.source_id AND s.source_listing_id = sl.source_listing_id
              WHERE s.defect = 'too_good' AND l.is_deal) AS too_good`,
  );
  const r = res.rows[0];
  const q = await db.query<{ n: string | null }>(`SELECT (metrics #>> '{deals,quarantined,count}') AS n FROM model_runs WHERE is_active`);
  const elig = await db.query<{ listing_id: string; unit_id: string; rent_inr: number; true_rent: number; shown: boolean; too_good: boolean }>(
    `WITH as_of AS (
       SELECT COALESCE((SELECT as_of FROM model_runs WHERE is_active LIMIT 1),
                       (SELECT max(as_of) FROM ingest_runs WHERE status = 'ok')) AS t)
     SELECT l.id AS listing_id, sr.unit_id, l.rent_inr, tr.rent AS true_rent, l.is_deal AS shown,
            (td.kind = 'too_good' OR sr.defect = 'too_good') AS too_good
       FROM listings l
       JOIN source_listings sl ON sl.id = l.canonical_source_listing_id
       JOIN seed_truth.source_rows sr ON sr.source_id = sl.source_id AND sr.source_listing_id = sl.source_listing_id
       JOIN as_of ON true
       JOIN LATERAL (SELECT t.true_expected_rent_inr AS rent FROM seed_truth.true_rent t
                      WHERE t.unit_id = sr.unit_id AND t.as_of <= as_of.t ORDER BY t.as_of DESC LIMIT 1) tr ON true
       LEFT JOIN seed_truth.true_deals td ON td.unit_id = sr.unit_id
      WHERE l.is_active AND l.unit_kind <> 'pg_bed' AND l.area_sqft IS NOT NULL`,
  );
  const revised = scoreRevised(
    elig.rows.map((e) => ({
      listingId: e.listing_id, unitId: e.unit_id, rentInr: e.rent_inr, trueRentInr: e.true_rent, shown: e.shown, tooGood: e.too_good === true,
    })),
  );
  const strict: StrictCounts = {
    deals: Number(r?.deals ?? 0), truePositives: Number(r?.tp ?? 0), hitUnits: Number(r?.hits ?? 0), trueDeals: Number(r?.units ?? 0),
    trueDealsActive: Number(r?.units_active ?? 0), tooGoodInDeals: Number(r?.too_good ?? 0), quarantined: Number(q.rows[0]?.n ?? 0),
    plantedUnits: Number(r?.planted ?? 0), naturalUnits: Number(r?.natural ?? 0),
  };
  const verdict = judgeDeals({ strict, revised });
  // Truth-derived, so it goes in the admin-only table, never model_runs.metrics.
  await db.query(
    `UPDATE seed_truth.model_run_eval SET metrics = metrics || $1::jsonb WHERE model_run_id = (SELECT id FROM model_runs WHERE is_active)`,
    [JSON.stringify({ deals: { gate: 'revised_2026-10-16', ok: verdict.ok, strict: { ...strict, ...scoreStrict(strict) }, revised, tooGoodInDeals: strict.tooGoodInDeals } })],
  );
  return verdict;
}
