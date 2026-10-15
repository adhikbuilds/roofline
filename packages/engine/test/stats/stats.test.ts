import { describe, expect, it } from 'vitest';
import {
  iqr,
  mad,
  median,
  quantile,
  quantiles,
  theilSenSlope,
  weightedMedian,
} from '../../src/stats';

describe('median', () => {
  it.each([
    [[1], 1],
    [[2, 1], 1.5],
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2.5],
    [[5, 5, 5, 5], 5],
    [[-1, -3, -2], -2],
    [[1, 1, 2, 2, 3], 2],
  ])('median(%j) = %d', (xs, expected) => {
    expect(median(xs)).toBe(expected);
  });
  it('returns null for empty', () => expect(median([])).toBeNull());
  it('does not mutate input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
  it('rejects NaN and Infinity', () => {
    expect(() => median([1, NaN])).toThrow(RangeError);
    expect(() => median([1, Infinity])).toThrow(RangeError);
    expect(() => median([1, -Infinity])).toThrow(RangeError);
  });
  it('handles 10k+ items', () => {
    const xs = Array.from({ length: 10001 }, (_, i) => (i * 7919) % 10001);
    expect(median(xs)).toBe(5000);
  });
});

describe('quantile (type 7)', () => {
  const xs = [1, 2, 3, 4, 5];
  it.each([
    [0, 1],
    [0.25, 2],
    [0.5, 3],
    [0.75, 4],
    [1, 5],
    [0.1, 1.4],
  ])('p=%d -> %d', (p, expected) => {
    expect(quantile(xs, p)).toBeCloseTo(expected, 12);
  });
  it('matches R quantile(c(1,2,3,4), c(.25,.5,.9)) = 1.75 2.5 3.7', () => {
    expect(quantile([4, 2, 1, 3], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantile([4, 2, 1, 3], 0.5)).toBeCloseTo(2.5, 12);
    expect(quantile([4, 2, 1, 3], 0.9)).toBeCloseTo(3.7, 12);
  });
  it('single value returns that value for any p', () => {
    expect(quantile([7], 0)).toBe(7);
    expect(quantile([7], 0.3)).toBe(7);
    expect(quantile([7], 1)).toBe(7);
  });
  it('empty returns null', () => expect(quantile([], 0.5)).toBeNull());
  it('rejects p outside [0,1] or NaN', () => {
    expect(() => quantile(xs, -0.1)).toThrow(RangeError);
    expect(() => quantile(xs, 1.1)).toThrow(RangeError);
    expect(() => quantile(xs, NaN)).toThrow(RangeError);
  });
  it('rejects NaN data', () => expect(() => quantile([1, NaN], 0.5)).toThrow(RangeError));
  it('handles ties', () => expect(quantile([2, 2, 2, 9], 0.5)).toBe(2));
  it('quantiles returns many at once', () => {
    expect(quantiles([1, 2, 3, 4, 5], [0, 0.5, 1])).toEqual([1, 3, 5]);
    expect(quantiles([], [0.5])).toEqual([null]);
  });
  it('quantiles validates p', () => {
    expect(() => quantiles([1], [2])).toThrow(RangeError);
  });
});

describe('mad', () => {
  it.each([
    [[1], 0],
    [[5, 5, 5], 0],
    [[1, 1, 2, 2, 4, 6, 9], 1], // classic example
    [[1, 2, 3, 4, 5], 1],
    [[1, 2], 0.5],
  ])('mad(%j) = %d', (xs, expected) => {
    expect(mad(xs)).toBe(expected);
  });
  it('empty -> null', () => expect(mad([])).toBeNull());
  it('NaN rejected', () => expect(() => mad([1, NaN])).toThrow(RangeError));
  it('is robust to an outlier', () => {
    expect(mad([10, 11, 12, 13, 1e9])).toBe(1);
  });
});

describe('iqr', () => {
  it('computes q3 - q1', () => {
    expect(iqr([1, 2, 3, 4, 5])).toBe(2);
    expect(iqr([1, 2, 3, 4])).toBeCloseTo(1.5, 12);
  });
  it('single value -> 0, ties -> 0', () => {
    expect(iqr([3])).toBe(0);
    expect(iqr([4, 4, 4])).toBe(0);
  });
  it('empty -> null', () => expect(iqr([])).toBeNull());
  it('NaN rejected', () => expect(() => iqr([NaN])).toThrow(RangeError));
});

describe('theilSenSlope', () => {
  it('recovers an exact line', () => {
    const x = [1, 2, 3, 4, 5];
    expect(theilSenSlope(x, x.map((v) => 3 * v + 2))).toBeCloseTo(3, 12);
  });
  it('is robust to a gross outlier', () => {
    const x = [1, 2, 3, 4, 5, 6, 7];
    const y = [2, 4, 6, 8, 10, 12, 1000];
    expect(theilSenSlope(x, y)).toBeCloseTo(2, 12);
  });
  it('handles negative and zero slope', () => {
    expect(theilSenSlope([1, 2, 3], [3, 2, 1])).toBe(-1);
    expect(theilSenSlope([1, 2, 3], [5, 5, 5])).toBe(0);
  });
  it('skips pairs with tied x', () => {
    expect(theilSenSlope([1, 1, 2, 3], [1, 9, 3, 5])).toBeDefined();
    expect(theilSenSlope([1, 1, 2], [0, 0, 2])).toBe(2);
  });
  it('returns null for empty, single point, or all x equal', () => {
    expect(theilSenSlope([], [])).toBeNull();
    expect(theilSenSlope([1], [1])).toBeNull();
    expect(theilSenSlope([2, 2, 2], [1, 2, 3])).toBeNull();
  });
  it('throws on length mismatch and NaN', () => {
    expect(() => theilSenSlope([1, 2], [1])).toThrow(RangeError);
    expect(() => theilSenSlope([1, NaN], [1, 2])).toThrow(RangeError);
    expect(() => theilSenSlope([1, 2], [1, NaN])).toThrow(RangeError);
  });
  it('handles 500 points', () => {
    const x = Array.from({ length: 500 }, (_, i) => i);
    expect(theilSenSlope(x, x.map((v) => 0.5 * v))).toBeCloseTo(0.5, 12);
  });
});

describe('weightedMedian', () => {
  it('equal weights equals the lower/upper-mid average for even n', () => {
    expect(weightedMedian([1, 2, 3, 4], [1, 1, 1, 1])).toBe(2.5);
    expect(weightedMedian([1, 2, 3], [1, 1, 1])).toBe(2);
  });
  it('heavy weight dominates', () => {
    expect(weightedMedian([1, 2, 3], [1, 1, 10])).toBe(3);
    expect(weightedMedian([10, 20, 30], [5, 1, 1])).toBe(10);
  });
  it('unsorted input is handled', () => {
    expect(weightedMedian([3, 1, 2], [10, 1, 1])).toBe(3);
  });
  it('averages when cumulative weight lands exactly on half', () => {
    expect(weightedMedian([1, 2], [1, 1])).toBe(1.5);
    expect(weightedMedian([1, 2, 3], [1, 2, 1])).toBe(2);
  });
  it('ignores zero-weight items', () => {
    expect(weightedMedian([1, 100], [1, 0])).toBe(1);
    expect(weightedMedian([1, 2, 100], [1, 1, 0])).toBe(1.5);
  });
  it('single value', () => expect(weightedMedian([5], [2])).toBe(5));
  it('empty or all-zero weights -> null', () => {
    expect(weightedMedian([], [])).toBeNull();
    expect(weightedMedian([1, 2], [0, 0])).toBeNull();
  });
  it('rejects negative weights, NaN, mismatch', () => {
    expect(() => weightedMedian([1, 2], [1, -1])).toThrow(RangeError);
    expect(() => weightedMedian([1, NaN], [1, 1])).toThrow(RangeError);
    expect(() => weightedMedian([1, 2], [1, NaN])).toThrow(RangeError);
    expect(() => weightedMedian([1, 2], [1])).toThrow(RangeError);
    expect(() => weightedMedian([1], [Infinity])).toThrow(RangeError);
  });
});
