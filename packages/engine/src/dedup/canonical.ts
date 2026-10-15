import type { DedupRecord } from './types';

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function validGeo(r: DedupRecord): boolean {
  const g = r.geo;
  return (
    g !== null &&
    Number.isFinite(g.lat) &&
    Number.isFinite(g.lng) &&
    g.lat >= -90 &&
    g.lat <= 90 &&
    g.lng >= -180 &&
    g.lng <= 180
  );
}

/** 0..8: min(photos,3) + area + deposit + maintenance + furnishing + valid geo. */
export function completeness(r: DedupRecord): number {
  return (
    Math.min(r.photoHashes.length, 3) +
    (r.areaSqft !== null ? 1 : 0) +
    (r.depositInr !== null ? 1 : 0) +
    (r.maintenanceInr !== null ? 1 : 0) +
    (r.furnishing !== null ? 1 : 0) +
    (validGeo(r) ? 1 : 0)
  );
}

/** Negative if a ranks before b. */
export function compareCanonical(a: DedupRecord, b: DedupRecord, incumbentId: string | null): number {
  const c = completeness(b) - completeness(a);
  if (c !== 0) return c;
  if (incumbentId !== null && a.id !== b.id) {
    if (a.id === incumbentId) return -1;
    if (b.id === incumbentId) return 1;
  }
  if (a.lastSeenAt !== b.lastSeenAt) return b.lastSeenAt - a.lastSeenAt;
  if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
  return cmpStr(a.id, b.id);
}

export function pickCanonical(members: readonly DedupRecord[], incumbentId: string | null): DedupRecord {
  if (members.length === 0) throw new RangeError('pickCanonical: empty cluster');
  return [...members].sort((a, b) => compareCanonical(a, b, incumbentId))[0]!;
}

export interface SourceSummary {
  sourceId: string;
  rentInr: number;
  memberIds: string[];
  isCanonical: boolean;
}
export interface ClusterView {
  canonicalId: string;
  memberCount: number;
  sourceCount: number;
  sourceIds: string[];
  rentMinInr: number;
  rentMaxInr: number;
  sources: SourceSummary[];
  firstSeenAt: number;
}

export function summarizeCluster(
  members: readonly DedupRecord[],
  incumbentId: string | null,
): ClusterView {
  const canonical = pickCanonical(members, incumbentId);
  const bySource = new Map<string, DedupRecord[]>();
  for (const m of members) {
    const l = bySource.get(m.sourceId);
    if (l) l.push(m);
    else bySource.set(m.sourceId, [m]);
  }
  const sources: SourceSummary[] = [...bySource.entries()].map(([sourceId, ms]) => ({
    sourceId,
    rentInr: Math.min(...ms.map((m) => m.rentInr)),
    memberIds: ms.map((m) => m.id).sort(cmpStr),
    isCanonical: ms.some((m) => m.id === canonical.id),
  }));
  sources.sort((x, y) => x.rentInr - y.rentInr || cmpStr(x.sourceId, y.sourceId));
  const rents = members.map((m) => m.rentInr);
  return {
    canonicalId: canonical.id,
    memberCount: members.length,
    sourceCount: sources.length,
    sourceIds: sources.map((s) => s.sourceId).sort(cmpStr),
    rentMinInr: Math.min(...rents),
    rentMaxInr: Math.max(...rents),
    sources,
    firstSeenAt: Math.min(...members.map((m) => m.firstSeenAt)),
  };
}

// ---- identity ----
export interface PriorListing {
  readonly id: string;
  readonly firstSeenAt: number;
  readonly memberIds: readonly string[];
}
export interface ClusterSeed {
  readonly key: string;
  readonly memberIds: readonly string[];
  readonly seed: { readonly sourceId: string; readonly sourceListingId: string };
  /** Optional: min member firstSeenAt; only used to break redirect-target ties. */
  readonly firstSeenAt?: number;
}
export interface IdentityAssignment {
  clusterKey: string;
  listingId: string;
  origin: 'inherited' | 'minted';
  overlap: number;
  priorFirstSeenAt: number | null;
}
export interface IdentityResult {
  assignments: IdentityAssignment[];
  redirects: Array<{ oldId: string; newId: string }>;
  orphaned: string[];
}

