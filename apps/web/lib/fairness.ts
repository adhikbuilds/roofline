/**
 * Presentation helpers for fair-rent data. The numbers (expected rent, interval, delta, badge, confidence)
 * are computed by the engine at ingest time and read back from the database; nothing here estimates anything.
 * These functions only place already-computed values on the 132px ruler and word them.
 */

export type BadgeName = 'great_deal' | 'good_price' | 'fair' | 'above_market' | 'overpriced';
export type ConfidenceName = 'high' | 'medium' | 'low';

export type FairInfo = {
  fairInr: number;
  lowInr: number | null;
  highInr: number | null;
  deltaPct: number | null;
  badge: BadgeName | null;
  confidence: ConfidenceName;
  explanation: string | null;
};

export type FairRow = {
  fair_rent_inr: number | null;
  fair_low_inr: number | null;
  fair_high_inr: number | null;
  fair_delta_pct: number | null;
  badge: string | null;
  confidence: string | null;
  fair_explanation: string | null;
};

export const BADGE_LABEL: Record<BadgeName, string> = {
  great_deal: 'Great deal',
  good_price: 'Good price',
  fair: 'Fair price',
  above_market: 'Above market',
  overpriced: 'Overpriced',
};

export const NOT_ENOUGH_COMPS_COPY = 'Not enough comparable listings';

const BADGES = new Set<string>(Object.keys(BADGE_LABEL));
const CONFIDENCES = new Set<string>(['high', 'medium', 'low']);

export function toFairInfo(r: FairRow): FairInfo | null {
  if (r.fair_rent_inr == null || r.confidence == null || !CONFIDENCES.has(r.confidence)) return null;
  const badge = r.badge != null && BADGES.has(r.badge) ? (r.badge as BadgeName) : null;
  return {
    fairInr: r.fair_rent_inr,
    lowInr: r.fair_low_inr,
    highInr: r.fair_high_inr,
    deltaPct: r.fair_delta_pct,
    badge,
    confidence: r.confidence as ConfidenceName,
    explanation: r.fair_explanation,
  };
}

export function verdictToken(b: BadgeName): string {
  switch (b) {
    case 'great_deal': return 'var(--color-deal)';
    case 'good_price': return 'var(--color-good)';
    case 'fair': return 'var(--color-fair)';
    case 'above_market': return 'var(--color-above)';
    case 'overpriced': return 'var(--color-over)';
  }
}

export const RULER_WIDTH = 132;
const PAD = 8;

export type RulerGeometry = { lineX1: number; lineX2: number; stationX: number; markerX: number };

/** Linear map of rupees onto the ruler. The domain spans the interval, the station and the listing, with padding. */
export function rulerGeometry(v: { rentInr: number; fairInr: number; lowInr: number; highInr: number }): RulerGeometry {
  const lo = Math.min(v.lowInr, v.fairInr, v.rentInr);
  const hi = Math.max(v.highInr, v.fairInr, v.rentInr);
  const span = hi - lo;
  const x = (r: number) => {
    if (!(span > 0)) return RULER_WIDTH / 2;
    const px = PAD + ((r - lo) / span) * (RULER_WIDTH - 2 * PAD);
    return Math.round(Math.min(RULER_WIDTH - PAD, Math.max(PAD, px)) * 10) / 10;
  };
  return { lineX1: x(v.lowInr), lineX2: x(v.highInr), stationX: x(v.fairInr), markerX: x(v.rentInr) };
}

/** The stored reason is "23% below fair rent · saves ... · ...". The first part is the one that gets highlighted. */
export function splitReason(reason: string | null): { highlight: string; rest: string[] } {
  if (!reason) return { highlight: '', rest: [] };
  const [first = '', ...rest] = reason.split(' · ');
  return { highlight: first, rest };
}
