import { describe, expect, it } from 'vitest';
import { Rng, mulberry32 } from '../src/adapters/synthetic/rng';
import { sha256Hex, stableStringify, uuidFor } from '../src/ids';

describe('mulberry32', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = mulberry32(20261001);
    const b = mulberry32(20261001);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('matches the reference first outputs for seed 20261001 (golden)', () => {
    const r = mulberry32(20261001);
    expect([r(), r(), r()].map((x) => Number(x.toFixed(6)))).toMatchInlineSnapshot(`
      [
        0.319802,
        0.158139,
        0.064232,
      ]
    `);
  });

  it('stays in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('Rng helpers', () => {
  it('int is inclusive on both ends', () => {
    const r = new Rng(3);
    const seen = new Set(Array.from({ length: 500 }, () => r.int(2, 4)));
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it('clippedNormal never exceeds the clip', () => {
    const r = new Rng(5);
    for (let i = 0; i < 5000; i++) expect(Math.abs(r.clippedNormal(2))).toBeLessThanOrEqual(2);
  });

  it('weightedIndex follows the weights', () => {
    const r = new Rng(9);
    const counts = [0, 0];
    for (let i = 0; i < 4000; i++) counts[r.weightedIndex([1, 3])]!++;
    expect(counts[1]! / 4000).toBeGreaterThan(0.7);
    expect(counts[1]! / 4000).toBeLessThan(0.8);
  });

  it('weightedSample returns distinct items and caps at the pool size', () => {
    const r = new Rng(11);
    expect(new Set(r.weightedSample(['a', 'b', 'c'], [1, 1, 1], 3)).size).toBe(3);
    expect(r.weightedSample(['a', 'b'], [1, 1], 5)).toHaveLength(2);
  });

  it('shuffle is a permutation and pick rejects empty input', () => {
    const r = new Rng(13);
    expect(r.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(() => r.pick([])).toThrow(RangeError);
  });
});

describe('ids', () => {
  it('uuidFor is stable, v5-shaped and namespace-sensitive', () => {
    const id = uuidFor('unit', '1');
    expect(id).toBe(uuidFor('unit', '1'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFor('listing', '1')).not.toBe(id);
  });

  it('stableStringify ignores key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
    expect(sha256Hex('x')).toHaveLength(64);
  });
});
