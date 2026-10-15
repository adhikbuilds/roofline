import { sortedCopy } from './validate';

function q7(sorted: readonly number[], p: number): number {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

function checkP(p: number, fn: string): void {
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new RangeError(`${fn}: p must be in [0,1]`);
}

/** Median; null for empty input. Throws on NaN/Infinity. */
export function median(xs: readonly number[]): number | null {
  return quantile(xs, 0.5);
}

/** Type-7 (R default, linear interpolation) quantile; null for empty input. */
export function quantile(xs: readonly number[], p: number): number | null {
  checkP(p, 'quantile');
  const s = sortedCopy(xs, 'quantile');
  return s.length === 0 ? null : q7(s, p);
}

/** Several type-7 quantiles over one sort. Entries are null for empty input. */
export function quantiles(xs: readonly number[], ps: readonly number[]): Array<number | null> {
  for (const p of ps) checkP(p, 'quantiles');
  const s = sortedCopy(xs, 'quantiles');
  return ps.map((p) => (s.length === 0 ? null : q7(s, p)));
}

/** Raw (unscaled) median absolute deviation; null for empty input. */
export function mad(xs: readonly number[]): number | null {
  const m = median(xs);
  if (m === null) return null;
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Interquartile range (type-7 q3 - q1); null for empty input. */
export function iqr(xs: readonly number[]): number | null {
  const [q1, q3] = quantiles(xs, [0.25, 0.75]);
  return q1 === null || q3 === null || q1 === undefined || q3 === undefined ? null : q3 - q1;
}
