import { describe, expect, it } from 'vitest';
import { MAX_REDIRECT_HOPS, buildStepChart, parseListingId, resolveRedirect } from '../lib/listing-detail';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';

describe('parseListingId', () => {
  it('accepts a uuid and lowercases it', () => {
    expect(parseListingId(A.toUpperCase())).toBe(A);
  });
  it.each(['', 'abc', 'not-a-uuid', `${A}x`, "1' OR 1=1 --", A.slice(0, 35), '../../etc'])('rejects %s', (v) => {
    expect(parseListingId(v)).toBeNull();
  });
});

describe('resolveRedirect', () => {
  const lookup = (m: Record<string, string>) => async (id: string) => m[id] ?? null;
  const live = (...ids: string[]) => async (id: string) => ids.includes(id);

  it('returns the id itself when it is live', async () => {
    expect(await resolveRedirect(A, lookup({}), live(A))).toEqual({ kind: 'found', id: A });
  });
  it('follows one hop', async () => {
    expect(await resolveRedirect(A, lookup({ [A]: B }), live(B))).toEqual({ kind: 'redirect', id: B });
  });
  it('follows up to three hops', async () => {
    expect(MAX_REDIRECT_HOPS).toBe(3);
    expect(await resolveRedirect(A, lookup({ [A]: B, [B]: C, [C]: D }), live(D))).toEqual({ kind: 'redirect', id: D });
  });
  it('gives up after four hops', async () => {
    const m = { [A]: B, [B]: C, [C]: D, [D]: E };
    expect(await resolveRedirect(A, lookup(m), live(E))).toEqual({ kind: 'missing' });
  });
  it('is loop safe', async () => {
    expect(await resolveRedirect(A, lookup({ [A]: B, [B]: A }), live())).toEqual({ kind: 'missing' });
  });
  it('is missing when nothing matches', async () => {
    expect(await resolveRedirect(A, lookup({}), live())).toEqual({ kind: 'missing' });
  });
});

describe('buildStepChart', () => {
  it('returns no chart for an empty series', () => {
    expect(buildStepChart([], 300, 100)).toBeNull();
  });
  it('plots one point per observation and steps horizontally first', () => {
    const c = buildStepChart(
      [
        { at: '2026-09-01T00:00:00Z', rentInr: 20000 },
        { at: '2026-09-11T00:00:00Z', rentInr: 22000 },
        { at: '2026-09-21T00:00:00Z', rentInr: 22000 },
      ],
      300,
      100,
    )!;
    expect(c.points).toHaveLength(3);
    expect(c.points[0]!.x).toBeLessThan(c.points[2]!.x);
    expect(c.points[1]!.y).toBeLessThan(c.points[0]!.y); // higher rent plots higher (smaller y)
    expect(c.path.startsWith('M')).toBe(true);
    expect(c.path).toContain(`H${c.points[1]!.x}`);
  });
  it('handles a flat series without dividing by zero', () => {
    const c = buildStepChart(
      [
        { at: '2026-09-01T00:00:00Z', rentInr: 20000 },
        { at: '2026-09-02T00:00:00Z', rentInr: 20000 },
      ],
      300,
      100,
    )!;
    for (const p of c.points) expect(Number.isFinite(p.y)).toBe(true);
  });
  it('handles a single observation', () => {
    const c = buildStepChart([{ at: '2026-09-01T00:00:00Z', rentInr: 20000 }], 300, 100)!;
    expect(c.points).toHaveLength(1);
    expect(Number.isFinite(c.points[0]!.x)).toBe(true);
  });
});

import { bigRulerLayout, fairGap } from '../lib/listing-detail';

describe('bigRulerLayout', () => {
  it('keeps every mark inside 0..100 and ordered by rupees', () => {
    const r = bigRulerLayout({ rentInr: 20000, fairInr: 26000, lowInr: 22000, highInr: 30000 });
    for (const p of Object.values(r)) expect(p).toBeGreaterThanOrEqual(0), expect(p).toBeLessThanOrEqual(100);
    expect(r.rentPct).toBeLessThan(r.lowPct);
    expect(r.lowPct).toBeLessThan(r.fairPct);
    expect(r.fairPct).toBeLessThan(r.highPct);
  });
  it('pads the extremes away from the edges', () => {
    const r = bigRulerLayout({ rentInr: 30000, fairInr: 26000, lowInr: 22000, highInr: 30000 }, 0.1);
    expect(r.lowPct).toBe(10);
    expect(r.highPct).toBe(90);
  });
  it('centres everything when all values coincide', () => {
    expect(bigRulerLayout({ rentInr: 5, fairInr: 5, lowInr: 5, highInr: 5 })).toEqual({ lowPct: 50, highPct: 50, fairPct: 50, rentPct: 50 });
  });
});

describe('fairGap', () => {
  it('reports side, rupee gap and percent', () => {
    expect(fairGap(20000, 25000)).toEqual({ side: 'below', diffInr: 5000, pct: 20 });
    expect(fairGap(30000, 25000)).toEqual({ side: 'above', diffInr: 5000, pct: 20 });
    expect(fairGap(25000, 25000)).toEqual({ side: 'at', diffInr: 0, pct: 0 });
  });
  it('does not divide by zero', () => {
    expect(fairGap(100, 0).pct).toBe(0);
  });
});
