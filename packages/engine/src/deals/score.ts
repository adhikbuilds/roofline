/** Deal eligibility, scoring and reason lines. Pure: time arrives as ISO strings. */
import { formatINRShort } from '../money';
import { pctHalfAway } from '../fairrent/explain';

export const DEAL_RULES = [
  'NO_ESTIMATE',
  'DELTA_ABOVE_MAX',
  'DEAL_TOO_GOOD_TO_VERIFY',
  'LOW_CONFIDENCE',
  'QUALITY_NOT_ACCEPTED',
  'QUALITY_WARNING',
  'FEW_PHOTOS',
  'AREA_UNKNOWN',
  'STALE',
  'SOURCE_SPREAD',
] as const;
export type DealRule = (typeof DEAL_RULES)[number];

export const DEAL_LIMITS = {
  maxDelta: -0.2,
  minDelta: -0.55,
  minPhotos: 3,
  maxStaleDays: 14,
  maxSpreadPct: 15,
  allowedWarnings: ['DEPOSIT_MISSING'],
} as const;

const DAY_MS = 86_400_000;

export interface DealInput {
  listingId: string;
  asOf: string;
  rentInr: number;
  expectedInr: number | null;
  delta: number | null;
  deltaStored: number | null;
  confidence: 'high' | 'medium' | 'low';
  nEff: number;
  qualityStatus: 'accepted' | 'rejected';
  warnings: readonly string[];
  photoCount: number;
  areaSqft: number | null;
  depositInr: number | null;
  floorKnown: boolean;
  parkingKnown: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceCount: number;
  rentMinInr: number;
  rentMaxInr: number;
}

export interface DealComponents {
  magnitude: number;
  confW: number;
  freshness: number;
  completeness: number;
  ageDays: number;
}

export interface DealVerdict {
  listingId: string;
  eligible: boolean;
  failed: DealRule[];
  quarantined: boolean;
  score: number | null;
  reason: string | null;
  components: DealComponents | null;
}

export function dealEligibility(x: DealInput): { failed: DealRule[]; quarantined: boolean } {
  const noEstimate = x.expectedInr === null || x.delta === null || x.deltaStored === null;
  const ds = x.deltaStored;
  const allowed: readonly string[] = DEAL_LIMITS.allowedWarnings;
  const asOfMs = Date.parse(x.asOf);

  const checks: Record<DealRule, boolean> = {
    NO_ESTIMATE: noEstimate,
    DELTA_ABOVE_MAX: ds !== null && ds > DEAL_LIMITS.maxDelta,
    DEAL_TOO_GOOD_TO_VERIFY: ds !== null && ds < DEAL_LIMITS.minDelta,
    LOW_CONFIDENCE: x.confidence === 'low',
    QUALITY_NOT_ACCEPTED: x.qualityStatus !== 'accepted',
    QUALITY_WARNING: x.warnings.some((w) => !allowed.includes(w)),
    FEW_PHOTOS: x.photoCount < DEAL_LIMITS.minPhotos,
    AREA_UNKNOWN: x.areaSqft === null,
    STALE: asOfMs - Date.parse(x.lastSeenAt) > DEAL_LIMITS.maxStaleDays * DAY_MS,
    SOURCE_SPREAD: 100 * (x.rentMaxInr - x.rentMinInr) > DEAL_LIMITS.maxSpreadPct * x.rentMinInr,
  };
  const failed = DEAL_RULES.filter((r) => checks[r]);
  return { failed, quarantined: checks.DEAL_TOO_GOOD_TO_VERIFY };
}

export function dealComponents(x: DealInput): DealComponents {
  const delta = x.delta ?? 0;
  const ageDays = Math.max(0, Math.floor((Date.parse(x.asOf) - Date.parse(x.firstSeenAt)) / DAY_MS));
  const k =
    (x.depositInr !== null ? 1 : 0) +
    (x.photoCount >= 5 ? 1 : 0) +
    (x.floorKnown ? 1 : 0) +
    (x.parkingKnown ? 1 : 0);
  return {
    magnitude: -delta,
    confW: x.confidence === 'high' ? 1 : x.confidence === 'medium' ? 0.75 : 0,
    freshness: Math.max(0.5, 1 - ageDays / 30),
    completeness: 0.8 + (0.2 * k) / 4,
    ageDays,
  };
}

export function dealScore(c: DealComponents): number {
  return c.magnitude * c.confW * c.freshness * c.completeness;
}

export function dealReason(x: DealInput, c: DealComponents): string {
  const expected = x.expectedInr ?? x.rentInr;
  const age = c.ageDays === 0 ? 'today' : c.ageDays === 1 ? '1 day ago' : `${c.ageDays} days ago`;
  const src = x.sourceCount === 1 ? '1 source' : `${x.sourceCount} sources`;
  return [
    `${pctHalfAway(x.delta ?? 0)}% below fair rent`,
    `saves ${formatINRShort(expected - x.rentInr)}/mo`,
    `${x.confidence} confidence (${x.nEff} comps)`,
    `listed ${age}`,
    `on ${src}`,
  ].join(' · ');
}

export function evaluateDeal(x: DealInput): DealVerdict {
  const { failed, quarantined } = dealEligibility(x);
  if (failed.length > 0) {
    return { listingId: x.listingId, eligible: false, failed, quarantined, score: null, reason: null, components: null };
  }
  const components = dealComponents(x);
  return {
    listingId: x.listingId,
    eligible: true,
    failed,
    quarantined,
    score: dealScore(components),
    reason: dealReason(x, components),
    components,
  };
}

export function rankDeals(v: readonly DealVerdict[]): DealVerdict[] {
  return v
    .filter((d) => d.eligible && d.score !== null)
    .sort((a, b) => (b.score as number) - (a.score as number) || (a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0));
}
