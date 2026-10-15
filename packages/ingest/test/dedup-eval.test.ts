import { describe, expect, it } from 'vitest';
import { clusterMetrics } from '../src/eval/dedup-eval';

const L = (predicted: string, truth: string) => ({ predicted, truth });

describe('clusterMetrics (hand-computed)', () => {
  it('perfect clustering scores 1 everywhere', () => {
    const m = clusterMetrics([L('a', 'u1'), L('a', 'u1'), L('b', 'u2')]);
    expect(m).toMatchObject({ precision: 1, recall: 1, bcubedPrecision: 1, bcubedRecall: 1, bcubedF1: 1, truePairs: 1, predictedPairs: 1, tp: 1 });
  });

  it('over-merge: two truth units in one predicted cluster', () => {
    // predicted {1,2,3,4}; truth {1,2} {3,4}: predicted pairs 6, true pairs 2, tp 2
    const m = clusterMetrics([L('a', 'u1'), L('a', 'u1'), L('a', 'u2'), L('a', 'u2')]);
    expect(m.precision).toBeCloseTo(2 / 6, 12);
    expect(m.recall).toBe(1);
    expect(m.bcubedPrecision).toBeCloseTo(0.5, 12);
    expect(m.bcubedRecall).toBe(1);
    expect(m.bcubedF1).toBeCloseTo(2 * 0.5 / 1.5, 12);
  });

  it('under-merge: one truth unit split in two', () => {
    // truth {1,2,3}; predicted {1,2} {3}: true pairs 3, predicted 1, tp 1
    const m = clusterMetrics([L('a', 'u'), L('a', 'u'), L('b', 'u')]);
    expect(m.precision).toBe(1);
    expect(m.recall).toBeCloseTo(1 / 3, 12);
    expect(m.bcubedRecall).toBeCloseTo((2 / 3 + 2 / 3 + 1 / 3) / 3, 12);
  });

  it('an empty population and all-singletons are vacuously perfect', () => {
    expect(clusterMetrics([])).toMatchObject({ precision: 1, recall: 1, bcubedF1: 1 });
    expect(clusterMetrics([L('a', 'x'), L('b', 'y')])).toMatchObject({ precision: 1, recall: 1, bcubedF1: 1 });
  });
});
