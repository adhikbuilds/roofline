import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  GUARDS,
  UnionFind,
  checkGuards,
  clusterRecords,
  type MatchEdge,
} from '../../src/dedup/cluster';
import { haversineKm } from '../../src/geo';
import type { DedupRecord } from '../../src/dedup/types';
import { eastOf, rec } from './fixtures';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const edge = (a: string, b: string, score = 0.9, photos = 1): MatchEdge =>
  a < b ? { a, b, score, photos } : { a: b, b: a, score, photos };
const mapOf = (rs: DedupRecord[]) => new Map(rs.map((r) => [r.id, r]));

describe('UnionFind', () => {
  it('joins, compresses and reports components sorted', () => {
    const uf = new UnionFind(['d', 'c', 'b', 'a', 'e']);
    expect(uf.union('a', 'b')).toBe(true);
    expect(uf.union('b', 'a')).toBe(false);
    uf.union('c', 'd');
    uf.union('b', 'd');
    expect(uf.find('a')).toBe(uf.find('c'));
    expect(uf.find('e')).toBe('e');
    expect(uf.components()).toEqual([['a', 'b', 'c', 'd'], ['e']]);
  });
  it('handles empty input', () => {
    expect(new UnionFind([]).components()).toEqual([]);
  });
});

describe('checkGuards', () => {
  it('exposes constants', () => {
    expect(GUARDS).toEqual({ maxSpanM: 1000, maxRentRatio: 1.25, maxMembers: 8 });
  });
  it('passes a tight cluster', () => {
    const a = rec(id(1));
    const b = rec(id(2), { sourceId: 'src-b', geo: eastOf(100) });
    expect(checkGuards([a, b], [edge(a.id, b.id)])).toEqual([]);
  });
  it('flags GEO_SPAN above 1000 m, ignores geo-less members, allows exactly near-limit', () => {
    const a = rec(id(1), { geo: eastOf(0) });
    const b = rec(id(2), { sourceId: 'b', geo: eastOf(1100) });
    const c = rec(id(3), { sourceId: 'c', geo: null });
    expect(checkGuards([a, b], [])).toEqual(['GEO_SPAN']);
    expect(checkGuards([a, c], [])).toEqual([]);
    const d = rec(id(4), { sourceId: 'd', geo: eastOf(990) });
    expect(checkGuards([a, d], [])).toEqual([]);
  });
  it('flags RENT_SPREAD using integer boundary (1.25 exactly ok)', () => {
    const a = rec(id(1), { rentInr: 20000 });
    const ok = rec(id(2), { sourceId: 'b', rentInr: 25000 });
    const bad = rec(id(3), { sourceId: 'c', rentInr: 25001 });
    expect(checkGuards([a, ok], [])).toEqual([]);
    expect(checkGuards([a, bad], [])).toEqual(['RENT_SPREAD']);
  });
  it('flags SOURCE_DUP unless a direct edge with photos >= 0.9 exists', () => {
    const a = rec(id(1));
    const b = rec(id(2), { sourceListingId: 'other' });
    expect(checkGuards([a, b], [])).toEqual(['SOURCE_DUP']);
    expect(checkGuards([a, b], [edge(a.id, b.id, 0.9, 0.89)])).toEqual(['SOURCE_DUP']);
    expect(checkGuards([a, b], [edge(a.id, b.id, 0.9, 0.9)])).toEqual([]);
  });
  it('flags SIZE above 8 and reports codes in order', () => {
    const rs = Array.from({ length: 9 }, (_, i) => rec(id(i + 1), { sourceId: `s${i}` }));
    expect(checkGuards(rs.slice(0, 8), [])).toEqual([]);
    expect(checkGuards(rs, [])).toEqual(['SIZE']);
    const wide = rs.map((r, i) =>
      i === 0 ? { ...r, geo: eastOf(2000), rentInr: 100000 } : r,
    );
    expect(checkGuards(wide, [])).toEqual(['GEO_SPAN', 'RENT_SPREAD', 'SIZE']);
  });
});

