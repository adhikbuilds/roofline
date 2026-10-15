import { assertFinite } from './validate';

/**
 * Weighted median. Zero-weight items are ignored; if cumulative weight lands
 * exactly on half the total, the two straddling values are averaged.
 * Null for empty input or all-zero weights.
 */
export function weightedMedian(values: readonly number[], weights: readonly number[]): number | null {
  if (values.length !== weights.length) throw new RangeError('weightedMedian: length mismatch');
  assertFinite(values, 'weightedMedian');
  assertFinite(weights, 'weightedMedian');
  const items: Array<[number, number]> = [];
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const w = weights[i]!;
    if (w < 0) throw new RangeError('weightedMedian: weights must be non-negative');
    if (w > 0) {
      items.push([values[i]!, w]);
      total += w;
    }
  }
  if (items.length === 0) return null;
  items.sort((a, b) => a[0] - b[0]);
  const half = total / 2;
  let cum = 0;
  for (let i = 0; i < items.length; i++) {
    cum += items[i]![1];
    if (cum > half) return items[i]![0];
    if (cum === half) return (items[i]![0] + items[i + 1]![0]) / 2;
  }
  return items[items.length - 1]![0];
}
