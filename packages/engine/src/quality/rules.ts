import { BANGALORE_BBOX, bboxContains } from '../geo';
import { QUALITY_BOUNDS as B, REASON_CODES as R, WARNING_CODES as W } from './constants';
import type { QualityRow, RuleResult } from './types';
import type { ReasonCode, WarningCode } from './constants';

export function hasValidGeo(row: Pick<QualityRow, 'lat' | 'lng'>): boolean {
  const { lat, lng } = row;
  if (lat == null || lng == null) return false;
  if (lat === 0 && lng === 0) return false;
  return bboxContains(BANGALORE_BBOX, { lat, lng });
}

/** Deterministic per-row rules. Pure; no baseline needed. */
export function hardRules(row: QualityRow): RuleResult {
  const reasons: ReasonCode[] = [];
  const warnings: WarningCode[] = [];
  const pg = row.kind === 'pg';
  const [min, max] = pg ? [B.pgRentMin, B.pgRentMax] : [B.flatRentMin, B.flatRentMax];
  const rent = row.rentInr;

  if (Number.isNaN(rent) || rent < min) reasons.push(R.RENT_TOO_LOW);
  else if (rent > max) reasons.push(R.RENT_TOO_HIGH);

  const area = row.areaSqft;
  const hasArea = area != null;
  if (hasArea && !(Number.isFinite(area) && area >= B.areaMin && area <= B.areaMax)) {
    reasons.push(R.AREA_IMPLAUSIBLE);
  } else if (!hasArea && !pg) {
    warnings.push(W.AREA_MISSING);
  }

  if (!pg && hasArea && Number.isFinite(area) && area > 0 && Number.isFinite(rent)) {
    const psf = rent / area;
    if (psf < B.psfMin || psf > B.psfMax) reasons.push(R.PSF_IMPLAUSIBLE);
  }

  if (row.localityId == null) {
    if (hasValidGeo(row)) warnings.push(W.LOCALITY_FROM_GEO);
    else reasons.push(R.GEO_INVALID, R.LOCALITY_UNRESOLVED);
  } else if (row.localityFromGeo) {
    warnings.push(W.LOCALITY_FROM_GEO);
  }

  if (!pg && row.bhk != null && hasArea && Number.isFinite(area) && area >= B.areaMin) {
    const i = Math.min(Math.max(Math.trunc(row.bhk), 0), 5);
    if (area < B.bhkAreaMin[i]! || area > B.bhkAreaMax[i]!) warnings.push(W.BHK_AREA_MISMATCH);
  }

  return { reasons: dedupe(reasons), warnings };
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