describe('clusterRecords', () => {
  it('returns singletons and valid components as-is', () => {
    const a = rec(id(1), { sourceId: 'a' });
    const b = rec(id(2), { sourceId: 'b', geo: eastOf(50) });
    const c = rec(id(3), { sourceId: 'c' });
    const r = clusterRecords(mapOf([c, b, a]), [edge(b.id, a.id)]);
    expect(r.clusters).toEqual([
      { key: id(1), memberIds: [id(1), id(2)] },
      { key: id(3), memberIds: [id(3)] },
    ]);
    expect(r.guardSplits).toEqual([]);
    expect(r.stats).toMatchObject({ components: 2, violating: 0, splitInto: 0 });
  });

  it('ignores edges whose endpoints are not in records', () => {
    const a = rec(id(1));
    const r = clusterRecords(mapOf([a]), [edge(a.id, id(9))]);
    expect(r.clusters).toEqual([{ key: id(1), memberIds: [id(1)] }]);
  });

  it('splits a 3-chain with 1200 m span: {A,B} and {C}, B-C guard_split(GEO_SPAN)', () => {
    const A = rec(id(1), { sourceId: 'a', geo: eastOf(0) });
    const B = rec(id(2), { sourceId: 'b', geo: eastOf(600) });
    const C = rec(id(3), { sourceId: 'c', geo: eastOf(1200) });
    const r = clusterRecords(mapOf([A, B, C]), [edge(A.id, B.id, 0.9), edge(B.id, C.id, 0.85)]);
    expect(r.clusters.map((c) => c.memberIds)).toEqual([[A.id, B.id], [C.id]]);
    expect(r.guardSplits).toEqual([{ a: B.id, b: C.id, score: 0.85, guard: 'GEO_SPAN' }]);
    expect(r.stats.byGuard.GEO_SPAN).toBe(1);
    expect(r.stats.violating).toBe(1);
    expect(r.stats.splitInto).toBe(1);
  });

  it('splits on RENT_SPREAD, dropping the weakest edge', () => {
    const A = rec(id(1), { sourceId: 'a', rentInr: 20000 });
    const B = rec(id(2), { sourceId: 'b', rentInr: 24000 });
    const C = rec(id(3), { sourceId: 'c', rentInr: 28000 });
    const r = clusterRecords(mapOf([A, B, C]), [edge(A.id, B.id, 0.95), edge(B.id, C.id, 0.8)]);
    expect(r.clusters.map((c) => c.memberIds)).toEqual([[A.id, B.id], [C.id]]);
    expect(r.guardSplits[0]).toMatchObject({ a: B.id, b: C.id, guard: 'RENT_SPREAD' });
  });

  it('keeps match for a rejected edge whose endpoints end up together anyway', () => {
    // triangle where C is far from nobody: all fine -> no violation at all
    const A = rec(id(1), { sourceId: 'a', rentInr: 20000 });
    const B = rec(id(2), { sourceId: 'b', rentInr: 22000 });
    const C = rec(id(3), { sourceId: 'c', rentInr: 26000 });
    // A-C edge would make spread 1.3: A,B,C together invalid. Kruskal: A-B(0.9), B-C(0.85) rejected? B+C+A -> 1.3 reject.
    const r = clusterRecords(mapOf([A, B, C]), [
      edge(A.id, B.id, 0.9),
      edge(B.id, C.id, 0.85),
      edge(A.id, C.id, 0.8),
    ]);
    expect(r.clusters.map((c) => c.memberIds)).toEqual([[A.id, B.id], [C.id]]);
    expect(r.guardSplits.map((g) => [g.a, g.b])).toEqual([
      [A.id, C.id],
      [B.id, C.id],
    ]);
  });

  it('splits same-source members lacking a direct high-photo edge', () => {
    const A = rec(id(1), { sourceId: 'a', sourceListingId: 'x' });
    const B = rec(id(2), { sourceId: 'b' });
    const A2 = rec(id(3), { sourceId: 'a', sourceListingId: 'y' });
    const r = clusterRecords(mapOf([A, B, A2]), [edge(A.id, B.id, 0.9), edge(B.id, A2.id, 0.8)]);
    expect(r.clusters.map((c) => c.memberIds)).toEqual([[A.id, B.id], [A2.id]]);
    expect(r.guardSplits[0]).toMatchObject({ guard: 'SOURCE_DUP' });
  });

  it('caps cluster size at 8', () => {
    const rs = Array.from({ length: 10 }, (_, i) => rec(id(i + 1), { sourceId: `s${i}` }));
    const edges = rs.slice(1).map((r, i) => edge(rs[i]!.id, r.id, 0.99 - i * 0.01));
    const r = clusterRecords(mapOf(rs), edges);
    expect(Math.max(...r.clusters.map((c) => c.memberIds.length))).toBeLessThanOrEqual(8);
    expect(r.guardSplits.every((g) => g.guard === 'SIZE')).toBe(true);
    expect(r.guardSplits.length).toBeGreaterThan(0);
  });
});

