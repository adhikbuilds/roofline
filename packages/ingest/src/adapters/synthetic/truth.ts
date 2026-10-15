/** Writes the generator's ground truth to schema seed_truth (admin role only; roofline_app has no grant). */
import type { Db } from '../../pipeline/db';
import { driftAt, type SeedDataset } from './generate';

const CHUNK = 5000;

/**
 * Ground-truth deal rule. A unit is a true deal at as-of T when its canonical observed rent at T is
 * <= 0.80 x its true expected rent at T and >= 0.45 x (so the x0.30 'too_good' plants are non-deals by
 * construction). The label set is DERIVED inside eval:deals from seed_truth.true_rent, seed_truth.true_deals
 * and the listings table, so no derived truth is ever written to a web-readable table, and
 * seed_truth.true_deals keeps holding only the generator's plants (kind 'deal' | 'too_good').
 * The 'natural' kind exists only in the derived set: units under the band that were not planted.
 */
export const DEAL_BAND = { maxRatio: 0.8, minRatio: 0.45 } as const;
/** Same band as integer percents, for exact SQL / integer arithmetic. */
export const DEAL_BAND_PCT = { max: 80, min: 45 } as const;

export type TrueDealKind = 'deal' | 'natural';

/** Exact (integer) boundary-inclusive labelling. Returns null for a non-deal. */
export function labelTrueDeal(x: { observedRent: number; trueRent: number; planted?: 'deal' | 'too_good' }): TrueDealKind | null {
  const { observedRent: o, trueRent: t } = x;
  if (x.planted === 'too_good') return null;
  if (!Number.isFinite(o) || !Number.isFinite(t) || o <= 0 || t <= 0) return null;
  if (o * 100 > DEAL_BAND_PCT.max * t || o * 100 < DEAL_BAND_PCT.min * t) return null;
  return x.planted === 'deal' ? 'deal' : 'natural';
}

async function bulk(db: Db, sql: string, records: unknown[]): Promise<void> {
  for (let i = 0; i < records.length; i += CHUNK) await db.query(sql, [JSON.stringify(records.slice(i, i + CHUNK))]);
}

export interface TruthCounts {
  units: number;
  sourceRows: number;
  trueRent: number;
  trueDeals: number;
}

export async function writeTruth(db: Db, ds: SeedDataset, localityIdBySlug: ReadonlyMap<string, number>): Promise<TruthCounts> {
  const loc = (slug: string): number => {
    const id = localityIdBySlug.get(slug);
    if (id === undefined) throw new Error(`seed_truth: unknown locality slug ${slug}`);
    return id;
  };
  await bulk(
    db,
    `INSERT INTO seed_truth.units (unit_id, locality_id, unit_kind, bhk, area_sqft, furnishing, true_rent_inr)
     SELECT x.unit_id, x.locality_id, x.unit_kind::unit_kind, x.bhk, x.area_sqft, x.furnishing::furnishing, x.true_rent_inr
       FROM jsonb_to_recordset($1::jsonb) AS x(unit_id uuid, locality_id int, unit_kind text, bhk int, area_sqft int, furnishing text, true_rent_inr int)`,
    ds.units.map((u) => ({
      unit_id: u.id, locality_id: loc(u.localitySlug), unit_kind: u.unitKind, bhk: u.bhk, area_sqft: u.areaSqft,
      furnishing: u.furnishing, true_rent_inr: u.trueRent,
    })),
  );
  await bulk(
    db,
    `INSERT INTO seed_truth.source_rows (source_id, source_listing_id, unit_id, defect)
     SELECT x.source_id, x.source_listing_id, x.unit_id, x.defect
       FROM jsonb_to_recordset($1::jsonb) AS x(source_id text, source_listing_id text, unit_id uuid, defect text)`,
    ds.rows.map((r) => ({ source_id: r.sourceId, source_listing_id: r.sourceListingId, unit_id: (ds.units[r.unitIdx] as { id: string }).id, defect: r.defect })),
  );
  const trueRent: Array<{ unit_id: string; as_of: string; rent: number }> = [];
  for (const u of ds.units) {
    for (let w = u.startWeek; w <= u.endWeek; w++) {
      trueRent.push({ unit_id: u.id, as_of: ds.weeks[w] as string, rent: Math.round(u.baseRent * driftAt(w)) });
    }
  }
  await bulk(
    db,
    `INSERT INTO seed_truth.true_rent (unit_id, as_of, true_expected_rent_inr)
     SELECT x.unit_id, x.as_of, x.rent FROM jsonb_to_recordset($1::jsonb) AS x(unit_id uuid, as_of timestamptz, rent int)`,
    trueRent,
  );
  const deals = ds.units.filter((u) => u.deal).map((u) => ({ unit_id: u.id, kind: u.deal?.kind, mult: u.deal?.multiplier }));
  await bulk(
    db,
    `INSERT INTO seed_truth.true_deals (unit_id, kind, rent_multiplier)
     SELECT x.unit_id, x.kind, x.mult FROM jsonb_to_recordset($1::jsonb) AS x(unit_id uuid, kind text, mult numeric)`,
    deals,
  );
  return { units: ds.units.length, sourceRows: ds.rows.length, trueRent: trueRent.length, trueDeals: deals.length };
}
