import { describe, expect, it } from 'vitest';
import { BADGE_LABEL, NOT_ENOUGH_COMPS_COPY, rulerGeometry, splitReason, toFairInfo, verdictToken } from '../lib/fairness';

describe('rulerGeometry', () => {
  const g = rulerGeometry({ rentInr: 30000, fairInr: 40000, lowInr: 35000, highInr: 45000 });
  it('keeps every x inside the 132px viewBox', () => {
    for (const x of [g.lineX1, g.lineX2, g.stationX, g.markerX]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(132);
    }
  });
  it('orders low <= station <= high', () => {
    expect(g.lineX1).toBeLessThan(g.stationX);
    expect(g.stationX).toBeLessThan(g.lineX2);
  });
  it('puts a below-fair listing left of the station', () => {
    expect(g.markerX).toBeLessThan(g.stationX);
  });
  it('puts an above-fair listing right of the station', () => {
    const a = rulerGeometry({ rentInr: 52000, fairInr: 40000, lowInr: 35000, highInr: 45000 });
    expect(a.markerX).toBeGreaterThan(a.stationX);
  });
  it('clamps far outliers to the ends instead of leaving the box', () => {
    const a = rulerGeometry({ rentInr: 400000, fairInr: 40000, lowInr: 35000, highInr: 45000 });
    expect(a.markerX).toBeLessThanOrEqual(132);
  });
  it('survives a degenerate interval', () => {
    const a = rulerGeometry({ rentInr: 40000, fairInr: 40000, lowInr: 40000, highInr: 40000 });
    for (const x of [a.lineX1, a.lineX2, a.stationX, a.markerX]) expect(Number.isFinite(x)).toBe(true);
  });
});

describe('verdictToken', () => {
  it.each([
    ['great_deal', 'var(--color-deal)'],
    ['good_price', 'var(--color-good)'],
    ['fair', 'var(--color-fair)'],
    ['above_market', 'var(--color-above)'],
    ['overpriced', 'var(--color-over)'],
  ] as const)('%s -> %s', (b, c) => expect(verdictToken(b)).toBe(c));
});

describe('copy', () => {
  it('has a label per badge and never says verified', () => {
    expect(Object.keys(BADGE_LABEL)).toHaveLength(5);
    expect(JSON.stringify(BADGE_LABEL).toLowerCase()).not.toContain('verified');
    expect(NOT_ENOUGH_COMPS_COPY).toBe('Not enough comparable listings');
  });
});

describe('splitReason', () => {
  const r = '23% below fair rent · saves ₹9.1K/mo · high confidence (52 comps) · listed 3 days ago · on 2 sources';
  it('highlights the first segment and keeps the rest in order', () => {
    expect(splitReason(r)).toEqual({
      highlight: '23% below fair rent',
      rest: ['saves ₹9.1K/mo', 'high confidence (52 comps)', 'listed 3 days ago', 'on 2 sources'],
    });
  });
  it('handles a single segment and null', () => {
    expect(splitReason('x')).toEqual({ highlight: 'x', rest: [] });
    expect(splitReason(null)).toEqual({ highlight: '', rest: [] });
  });
});

describe('toFairInfo', () => {
  const base = { fair_rent_inr: 40000, fair_low_inr: 35000, fair_high_inr: 45000, fair_delta_pct: -0.25, badge: 'great_deal', confidence: 'high', fair_explanation: 'x' };
  it('maps a complete row', () => {
    expect(toFairInfo(base)).toMatchObject({ fairInr: 40000, lowInr: 35000, highInr: 45000, deltaPct: -0.25, badge: 'great_deal', confidence: 'high', explanation: 'x' });
  });
  it('returns null when there is no estimate', () => {
    expect(toFairInfo({ ...base, fair_rent_inr: null })).toBeNull();
  });
  it('low confidence keeps the estimate but carries no badge', () => {
    const f = toFairInfo({ ...base, confidence: 'low', badge: null });
    expect(f?.badge).toBeNull();
    expect(f?.confidence).toBe('low');
  });
  it('treats unknown enum values as no estimate', () => {
    expect(toFairInfo({ ...base, confidence: 'weird' })).toBeNull();
  });
});