export function assignIdentities(
  clusters: readonly ClusterSeed[],
  priors: readonly PriorListing[],
  mint: (seed: ClusterSeed['seed'], attempt: number) => string,
  isTaken: (id: string) => boolean,
): IdentityResult {
  const memberToCluster = new Map<string, string>();
  for (const c of clusters) for (const m of c.memberIds) memberToCluster.set(m, c.key);
  const clusterByKey = new Map(clusters.map((c) => [c.key, c]));
  const priorById = new Map(priors.map((p) => [p.id, p]));

  // overlap per (prior, cluster)
  interface Tuple {
    clusterKey: string;
    priorId: string;
    overlap: number;
  }
  const tuples: Tuple[] = [];
  for (const p of priors) {
    const counts = new Map<string, number>();
    for (const m of new Set(p.memberIds)) {
      const k = memberToCluster.get(m);
      if (k !== undefined) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [clusterKey, overlap] of counts) tuples.push({ clusterKey, priorId: p.id, overlap });
  }
  tuples.sort(
    (x, y) =>
      y.overlap - x.overlap ||
      priorById.get(x.priorId)!.firstSeenAt - priorById.get(y.priorId)!.firstSeenAt ||
      cmpStr(x.priorId, y.priorId) ||
      cmpStr(x.clusterKey, y.clusterKey),
  );

  const idOfCluster = new Map<string, IdentityAssignment>();
  const assignedPriors = new Set<string>();
  const used = new Set<string>();
  for (const t of tuples) {
    if (idOfCluster.has(t.clusterKey) || assignedPriors.has(t.priorId)) continue;
    idOfCluster.set(t.clusterKey, {
      clusterKey: t.clusterKey,
      listingId: t.priorId,
      origin: 'inherited',
      overlap: t.overlap,
      priorFirstSeenAt: priorById.get(t.priorId)!.firstSeenAt,
    });
    assignedPriors.add(t.priorId);
    used.add(t.priorId);
  }

  const sortedClusters = [...clusters].sort((a, b) => cmpStr(a.key, b.key));
  for (const c of sortedClusters) {
    if (idOfCluster.has(c.key)) continue;
    let id: string;
    for (let n = 0; ; n++) {
      id = mint(c.seed, n);
      if (!used.has(id) && !isTaken(id)) break;
    }
    used.add(id);
    idOfCluster.set(c.key, {
      clusterKey: c.key,
      listingId: id,
      origin: 'minted',
      overlap: 0,
      priorFirstSeenAt: null,
    });
  }

  // unassigned priors: redirect to max-overlap cluster, or orphan
  const redirects: Array<{ oldId: string; newId: string }> = [];
  const orphaned: string[] = [];
  const bestFor = new Map<string, Tuple>();
  for (const t of tuples) {
    if (assignedPriors.has(t.priorId)) continue;
    const cur = bestFor.get(t.priorId);
    if (!cur) {
      bestFor.set(t.priorId, t);
      continue;
    }
    if (t.overlap !== cur.overlap) {
      if (t.overlap > cur.overlap) bestFor.set(t.priorId, t);
      continue;
    }
    const tf = clusterByKey.get(t.clusterKey)!.firstSeenAt ?? Infinity;
    const cf = clusterByKey.get(cur.clusterKey)!.firstSeenAt ?? Infinity;
    if (tf !== cf) {
      if (tf < cf) bestFor.set(t.priorId, t);
      continue;
    }
    if (cmpStr(idOfCluster.get(t.clusterKey)!.listingId, idOfCluster.get(cur.clusterKey)!.listingId) < 0)
      bestFor.set(t.priorId, t);
  }
  for (const p of [...priors].sort((a, b) => cmpStr(a.id, b.id))) {
    if (assignedPriors.has(p.id)) continue;
    const t = bestFor.get(p.id);
    if (!t) {
      orphaned.push(p.id);
      continue;
    }
    const newId = idOfCluster.get(t.clusterKey)!.listingId;
    if (newId !== p.id) redirects.push({ oldId: p.id, newId });
  }

  return {
    assignments: [...idOfCluster.values()].sort((a, b) => cmpStr(a.clusterKey, b.clusterKey)),
    redirects,
    orphaned,
  };
}
