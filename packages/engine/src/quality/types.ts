import type { ReasonCode, WarningCode } from './constants';

export interface QualityRow {
  kind: 'flat' | 'pg';
  /** Flats only; null/undefined when unknown. */
  bhk: number | null;
  rentInr: number;
  areaSqft: number | null;
  /** Resolved locality id, null when text did not resolve. */
  localityId: number | null;
  zone: string | null;
  /** PG rows only. */
  pgSharing: string | null;
  lat: number | null;
  lng: number | null;
  /** Upstream canonicalization already resolved locality from geo. */
  localityFromGeo?: boolean;
}

export interface RuleResult {
  reasons: ReasonCode[];
  warnings: WarningCode[];
}

export type OutlierLevel = 'locality' | 'zone' | 'city' | 'none';

export interface OutlierResult {
  rejected: boolean;
  level: OutlierLevel;
  n: number;
  code?: 'RENT_OUTLIER_MAD' | 'RENT_OUTLIER_IQR';
  z?: number;
}

export interface Assessment {
  status: 'accepted' | 'rejected';
  reasons: ReasonCode[];
  warnings: WarningCode[];
  outlier?: OutlierResult;
}
