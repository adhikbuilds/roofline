import { describe, expect, it } from 'vitest';
import {
  assignIdentities,
  compareCanonical,
  completeness,
  pickCanonical,
  summarizeCluster,
  type ClusterSeed,
  type PriorListing,
} from '../../src/dedup/canonical';
import { rec } from './fixtures';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const full = {
  areaSqft: 1000,
  depositInr: 1,
  maintenanceInr: 1,
  furnishing: 'furnished' as const,
  photoHashes: [1n, 2n, 3n],
};

describe('completeness', () => {
  it('is 0 for an empty row (invalid geo too)', () => {
    expect(completeness(rec(id(1), { geo: null }))).toBe(0);
    expect(completeness(rec(id(1), { geo: { lat: NaN, lng: 1 } }))).toBe(0);
  });
  it('is 8 for a full row and caps photos at 3', () => {
    expect(completeness(rec(id(1), full))).toBe(8);
    expect(completeness(rec(id(1), { ...full, photoHashes: [1n, 2n, 3n, 4n, 5n] }))).toBe(8);
  });
  it('counts each field once', () => {
    expect(completeness(rec(id(1), { geo: null, areaSqft: 5 }))).toBe(1);
    expect(completeness(rec(id(1), { geo: null, photoHashes: [1n] }))).toBe(1);
    expect(completeness(rec(id(1), { geo: null, photoHashes: [1n, 2n] }))).toBe(2);
    expect(completeness(rec(id(1), { geo: null, depositInr: 0 }))).toBe(1);
  });
});

describe('compareCanonical / pickCanonical', () => {
  const lean = rec(id(1), { geo: null, lastSeenAt: 9_000 });
  const rich = rec(id(2), { ...full, lastSeenAt: 1 });
  it('completeness wins over recency and incumbency', () => {
    expect(pickCanonical([lean, rich], lean.id).id).toBe(rich.id);
    expect(compareCanonical(rich, lean, lean.id)).toBeLessThan(0);
  });
  it('incumbent beats recency on a completeness tie', () => {
    const a = rec(id(1), { lastSeenAt: 1 });
    const b = rec(id(2), { lastSeenAt: 99 });
    expect(pickCanonical([a, b], null).id).toBe(b.id);
    expect(pickCanonical([a, b], a.id).id).toBe(a.id);
  });
  it('then recency, then source priority (lower first), then id', () => {
    const a = rec(id(1), { lastSeenAt: 5, sourcePriority: 2 });
    const b = rec(id(2), { lastSeenAt: 6, sourcePriority: 9 });
    expect(pickCanonical([a, b], null).id).toBe(b.id);
    const c = rec(id(3), { lastSeenAt: 5, sourcePriority: 1 });
    expect(pickCanonical([a, c], null).id).toBe(c.id);
    const d = rec(id(4), { lastSeenAt: 5, sourcePriority: 1 });
    expect(pickCanonical([d, c], null).id).toBe(c.id);
    expect(compareCanonical(c, c, null)).toBe(0);
  });
  it('is order independent and rejects empty', () => {
    expect(pickCanonical([rich, lean], null).id).toBe(pickCanonical([lean, rich], null).id);
    expect(() => pickCanonical([], null)).toThrow();
  });
});

describe('summarizeCluster', () => {
  it('builds one entry per source with min rent, sorted', () => {
    const a1 = rec(id(1), { sourceId: 'b', rentInr: 31000, firstSeenAt: 50, ...full });
    const a2 = rec(id(2), { sourceId: 'b', rentInr: 30000, firstSeenAt: 70 });
    const c = rec(id(3), { sourceId: 'a', rentInr: 32000, firstSeenAt: 10 });
    const v = summarizeCluster([c, a2, a1], null);
    expect(v.canonicalId).toBe(a1.id);
    expect(v.memberCount).toBe(3);
    expect(v.sourceCount).toBe(2);
    expect(v.sourceIds).toEqual(['a', 'b']);
    expect(v.rentMinInr).toBe(30000);
    expect(v.rentMaxInr).toBe(32000);
    expect(v.firstSeenAt).toBe(10);
    expect(v.sources).toEqual([
      { sourceId: 'b', rentInr: 30000, memberIds: [a1.id, a2.id], isCanonical: true },
      { sourceId: 'a', rentInr: 32000, memberIds: [c.id], isCanonical: false },
    ]);
  });
  it('breaks equal rents by sourceId', () => {
    const x = rec(id(1), { sourceId: 'z' });
    const y = rec(id(2), { sourceId: 'y' });
    expect(summarizeCluster([x, y], null).sources.map((s) => s.sourceId)).toEqual(['y', 'z']);
  });
});