// ---- properties ----
const recordsArb = fc
  .integer({ min: 1, max: 12 })
  .chain((n) =>
    fc.tuple(
      fc.array(
        fc.record({
          src: fc.integer({ min: 0, max: 3 }),
          rent: fc.integer({ min: 15000, max: 40000 }),
          east: fc.option(fc.integer({ min: 0, max: 2500 }), { nil: null }),
        }),
        { minLength: n, maxLength: n },
      ),
      fc.array(
        fc.record({
          i: fc.nat(100),
          j: fc.nat(100),
          score: fc.integer({ min: 78, max: 100 }).map((x) => x / 100),
          photos: fc.constantFrom(0.5, 0.95, 1),
        }),
        { maxLength: 30 },
      ),
    ),
  )
  .map(([specs, es]) => {
    const records = specs.map((s, i) =>
      rec(id(i + 1), {
        sourceId: `s${s.src}`,
        sourceListingId: `l${i}`,
        rentInr: s.rent,
        geo: s.east === null ? null : eastOf(s.east),
      }),
    );
    const edges: MatchEdge[] = [];
    for (const e of es) {
      const a = records[e.i % records.length]!;
      const b = records[e.j % records.length]!;
      if (a.id !== b.id) edges.push(edge(a.id, b.id, e.score, e.photos));
    }
    return { records, edges };
  });

function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('clusterRecords properties', () => {
  it('is order independent', () => {
    fc.assert(
      fc.property(recordsArb, fc.nat(), ({ records, edges }, seed) => {
        const base = clusterRecords(mapOf(records), edges);
        const alt = clusterRecords(mapOf(shuffle(records, seed)), shuffle(edges, seed + 1));
        expect(alt).toEqual(base);
      }),
      { numRuns: 300 },
    );
  });

  it('partitions input, clusters are valid and connected by match edges', () => {
    fc.assert(
      fc.property(recordsArb, ({ records, edges }) => {
        const res = clusterRecords(mapOf(records), edges);
        const seen = res.clusters.flatMap((c) => [...c.memberIds]);
        expect([...seen].sort()).toEqual(records.map((r) => r.id).sort());
        const byId = mapOf(records);
        for (const c of res.clusters) {
          expect(c.key).toBe(c.memberIds[0]);
          expect([...c.memberIds]).toEqual([...c.memberIds].sort());
          const set = new Set(c.memberIds);
          const within = edges.filter((e) => set.has(e.a) && set.has(e.b));
          expect(checkGuards(c.memberIds.map((m) => byId.get(m)!), within)).toEqual([]);
          const uf = new UnionFind(c.memberIds);
          for (const e of within) uf.union(e.a, e.b);
          expect(uf.components().length).toBe(1);
          // span sanity independent of checkGuards
          for (const x of c.memberIds)
            for (const y of c.memberIds) {
              const gx = byId.get(x)!.geo;
              const gy = byId.get(y)!.geo;
              if (gx && gy) expect(haversineKm(gx, gy) * 1000).toBeLessThanOrEqual(1000.0001);
            }
        }
        expect(res.clusters.map((c) => c.key)).toEqual(res.clusters.map((c) => c.key).sort());
      }),
      { numRuns: 300 },
    );
  });

  it('is idempotent when clusters are fed back as complete edge sets', () => {
    fc.assert(
      fc.property(recordsArb, ({ records, edges }) => {
        const first = clusterRecords(mapOf(records), edges);
        const complete: MatchEdge[] = [];
        for (const c of first.clusters)
          for (let i = 0; i < c.memberIds.length; i++)
            for (let j = i + 1; j < c.memberIds.length; j++)
              complete.push(edge(c.memberIds[i]!, c.memberIds[j]!, 0.9, 1));
        const second = clusterRecords(mapOf(records), complete);
        expect(second.clusters).toEqual(first.clusters);
        expect(second.guardSplits).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('guard splits only join endpoints in different clusters', () => {
    fc.assert(
      fc.property(recordsArb, ({ records, edges }) => {
        const res = clusterRecords(mapOf(records), edges);
        const of = new Map<string, string>();
        for (const c of res.clusters) for (const m of c.memberIds) of.set(m, c.key);
        for (const g of res.guardSplits) expect(of.get(g.a)).not.toBe(of.get(g.b));
      }),
      { numRuns: 300 },
    );
  });
});
