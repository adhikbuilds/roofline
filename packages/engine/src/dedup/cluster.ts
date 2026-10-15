import { haversineKm } from '../geo';
import type { DedupRecord } from './types';

export const GUARDS = { maxSpanM: 1000, maxRentRatio: 1.25, maxMembers: 8 } as const;

export type GuardCode = 'GEO_SPAN' | 'RENT_SPREAD' | 'SOURCE_DUP' | 'SIZE';

const SAME_SOURCE_MIN_PHOTOS = 0.9;

export class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly rank = new Map<string, number>();

  constructor(ids: Iterable<string>) {
    for (const id of ids) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(x: string): string {
    let root = x;
    for (;;) {
      const p = this.parent.get(root);
      if (p === undefined) throw new RangeError(`UnionFind: unknown id ${x}`);
      if (p === root) break;
      root = p;
    }
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    const ka = this.rank.get(ra)!;
    const kb = this.rank.get(rb)!;
    if (ka < kb) this.parent.set(ra, rb);
    else if (ka > kb) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, ka + 1);
    }
    return true;
  }

  /** Members sorted; components sorted by first member. */
  components(): string[][] {
    const groups = new Map<string, string[]>();
    for (const id of [...this.parent.keys()].sort()) {
      const r = this.find(id);
      const g = groups.get(r);
      if (g) g.push(id);
      else groups.set(r, [id]);
    }
    return [...groups.values()].sort((x, y) => (x[0]! < y[0]! ? -1 : x[0]! > y[0]! ? 1 : 0));
  }
}

export interface MatchEdge {
  readonly a: string;
  readonly b: string;
  readonly score: number;
  readonly photos: number;
}
export interface Cluster {
  readonly key: string;
  readonly memberIds: readonly string[];
}
export interface GuardSplit {
  readonly a: string;
  readonly b: string;
  readonly score: number;
  readonly guard: GuardCode;
}
export interface ClusterResult {
  clusters: Cluster[];
  guardSplits: GuardSplit[];
  stats: {
    components: number;
    violating: number;
    splitInto: number;
    byGuard: Record<GuardCode, number>;
  };
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** [] = valid; order: GEO_SPAN, RENT_SPREAD, SOURCE_DUP, SIZE. */
export function checkGuards(
  members: readonly DedupRecord[],
  edgesWithin: readonly MatchEdge[],
): GuardCode[] {
  const out: GuardCode[] = [];

  let span = false;
  const geoMembers = members.filter((m) => m.geo !== null);
  for (let i = 0; i < geoMembers.length && !span; i++) {
    for (let j = i + 1; j < geoMembers.length; j++) {
      if (haversineKm(geoMembers[i]!.geo!, geoMembers[j]!.geo!) * 1000 > GUARDS.maxSpanM) {
        span = true;
        break;
      }
    }
  }
  if (span) out.push('GEO_SPAN');

  if (members.length > 0) {
    let min = Infinity;
    let max = -Infinity;
    for (const m of members) {
      if (m.rentInr < min) min = m.rentInr;
      if (m.rentInr > max) max = m.rentInr;
    }
    // maxRentRatio = 5/4, compared in integers
    if (4 * max > 5 * min) out.push('RENT_SPREAD');
  }

  let dup = false;
  const strong = new Set<string>();
  for (const e of edgesWithin) {
    if (e.photos >= SAME_SOURCE_MIN_PHOTOS) strong.add(pairKey(e.a, e.b));
  }
  for (let i = 0; i < members.length && !dup; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const x = members[i]!;
      const y = members[j]!;
      if (x.sourceId === y.sourceId && !strong.has(pairKey(x.id, y.id))) {
        dup = true;
        break;
      }
    }
  }
  if (dup) out.push('SOURCE_DUP');

  if (members.length > GUARDS.maxMembers) out.push('SIZE');
  return out;
}

function compareEdges(x: MatchEdge, y: MatchEdge): number {
  if (x.score !== y.score) return y.score - x.score;
  if (x.a !== y.a) return x.a < y.a ? -1 : 1;
  if (x.b !== y.b) return x.b < y.b ? -1 : 1;
  return 0;
}

export function clusterRecords(
  records: ReadonlyMap<string, DedupRecord>,
  edges: readonly MatchEdge[],
): ClusterResult {
  // normalise, filter to known endpoints, de-duplicate (highest score, then photos, wins)
  const best = new Map<string, MatchEdge>();
  for (const e of edges) {
    if (e.a === e.b || !records.has(e.a) || !records.has(e.b)) continue;
    const n: MatchEdge = e.a < e.b ? e : { a: e.b, b: e.a, score: e.score, photos: e.photos };
    const k = pairKey(n.a, n.b);
    const cur = best.get(k);
    if (!cur || n.score > cur.score || (n.score === cur.score && n.photos > cur.photos)) {
      best.set(k, n);
    }
  }
  const all = [...best.values()].sort(compareEdges);

  const uf = new UnionFind(records.keys());
  for (const e of all) uf.union(e.a, e.b);
  const components = uf.components();

  const edgesByRoot = new Map<string, MatchEdge[]>();
  for (const e of all) {
    const r = uf.find(e.a);
    const l = edgesByRoot.get(r);
    if (l) l.push(e);
    else edgesByRoot.set(r, [e]);
  }

  const clusters: Cluster[] = [];
  const guardSplits: GuardSplit[] = [];
  const byGuard: Record<GuardCode, number> = { GEO_SPAN: 0, RENT_SPREAD: 0, SOURCE_DUP: 0, SIZE: 0 };
  let violating = 0;
  let splitInto = 0;

  for (const comp of components) {
    const compEdges = edgesByRoot.get(uf.find(comp[0]!)) ?? [];
    const members = comp.map((id) => records.get(id)!);
    if (checkGuards(members, compEdges).length === 0) {
      clusters.push({ key: comp[0]!, memberIds: comp });
      continue;
    }
    violating++;

    // Phase B: guarded Kruskal rebuild.
    const sub = new UnionFind(comp);
    const subMembers = new Map<string, string[]>(comp.map((id) => [id, [id]]));
    const rejected: Array<{ edge: MatchEdge; guard: GuardCode }> = [];
    for (const e of compEdges) {
      const ra = sub.find(e.a);
      const rb = sub.find(e.b);
      if (ra === rb) continue;
      const merged = [...subMembers.get(ra)!, ...subMembers.get(rb)!];
      const set = new Set(merged);
      const within = compEdges.filter((x) => set.has(x.a) && set.has(x.b));
      const codes = checkGuards(
        merged.map((id) => records.get(id)!),
        within,
      );
      if (codes.length > 0) {
        rejected.push({ edge: e, guard: codes[0]! });
        continue;
      }
      sub.union(e.a, e.b);
      const root = sub.find(e.a);
      subMembers.delete(root === ra ? rb : ra);
      subMembers.set(root, merged);
    }
    const finals = sub.components();
    splitInto += finals.length - 1;
    for (const f of finals) clusters.push({ key: f[0]!, memberIds: f });
    for (const { edge, guard } of rejected) {
      if (sub.find(edge.a) !== sub.find(edge.b)) {
        guardSplits.push({ a: edge.a, b: edge.b, score: edge.score, guard });
        byGuard[guard]++;
      }
    }
  }

  clusters.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  guardSplits.sort((x, y) => (x.a !== y.a ? (x.a < y.a ? -1 : 1) : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
  return {
    clusters,
    guardSplits,
    stats: { components: components.length, violating, splitInto, byGuard },
  };
}