describe('assignIdentities', () => {
  const seed = (n: number) => ({ sourceId: 's', sourceListingId: `L${n}` });
  const cl = (key: number, members: number[], firstSeenAt?: number): ClusterSeed => ({
    key: id(key),
    memberIds: members.map(id),
    seed: seed(key),
    ...(firstSeenAt === undefined ? {} : { firstSeenAt }),
  });
  const prior = (n: number, members: number[], firstSeenAt = 100): PriorListing => ({
    id: `p${n}`,
    firstSeenAt,
    memberIds: members.map(id),
  });
  const mint = (s: { sourceListingId: string }, n: number) => `m:${s.sourceListingId}#${n}`;
  const never = () => false;

  it('inherits one-to-one on identical membership', () => {
    const r = assignIdentities([cl(1, [1, 2])], [prior(1, [1, 2])], mint, never);
    expect(r.assignments).toEqual([
      { clusterKey: id(1), listingId: 'p1', origin: 'inherited', overlap: 2, priorFirstSeenAt: 100 },
    ]);
    expect(r.redirects).toEqual([]);
    expect(r.orphaned).toEqual([]);
  });

  it('mints for brand new clusters, bumping attempt while taken', () => {
    const taken = new Set(['m:L5#0', 'm:L5#1']);
    const r = assignIdentities([cl(5, [5])], [], mint, (x) => taken.has(x));
    expect(r.assignments[0]).toMatchObject({
      listingId: 'm:L5#2',
      origin: 'minted',
      overlap: 0,
      priorFirstSeenAt: null,
    });
  });

  it('does not mint the same id twice in a run', () => {
    const same = () => 'dup';
    const dupMint = (_s: unknown, n: number) => (n === 0 ? 'dup' : `dup#${n}`);
    const r = assignIdentities([cl(1, [1]), cl(2, [2])], [], dupMint, never);
    void same;
    expect(r.assignments.map((a) => a.listingId)).toEqual(['dup', 'dup#1']);
  });

  it('merge: largest overlap keeps its id, other prior redirects to it', () => {
    const r = assignIdentities(
      [cl(1, [1, 2, 3])],
      [prior(1, [1, 2]), prior(2, [3], 50)],
      mint,
      never,
    );
    expect(r.assignments[0]).toMatchObject({ listingId: 'p1', origin: 'inherited' });
    expect(r.redirects).toEqual([{ oldId: 'p2', newId: 'p1' }]);
    expect(r.orphaned).toEqual([]);
  });

  it('merge tie on overlap: older firstSeenAt wins', () => {
    const r = assignIdentities(
      [cl(1, [1, 2])],
      [prior(1, [1], 200), prior(2, [2], 100)],
      mint,
      never,
    );
    expect(r.assignments[0]!.listingId).toBe('p2');
    expect(r.redirects).toEqual([{ oldId: 'p1', newId: 'p2' }]);
  });

  it('split: largest piece keeps id, others mint, no redirect', () => {
    const r = assignIdentities([cl(1, [1, 2]), cl(3, [3])], [prior(1, [1, 2, 3])], mint, never);
    expect(r.assignments).toEqual([
      { clusterKey: id(1), listingId: 'p1', origin: 'inherited', overlap: 2, priorFirstSeenAt: 100 },
      { clusterKey: id(3), listingId: 'm:L3#0', origin: 'minted', overlap: 0, priorFirstSeenAt: null },
    ]);
    expect(r.redirects).toEqual([]);
  });

  it('prior with no overlapping cluster is orphaned without redirect', () => {
    const r = assignIdentities([cl(1, [1])], [prior(1, [1]), prior(2, [9])], mint, never);
    expect(r.orphaned).toEqual(['p2']);
    expect(r.redirects).toEqual([]);
  });

  it('redirect target ties break on cluster firstSeenAt then listing id', () => {
    // p0 overlaps C1 and C2 equally but both are taken by other priors with bigger overlap
    const clusters = [cl(1, [1, 2, 3], 20), cl(4, [4, 5, 6], 10)];
    const priors = [prior(1, [1, 2, 3]), prior(2, [4, 5, 6]), prior(0, [3, 4], 500)];
    const r = assignIdentities(clusters, priors, mint, never);
    expect(r.redirects).toEqual([{ oldId: 'p0', newId: 'p2' }]);
  });

  it('never redirects to itself and is order independent', () => {
    const cs = [cl(1, [1, 2]), cl(3, [3])];
    const ps = [prior(1, [1, 2, 3]), prior(2, [4])];
    const a = assignIdentities(cs, ps, mint, never);
    const b = assignIdentities([...cs].reverse(), [...ps].reverse(), mint, never);
    expect(b).toEqual(a);
    expect(a.redirects.every((x) => x.oldId !== x.newId)).toBe(true);
  });
});
