/**
 * Pure helpers for stages 6-7: DB row -> engine input, engine output -> stored row, and the `listings`
 * denormalisation plan. No I/O, so every mapping is unit-tested without a database.
 */
import { NOT_ENOUGH_COMPS, badgeFor, deltaOf, explain, median, storedDelta } from '@roofline/engine';
import type { Badge, Confidence, EstimateBasis, ExplainNames, FitListing, Prediction, Zone } from '@roofline/engine';
import type { DealInput } from '@roofline/engine';

/** One active listing joined with its canonical member and cluster aggregates (see loadFitSet). */
export interface DbListingRow {
  id: string;
  unit_kind: 'rk' | 'bhk' | 'studio' | 'pg_bed';
  bhk: number | null;
  rent_inr: number;
  deposit_inr: number | null;
  area_sqft: number | null;
  furnishing: 'furnished' | 'semi' | 'unfurnished' | null;
  locality_id: number;
  locality_name: string;
  zone: string;
  pg_sharing: 'single' | 'double' | 'triple' | 'quad' | null;
  pg_food_included: boolean | null;
  photo_seeds: string[];
  source_count: number;
  rent_min_inr: number | null;
  rent_max_inr: number | null;
  first_seen_at: string;
  c_parking: 'bike' | 'car' | 'both' | 'none' | null;
  c_tags: string[];
  c_floor: number | null;
  c_total_floors: number | null;
  c_quality_status: 'accepted' | 'rejected';
  /** max(last_seen_at) over the active accepted members of the cluster. */
  m_last_seen_at: string;
  /** Union of quality_warnings over the active accepted members. */
  m_warnings: string[];
}

export interface FitRecord {
  listing: FitListing;
  row: DbListingRow;
}

/** Flats with no usable BHK count (a `bhk` unit with null bhk) cannot be placed in any cell: skipped. */
export function toFitListing(r: DbListingRow): FitListing | null {
  const zone = r.zone as Zone;
  if (r.unit_kind === 'pg_bed') {
    return { kind: 'pg', id: r.id, localityId: r.locality_id, zone, sharing: r.pg_sharing, food: r.pg_food_included, rentInr: r.rent_inr };
  }
  if (r.unit_kind === 'bhk' && (r.bhk === null || r.bhk < 1)) return null;
  return {
    kind: 'flat', id: r.id, localityId: r.locality_id, zone, unitKind: r.unit_kind, bhk: r.unit_kind === 'bhk' ? (r.bhk as number) : 0,
    furnishing: r.furnishing, areaSqft: r.area_sqft, rentInr: r.rent_inr, parking: r.c_parking, tags: r.c_tags,
    floor: r.c_floor, totalFloors: r.c_total_floors,
  };
}

export interface EstimateRow {
  listingId: string;
  expectedInr: number;
  lowInr: number;
  highInr: number;
  delta: number;
  /** Math.fround(delta): what Postgres `real` holds, and what every deal check is evaluated on. */
  deltaStored: number;
  badge: Badge | null;
  confidence: Confidence;
  nEff: number;
  basis: EstimateBasis;
  explanation: string;
}

export function estimateRow(listingId: string, p: Prediction, rentInr: number, names: ExplainNames, x: Parameters<typeof explain>[1]): EstimateRow {
  const delta = deltaOf(rentInr, p.expectedInr);
  return {
    listingId, expectedInr: p.expectedInr, lowInr: p.lowInr, highInr: p.highInr, delta, deltaStored: storedDelta(delta),
    badge: badgeFor(delta, p.confidence), confidence: p.confidence, nEff: p.basis.nEff, basis: p.basis,
    explanation: explain(p, x, rentInr, names),
  };
}

export interface ListingFair {
  fair_rent_inr: number | null;
  fair_low_inr: number | null;
  fair_high_inr: number | null;
  fair_delta_pct: number | null;
  badge: Badge | null;
  confidence: Confidence;
  fair_explanation: string;
}

/** `low` (or no estimate) refuses a verdict: numbers and badge are NULL, only the sentence remains. */
export function planListing(e: EstimateRow | undefined): ListingFair {
  if (!e || e.confidence === 'low') {
    return { fair_rent_inr: null, fair_low_inr: null, fair_high_inr: null, fair_delta_pct: null, badge: null, confidence: 'low', fair_explanation: NOT_ENOUGH_COMPS };
  }
  return {
    fair_rent_inr: e.expectedInr, fair_low_inr: e.lowInr, fair_high_inr: e.highInr, fair_delta_pct: e.deltaStored, badge: e.badge,
    confidence: e.confidence, fair_explanation: e.explanation,
  };
}

export function toDealInput(rec: FitRecord, e: EstimateRow | undefined, asOfIso: string): DealInput {
  const r = rec.row;
  return {
    listingId: r.id, asOf: asOfIso, rentInr: r.rent_inr,
    expectedInr: e?.expectedInr ?? null, delta: e?.delta ?? null, deltaStored: e?.deltaStored ?? null,
    confidence: e?.confidence ?? 'low', nEff: e?.nEff ?? 0,
    qualityStatus: r.c_quality_status, warnings: r.m_warnings,
    photoCount: r.photo_seeds.length, areaSqft: r.area_sqft, depositInr: r.deposit_inr,
    floorKnown: r.c_floor !== null && r.c_total_floors !== null, parkingKnown: r.c_parking !== null,
    firstSeenAt: r.first_seen_at, lastSeenAt: r.m_last_seen_at,
    sourceCount: r.source_count, rentMinInr: r.rent_min_inr ?? r.rent_inr, rentMaxInr: r.rent_max_inr ?? r.rent_inr,
  };
}

export function looMdape(pairs: ReadonlyArray<{ expected: number; rent: number }>): number | null {
  if (pairs.length === 0) return null;
  return median(pairs.map((p) => Math.abs(p.expected - p.rent) / p.rent));
}

/** Optional fit-set window: only listings first seen within `days` of asOf. */
export function chooseWindowStart(asOf: Date, days: number | undefined): Date | null {
  return days === undefined ? null : new Date(asOf.getTime() - days * 86_400_000);
}
