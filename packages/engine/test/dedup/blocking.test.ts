import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BANGALORE_BBOX } from '../../src/geo';
import {
  buildBlockIndex,
  candidatePairs,
  indexKeys,
  probeKeys,
  rentBand,
  unitClass,
} from '../../src/dedup';
import type { DedupRecord } from '../../src/dedup';
import { destination, rec } from './helpers';

const toMap = (rs: DedupRecord[]) => new Map(rs.map((r) => [r.id, r]));

describe('unitClass', () => {
  it('maps kinds', () => {
    expect(unitClass({ unitKind: 'rk', bhk: null })).toBe('f0');
    expect(unitClass({ unitKind: 'studio', bhk: null })).toBe('f0');
    expect(unitClass({ unitKind: 'bhk', bhk: 2 })).toBe('f2');
    expect(unitClass({ unitKind: 'bhk', bhk: 5 })).toBe('f5');
    expect(unitClass({ unitKind: 'bhk', bhk: 9 })).toBe('f5');
    expect(unitClass({ unitKind: 'pg_bed', bhk: null })).toBe('pg');
    expect(unitClass({ unitKind: 'bhk', bhk: null })).toBeNull();
  });
});

describe('rentBand', () => {
  it('matches the design example and rejects bad rents', () => {
    expect(rentBand(30000)).toBe(46); // floor(ln 30000 / ln 1.25); band width matches the RENT_FAR gate
    expect(() => rentBand(0)).toThrow(RangeError);
    expect(() => rentBand(-5)).toThrow(RangeError);
    expect(() => rentBand(NaN)).toThrow(RangeError);
  });
  it('is monotone non-decreasing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2_000_000 }), fc.integer({ min: 0, max: 100_000 }), (a, d) => {
        expect(rentBand(a + d)).toBeGreaterThanOrEqual(rentBand(a));
      }),
      { numRuns: 2000 },
    );
  });
});

describe('keys', () => {
  it('geo rows probe 30 keys, geo-less 3, unblockable none', () => {
    expect(probeKeys(rec())).toHaveLength(30);
    expect(probeKeys(rec({ geo: null }))).toHaveLength(3);
    expect(probeKeys(rec({ bhk: null }))).toEqual([]);
    expect(indexKeys(rec({ bhk: null }))).toEqual([]);
  });
  it('index keys: geo -> G+LA, geo-less -> L0+LA', () => {
    expect(indexKeys(rec()).map((k) => k.split(':')[0])).toEqual(['g', 'la']);
    expect(indexKeys(rec({ geo: null })).map((k) => k.split(':')[0])).toEqual(['l0', 'la']);
  });
});

describe('candidatePairs', () => {
  it('finds neighbours, excludes self, normalises and dedups, counts unblockable', () => {
    const a = rec();
    const b = rec({ geo: destination(a.geo!, 1, 100) });
    const c = rec({ bhk: 3 });
    const u = rec({ bhk: null });
    const rs = [a, b, c, u];
    const { pairs, stats } = candidatePairs(buildBlockIndex(rs), toMap(rs), rs.map((r) => r.id));
    expect(pairs).toEqual([{ a: a.id < b.id ? a.id : b.id, b: a.id < b.id ? b.id : a.id }]);
    expect(stats.unblockable).toBe(1);
    expect(stats.probed).toBe(3);
    expect(stats.comparisons).toBe(1);
    expect(stats.perRecordMax).toBe(1);
    expect(stats.largestBlock).toBeGreaterThanOrEqual(2);
  });
  it('only returns pairs touching the probe set', () => {
    const a = rec();
    const b = rec();
    const c = rec({ localityId: 9, geo: { lat: 13.1, lng: 77.5 } });
    const d = rec({ localityId: 9, geo: { lat: 13.1, lng: 77.5 } });
    const rs = [a, b, c, d];
    const { pairs } = candidatePairs(buildBlockIndex(rs), toMap(rs), [c.id]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.a === c.id || pairs[0]!.b === c.id).toBe(true);
  });
  it('geo-less rows pair with same-locality rows only', () => {
    const a = rec({ geo: null });
    const b = rec();
    const c = rec({ localityId: 2 });
    const rs = [a, b, c];
    const { pairs } = candidatePairs(buildBlockIndex(rs), toMap(rs), [a.id]);
    expect(pairs.map((p) => [p.a, p.b].sort().join())).toEqual([[a.id, b.id].sort().join()]);
  });
  it('ignores unknown probe ids and handles empty input', () => {
    const { pairs, stats } = candidatePairs(buildBlockIndex([]), new Map(), ['nope']);
    expect(pairs).toEqual([]);
    expect(stats.perRecordMean).toBe(0);
  });
  it('scales to 10k records', () => {
    const rs: DedupRecord[] = [];
    for (let i = 0; i < 10000; i++) {
      rs.push(rec({ geo: { lat: 12.9 + (i % 100) * 0.001, lng: 77.5 + Math.floor(i / 100) * 0.001 }, rentInr: 10000 + (i % 37) * 900 }));
    }
    const { stats } = candidatePairs(buildBlockIndex(rs), toMap(rs), rs.slice(0, 200).map((r) => r.id));
    expect(stats.probed).toBe(200);
  });
});

describe('blocking recall property', () => {
  const bb = BANGALORE_BBOX;
  const arb = fc.record({
    lat: fc.double({ min: bb.south, max: bb.north, noNaN: true }),
    lng: fc.double({ min: bb.west, max: bb.east, noNaN: true }),
    theta: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    d: fc.double({ min: 0, max: 120, noNaN: true }),
    rent: fc.integer({ min: 1500, max: 1_000_000 }),
    u: fc.double({ min: 0.95, max: 1.05, noNaN: true }),
  });

  it('duplicates within 120 m and +-5% rent share a probe, both directions, with or without geo', () => {
    fc.assert(
      fc.property(arb, fc.boolean(), (x, geoless) => {
        const pg = { lat: x.lat, lng: x.lng };
        const p = rec({ geo: pg, rentInr: x.rent });
        const qGeo = destination(pg, x.theta, x.d);
        const q = rec({ geo: geoless ? null : qGeo, rentInr: Math.max(1, Math.round(x.rent * x.u)) });
        const rs = [p, q];
        const idx = buildBlockIndex(rs);
        const m = toMap(rs);
        const want = p.id < q.id ? { a: p.id, b: q.id } : { a: q.id, b: p.id };
        expect(candidatePairs(idx, m, [p.id]).pairs).toContainEqual(want);
        expect(candidatePairs(idx, m, [q.id]).pairs).toContainEqual(want);
        expect(probeKeys(p)).toHaveLength(30);
        expect(probeKeys(q)).toHaveLength(geoless ? 3 : 30);
      }),
      { numRuns: 3000 },
    );
  });
});
