import { haversineKm } from '../geo';
import { unitClass } from './blocking';
import { hamming64, minHamming, parsePhotoHash } from './dhash';
import type { DedupRecord } from './types';

export { hamming64, minHamming, parsePhotoHash };

export const SIMILARITY = {
  weights: { geo: 0.2, rent: 0.15, area: 0.15, title: 0.15, photos: 0.35 },
  geo: { fullM: 150, zeroM: 800, gateM: 1000 },
  rent: { tolerance: 0.1, gateRatio: 1.25 },
  area: { fullRel: 0.03, zeroRel: 0.15, missing: 0.5 },
  title: { missing: 0.5 },
  photos: { fullHamming: 6, zeroHamming: 16, missing: 0.5, sameSourceMin: 0.9 },
  penalties: { floor: 0.15, furnishing: 0.15 },
  thresholds: { match: 0.70, possible: 0.62 },
} as const;

export type GateReason =
  | 'CLASS'
  | 'PG_SHARING'
  | 'PG_GENDER'
  | 'LOCALITY'
  | 'GEO_FAR'
  | 'RENT_FAR'
  | 'SAME_ROW';
export type CapReason = 'NO_PHOTOS' | 'SAME_SOURCE_PHOTOS';
export type PairDecision = 'match' | 'possible' | 'none';

export interface PairFeatures {
  geo: number | null;
  distM: number | null;
  geoUnknown: boolean;
  rent: number;
  area: number;
  title: number;
  photos: number; // 0.5 when unknown
  minHamming: number | null;
  floorMismatch: boolean;
  furnishingMismatch: boolean;
  sameSource: boolean;
}
export interface PairScore {
  a: string;
  b: string;
  score: number;
  decision: PairDecision;
  cap: CapReason | null;
  features: PairFeatures;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function photoSimilarity(minH: number | null): number | null {
  if (minH === null) return null;
  const { fullHamming, zeroHamming } = SIMILARITY.photos;
  if (minH <= fullHamming) return 1;
  if (minH >= zeroHamming) return 0;
  return (zeroHamming - minH) / (zeroHamming - fullHamming);
}

export function geoSimilarity(distM: number): number {
  const { fullM, zeroM } = SIMILARITY.geo;
  if (distM <= fullM) return 1;
  if (distM >= zeroM) return 0;
  return (zeroM - distM) / (zeroM - fullM);
}

export function rentSimilarity(a: number, b: number): number {
  const mx = Math.max(a, b);
  if (mx <= 0) return 0;
  return 1 - Math.min(1, Math.abs(a - b) / (SIMILARITY.rent.tolerance * mx));
}

export function areaSimilarity(a: number | null, b: number | null): number {
  if (a === null || b === null || !(a > 0) || !(b > 0)) return SIMILARITY.area.missing;
  const rel = Math.abs(a - b) / Math.max(a, b);
  const { fullRel, zeroRel } = SIMILARITY.area;
  if (rel <= fullRel) return 1;
  if (rel >= zeroRel) return 0;
  return (zeroRel - rel) / (zeroRel - fullRel);
}

export function jaccard(a: readonly string[], b: readonly string[]): number | null {
  if (a.length === 0 || b.length === 0) return null;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? null : inter / union;
}

function distanceM(a: DedupRecord, b: DedupRecord): number | null {
  return a.geo && b.geo ? haversineKm(a.geo, b.geo) * 1000 : null;
}

export function gate(
  a: DedupRecord,
  b: DedupRecord,
): { ok: true } | { ok: false; reason: GateReason } {
  if (a.sourceId === b.sourceId && a.sourceListingId === b.sourceListingId) {
    return { ok: false, reason: 'SAME_ROW' };
  }
  const ca = unitClass(a);
  const cb = unitClass(b);
  if (ca === null || cb === null || ca !== cb) return { ok: false, reason: 'CLASS' };
  if (ca === 'pg') {
    if (a.pgSharing !== null && b.pgSharing !== null && a.pgSharing !== b.pgSharing) {
      return { ok: false, reason: 'PG_SHARING' };
    }
    if (a.pgGender !== null && b.pgGender !== null && a.pgGender !== b.pgGender) {
      return { ok: false, reason: 'PG_GENDER' };
    }
  }
  const d = distanceM(a, b);
  if (d === null && a.localityId !== b.localityId) return { ok: false, reason: 'LOCALITY' };
  if (d !== null && d > SIMILARITY.geo.gateM) return { ok: false, reason: 'GEO_FAR' };
  const lo = Math.min(a.rentInr, b.rentInr);
  const hi = Math.max(a.rentInr, b.rentInr);
  if (4 * hi > 5 * lo) return { ok: false, reason: 'RENT_FAR' };
  return { ok: true };
}

export function pairFeatures(a: DedupRecord, b: DedupRecord): PairFeatures {
  const d = distanceM(a, b);
  const mh = minHamming(a.photoHashes, b.photoHashes);
  const ps = photoSimilarity(mh);
  const j = jaccard(a.titleTokens, b.titleTokens);
  return {
    geo: d === null ? null : geoSimilarity(d),
    distM: d,
    geoUnknown: d === null,
    rent: rentSimilarity(a.rentInr, b.rentInr),
    area: areaSimilarity(a.areaSqft, b.areaSqft),
    title: j === null ? SIMILARITY.title.missing : j,
    photos: ps === null ? SIMILARITY.photos.missing : ps,
    minHamming: mh,
    floorMismatch: a.floor !== null && b.floor !== null && a.floor !== b.floor,
    furnishingMismatch:
      a.furnishing !== null && b.furnishing !== null && a.furnishing !== b.furnishing,
    sameSource: a.sourceId === b.sourceId,
  };
}

export function scorePair(a: DedupRecord, b: DedupRecord): PairScore | null {
  if (!gate(a, b).ok) return null;
  if (b.id < a.id) return scorePair(b, a);
  const f = pairFeatures(a, b);
  const w = SIMILARITY.weights;
  let sum = w.rent * f.rent + w.area * f.area + w.title * f.title + w.photos * f.photos;
  let total = 1 - w.geo;
  if (f.geo !== null) {
    sum += w.geo * f.geo;
    total = 1;
  }
  const score = clamp01(
    sum / total -
      (f.floorMismatch ? SIMILARITY.penalties.floor : 0) -
      (f.furnishingMismatch ? SIMILARITY.penalties.furnishing : 0),
  );
  let cap: CapReason | null = null;
  if (f.minHamming === null) cap = 'NO_PHOTOS';
  else if (f.sameSource && f.photos < SIMILARITY.photos.sameSourceMin) cap = 'SAME_SOURCE_PHOTOS';
  let decision: PairDecision = 'none';
  if (score >= SIMILARITY.thresholds.match) decision = cap ? 'possible' : 'match';
  else if (score >= SIMILARITY.thresholds.possible) decision = 'possible';
  return { a: a.id, b: b.id, score, decision, cap, features: f };
}

export function featuresJson(s: PairScore): Record<string, number | boolean | string | null> {
  const f = s.features;
  return {
    geo: f.geo,
    dist_m: f.distM,
    rent: f.rent,
    area: f.area,
    title: f.title,
    photos: f.photos,
    min_hamming: f.minHamming,
    geo_unknown: f.geoUnknown,
    floor_mismatch: f.floorMismatch,
    furnishing_mismatch: f.furnishingMismatch,
    same_source: f.sameSource,
    cap: s.cap,
    raw_decision: s.decision === 'none' ? null : s.decision,
  };
}
