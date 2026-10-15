import { median } from './descriptive';
import { assertFinite } from './validate';

/**
 * Theil-Sen estimator: median of all pairwise slopes (O(n^2)).
 * Pairs with equal x are skipped. Null when no valid pair exists.
 */
export function theilSenSlope(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length) throw new RangeError('theilSenSlope: x and y length mismatch');
  assertFinite(x, 'theilSenSlope');
  assertFinite(y, 'theilSenSlope');
  const slopes: number[] = [];
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      const dx = x[j]! - x[i]!;
      if (dx !== 0) slopes.push((y[j]! - y[i]!) / dx);
    }
  }
  return median(slopes);
}
