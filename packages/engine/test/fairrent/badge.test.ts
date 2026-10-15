import { describe, expect, it } from 'vitest';
import { BADGE_EDGES, badgeFor, deltaOf, storedDelta } from '../../src/fairrent/badge';

describe('deltaOf', () => {
  it('is (rent-expected)/expected on integers', () => {
    expect(deltaOf(33600, 42000)).toBe(-0.2);
    expect(deltaOf(45360, 42000)).toBe(0.08);
    expect(deltaOf(42000, 42000)).toBe(0);
  });
  it.each([
    [0, 100],
    [100, 0],
    [-5, 100],
    [100, -5],
    [100.5, 100],
    [100, Number.NaN],
  ])('throws for non-positive-integer operands (%s, %s)', (r, e) => {
    expect(() => deltaOf(r, e)).toThrow();
  });
});

describe('storedDelta', () => {
  it('rounds to float32', () => {
    expect(storedDelta(-0.2)).toBe(Math.fround(-0.2));
    expect(storedDelta(-0.2)).not.toBe(-0.2);
  });
});

describe('badgeFor boundaries (expected 42,000, intervals right-closed)', () => {
  it.each([
    [33600, 'great_deal'],
    [33601, 'good_price'],
    [38640, 'good_price'],
    [38641, 'fair'],
    [42000, 'fair'],
    [45360, 'fair'],
    [45361, 'above_market'],
    [50400, 'above_market'],
    [50401, 'overpriced'],
  ])('rent %d -> %s', (rent, badge) => {
    expect(badgeFor(deltaOf(rent, 42000), 'high')).toBe(badge);
  });

  it('extremes', () => {
    expect(badgeFor(-0.9, 'medium')).toBe('great_deal');
    expect(badgeFor(5, 'medium')).toBe('overpriced');
  });

  it('is null for low confidence regardless of delta', () => {
    expect(badgeFor(-0.5, 'low')).toBeNull();
    expect(badgeFor(0, 'low')).toBeNull();
  });

  it('is null for non-finite delta', () => {
    expect(badgeFor(Number.NaN, 'high')).toBeNull();
  });

  it('exposes edges', () => {
    expect([...BADGE_EDGES]).toEqual([-0.2, -0.08, 0.08, 0.2]);
  });
});
