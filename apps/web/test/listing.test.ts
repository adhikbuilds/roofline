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
