/**
 * Price-vs-fair badges. Intervals are right-closed (lo, hi]: every boundary belongs to the cheaper bin,
 * matching PLAN 3.2 ("<= -20%" great deal, "> +20%" overpriced). Pure.
 */

export type BadgeConfidence = 'high' | 'medium' | 'low';
export type BadgeName = 'great_deal' | 'good_price' | 'fair' | 'above_market' | 'overpriced';

export const BADGE_EDGES = [-0.2, -0.08, 0.08, 0.2] as const;

function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/** (rent - expected) / expected, computed on integer rupees so boundaries are exact. */
export function deltaOf(rentInr: number, expectedInr: number): number {
  if (!isPositiveInt(rentInr) || !isPositiveInt(expectedInr)) {
    throw new RangeError(`deltaOf needs positive integers, got rent=${rentInr}, expected=${expectedInr}`);
  }
  return (rentInr - expectedInr) / expectedInr;
}

/** The value Postgres `real` columns will hold. */
export function storedDelta(delta: number): number {
  return Math.fround(delta);
}

export function badgeFor(delta: number, confidence: BadgeConfidence): BadgeName | null {
  if (confidence === 'low' || !Number.isFinite(delta)) return null;
  const [e1, e2, e3, e4] = BADGE_EDGES;
  if (delta <= e1) return 'great_deal';
  if (delta <= e2) return 'good_price';
  if (delta <= e3) return 'fair';
  if (delta <= e4) return 'above_market';
  return 'overpriced';
}
