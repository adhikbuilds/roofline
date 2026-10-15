/**
 * Stage 5: dedup, identity and cluster upsert. Runs inside the runWeek transaction after persist and delisting.
 *
 * A source row is a member iff quality_status = 'accepted' AND is_active. Incremental mode scores only the dirty
 * rows' blocks, then re-clusters the closure of everything those rows touch (prior clusters plus raw-match
 * edges, stored guard_split edges included), which makes the result equal to a --full rebuild.
 * source_listings.listing_id is the PRIOR membership: only this stage writes it.
 */
import {
  assignIdentities,
  buildBlockIndex,
  candidatePairs,
  clusterRecords,
  ENGINE_VERSION,
  featuresJson,
  parsePhotoHash,
  scorePair,
  summarizeCluster,
  type ClusterSeed,
  type DedupRecord,
  type GuardCode,
  type MatchEdge,
  type PriorListing,
} from '@roofline/engine';
import { uuidFor } from '../ids';
import type { Db } from './db';

export interface DedupInput {
  asOf: Date;
  /** This invocation's runs (one per source). */
  runs: ReadonlyArray<{ runId: number; sourceId: string }>;
  /** Member ids before this invocation touched anything (snapshot taken at the start of runWeek). */
  priorMemberIds: ReadonlySet<string>;
  /** Ids of accepted drafts written by this invocation (new or content-changed). */
  acceptedDraftIds: ReadonlySet<string>;
  full: boolean;
  log?: (line: string) => void;
}

export interface DedupStats {
  mode: 'incremental' | 'full';
  engine_version: string;
  dirty: number;
  removed: number;
  unblockable: number;
  comparisons: number;
  per_record_mean: number;
  per_record_max: number;
  largest_block: number;
  match: number;
  possible: number;
  guard_split: Record<GuardCode, number>;
  clusters_affected: number;
  ids_inherited: number;
  ids_minted: number;
  redirects_written: number;
  canonical_changed: number;
  listings_changed: number;
}

const CHUNK = 1000;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface MemberRow {
  id: string;
  source_id: string;
  source_listing_id: string;
  priority: number;
  unit_kind: DedupRecord['unitKind'];
  bhk: number | null;
  rent_inr: number;
  deposit_inr: number | null;
  maintenance_inr: number | null;
  area_sqft: number | null;
  furnishing: DedupRecord['furnishing'];
  locality_id: number;
  lat: number | null;
  lng: number | null;
  title_tokens: string[];
  photo_hashes: string[];
  floor: number | null;
  pg_sharing: DedupRecord['pgSharing'];
  pg_gender: DedupRecord['pgGender'];
  first_ms: string;
  last_ms: string;
  listing_id: string | null;
}

export async function loadMembers(db: Db): Promise<{ recs: Map<string, DedupRecord>; listingOf: Map<string, string | null> }> {
  const res = await db.query<MemberRow>(
    `SELECT sl.id, sl.source_id, sl.source_listing_id, s.priority, sl.unit_kind::text AS unit_kind, sl.bhk, sl.rent_inr,
            sl.deposit_inr, sl.maintenance_inr, sl.area_sqft, sl.furnishing::text AS furnishing, sl.locality_id,
            ST_Y(sl.geom::geometry) AS lat, ST_X(sl.geom::geometry) AS lng, sl.title_tokens,
            sl.photo_hashes::text[] AS photo_hashes, sl.floor, sl.pg_sharing::text AS pg_sharing,
            sl.pg_gender::text AS pg_gender,
            round(extract(epoch FROM sl.first_seen_at) * 1000)::text AS first_ms,
            round(extract(epoch FROM sl.last_seen_at) * 1000)::text AS last_ms, sl.listing_id
       FROM source_listings sl JOIN sources s ON s.id = sl.source_id
      WHERE sl.quality_status = 'accepted' AND sl.is_active
      ORDER BY sl.id`,
  );
  const recs = new Map<string, DedupRecord>();
  const listingOf = new Map<string, string | null>();
  for (const r of res.rows) {
    recs.set(r.id, {
      id: r.id,
      sourceId: r.source_id,
      sourceListingId: r.source_listing_id,
      sourcePriority: Number(r.priority),
      unitKind: r.unit_kind,
      bhk: r.bhk,
      rentInr: r.rent_inr,
      depositInr: r.deposit_inr,
      maintenanceInr: r.maintenance_inr,
      areaSqft: r.area_sqft,
      furnishing: r.furnishing,
      localityId: r.locality_id,
      geo: r.lat !== null && r.lng !== null ? { lat: Number(r.lat), lng: Number(r.lng) } : null,
      titleTokens: r.title_tokens,
      photoHashes: r.photo_hashes.map(parsePhotoHash).filter((h): h is bigint => h !== null),
      floor: r.floor,
      pgSharing: r.pg_sharing,
      pgGender: r.pg_gender,
      firstSeenAt: Number(r.first_ms),
      lastSeenAt: Number(r.last_ms),
    });
    listingOf.set(r.id, r.listing_id);
  }
  return { recs, listingOf };
}

interface Edge {
  a: string;
  b: string;
  score: number; // float32-rounded, so stored and fresh edges sort identically
  photos: number;
  /** decision as stored in dedup_pairs ('match' | 'possible' | 'guard_split'), null when not yet written */
  stored: string | null;
  decision: 'match' | 'possible' | 'guard_split';
  features: Record<string, unknown>;
  guard?: GuardCode;
}

const pk = (a: string, b: string): string => `${a}|${b}`;

async function chunked<T>(items: T[], size: number, fn: (part: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

export async function runDedup(db: Db, input: DedupInput): Promise<DedupStats> {
  const { asOf } = input;
  const asOfIso = asOf.toISOString();

  // ---- decide the mode ----
  const stored = await db.query<{ v: string | null }>(
    `SELECT stats->'dedup'->>'engine_version' AS v FROM ingest_runs
      WHERE stats->'dedup' ? 'engine_version' ORDER BY id DESC LIMIT 1`,
  );
  const storedVersion = stored.rows[0]?.v ?? null;
  const full = input.full || (storedVersion !== null && storedVersion !== ENGINE_VERSION);

  const { recs, listingOf } = await loadMembers(db);
  const current = new Set(recs.keys());

  const dirty = new Set<string>();
  for (const id of current) if (full || input.acceptedDraftIds.has(id) || !input.priorMemberIds.has(id)) dirty.add(id);
  const removed = new Set<string>();
  for (const id of input.priorMemberIds) if (!current.has(id)) removed.add(id);
  const touched = new Set<string>([...dirty, ...removed]);

  const lowestRun = Math.min(...input.runs.map((r) => r.runId));
  const runBySource = new Map<string, number>();
  for (const r of input.runs) runBySource.set(r.sourceId, Math.min(r.runId, runBySource.get(r.sourceId) ?? Infinity));
  const runIdFor = (a: string, b: string): number => {
    if (full) return lowestRun;
    const ids = [a, b].filter((x) => dirty.has(x));
    const rs = ids.map((x) => runBySource.get((recs.get(x) as DedupRecord).sourceId)).filter((x): x is number => x !== undefined);
    return rs.length > 0 ? Math.min(...rs) : lowestRun;
  };

  // ---- stored raw-match edges (before stale deletion, so the closure sees the old graph too) ----
  const storedRows = await db.query<{ a_id: string; b_id: string; score: number; decision: string; features: Record<string, unknown> }>(
    `SELECT a_id, b_id, score, decision::text AS decision, features FROM dedup_pairs
      WHERE features->>'raw_decision' = 'match'`,
  );
  const oldEdges = new Map<string, Edge>();
  for (const r of storedRows.rows) {
    if (!recs.has(r.a_id) && !touched.has(r.a_id)) continue;
    if (!recs.has(r.b_id) && !touched.has(r.b_id)) continue;
    oldEdges.set(pk(r.a_id, r.b_id), {
      a: r.a_id, b: r.b_id, score: Math.fround(Number(r.score)), photos: Number(r.features['photos'] ?? 0),
      stored: r.decision, decision: r.decision as Edge['decision'], features: r.features,
    });
  }

  // ---- score the dirty blocks ----
  const index = buildBlockIndex([...recs.values()]);
  const cand = candidatePairs(index, recs, dirty);
  const fresh = new Map<string, Edge>(); // every match / possible pair of this run
  let matchN = 0;
  let possibleN = 0;
  for (const p of cand.pairs) {
    const s = scorePair(recs.get(p.a) as DedupRecord, recs.get(p.b) as DedupRecord);
    if (!s || s.decision === 'none') continue;
    const raw = s.decision;
    if (raw === 'match') matchN++;
    else possibleN++;
    fresh.set(pk(s.a, s.b), {
      a: s.a, b: s.b, score: Math.fround(s.score), photos: s.features.photos, stored: null, decision: raw,
      features: featuresJson(s),
    });
  }

  // edges that survive: stored ones not touching a dirty/removed row, plus the fresh ones
  const rawMatch = new Map<string, Edge>();
  const staleKeys: string[] = [];
  for (const [k, e] of oldEdges) {
    if (touched.has(e.a) || touched.has(e.b)) staleKeys.push(k);
    else rawMatch.set(k, e);
  }
  for (const [k, e] of fresh) if (e.features['raw_decision'] === 'match') rawMatch.set(k, e);

  // ---- affected set ----
  const members = new Map<string, string[]>(); // listing id -> current member ids
  for (const [id, lid] of listingOf) if (lid) members.set(lid, [...(members.get(lid) ?? []), id]);
  const removedListing = new Map<string, string | null>();
  if (removed.size > 0) {
    const rr = await db.query<{ id: string; listing_id: string | null }>(
      'SELECT id, listing_id FROM source_listings WHERE id = ANY($1::uuid[])',
      [[...removed]],
    );
    for (const r of rr.rows) removedListing.set(r.id, r.listing_id);
  }
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  };
  for (const e of oldEdges.values()) link(e.a, e.b);
  for (const e of rawMatch.values()) link(e.a, e.b);

  const affected = new Set<string>();
  const priorIds = new Set<string>();
  if (full) {
    for (const id of current) affected.add(id);
  } else {
    const queue: string[] = [];
    const add = (id: string): void => {
      if (!current.has(id) || affected.has(id)) return;
      affected.add(id);
      queue.push(id);
    };
    for (const id of dirty) add(id);
    for (const id of touched) {
      const lid = current.has(id) ? listingOf.get(id) : removedListing.get(id);
      if (lid) {
        priorIds.add(lid);
        for (const m of members.get(lid) ?? []) add(m);
      }
      for (const n of adj.get(id) ?? []) add(n);
    }
    while (queue.length > 0) {
      const id = queue.pop() as string;
      const lid = listingOf.get(id);
      if (lid) for (const m of members.get(lid) ?? []) add(m);
      for (const n of adj.get(id) ?? []) add(n);
    }
  }
  for (const id of affected) {
    const lid = listingOf.get(id);
    if (lid) priorIds.add(lid);
  }

  // ---- cluster ----
  const affectedRecs = new Map<string, DedupRecord>();
  for (const id of [...affected].sort(cmp)) affectedRecs.set(id, recs.get(id) as DedupRecord);
  const edgesIn: Edge[] = [...rawMatch.values()].filter((e) => affected.has(e.a) && affected.has(e.b));
  const matchEdges: MatchEdge[] = edgesIn.map((e) => ({ a: e.a, b: e.b, score: e.score, photos: e.photos }));
  const clustered = clusterRecords(affectedRecs, matchEdges);
  const guardOf = new Map(clustered.guardSplits.map((g) => [pk(g.a, g.b), g.guard]));
  const guardCounts: Record<GuardCode, number> = { GEO_SPAN: 0, RENT_SPREAD: 0, SOURCE_DUP: 0, SIZE: 0 };
  for (const g of clustered.guardSplits) guardCounts[g.guard]++;

  // ---- identity ----
  const priorRows = priorIds.size > 0 || full
    ? await db.query<{ id: string; first_ms: string; canonical: string }>(
        full
          ? `SELECT id, round(extract(epoch FROM first_seen_at) * 1000)::text AS first_ms, canonical_source_listing_id AS canonical FROM listings ORDER BY id`
          : `SELECT id, round(extract(epoch FROM first_seen_at) * 1000)::text AS first_ms, canonical_source_listing_id AS canonical FROM listings
              WHERE id = ANY($1::uuid[]) ORDER BY id`,
        full ? [] : [[...priorIds]],
      )
    : { rows: [] as Array<{ id: string; first_ms: string; canonical: string }> };
  const priorCanonical = new Map(priorRows.rows.map((r) => [r.id, r.canonical]));
  const priors: PriorListing[] = priorRows.rows.map((r) => ({
    id: r.id,
    firstSeenAt: Number(r.first_ms),
    memberIds: [...affected].filter((m) => listingOf.get(m) === r.id).sort(cmp),
  }));

  const takenRows = await db.query<{ id: string }>('SELECT id FROM listings UNION SELECT old_id FROM listing_redirects');
  const taken = new Set(takenRows.rows.map((r) => r.id));

  const seeds: ClusterSeed[] = clustered.clusters.map((c) => {
    const ms = c.memberIds.map((id) => recs.get(id) as DedupRecord);
    const first = [...ms].sort((x, y) => x.firstSeenAt - y.firstSeenAt || cmp(x.id, y.id))[0] as DedupRecord;
    return {
      key: c.key,
      memberIds: c.memberIds,
      seed: { sourceId: first.sourceId, sourceListingId: first.sourceListingId },
      firstSeenAt: Math.min(...ms.map((m) => m.firstSeenAt)),
    };
  });
  const ident = assignIdentities(
    seeds,
    priors,
    (seed, attempt) => uuidFor('listing', attempt === 0 ? `${seed.sourceId}:${seed.sourceListingId}` : `${seed.sourceId}:${seed.sourceListingId}#${attempt}`),
    (id) => taken.has(id),
  );
  const assignByKey = new Map(ident.assignments.map((a) => [a.clusterKey, a]));
  const priorFirst = new Map(priors.map((p) => [p.id, p.firstSeenAt]));

  // ---- views ----
  let canonicalChanged = 0;
  const views = clustered.clusters.map((c) => {
    const a = assignByKey.get(c.key) as NonNullable<ReturnType<typeof assignByKey.get>>;
    const ms = c.memberIds.map((id) => recs.get(id) as DedupRecord);
    const incumbent = a.origin === 'inherited' ? (priorCanonical.get(a.listingId) ?? null) : null;
    const v = summarizeCluster(ms, incumbent);
    if (a.origin === 'inherited' && incumbent !== v.canonicalId) canonicalChanged++;
    const first = Math.min(v.firstSeenAt, a.origin === 'inherited' ? (priorFirst.get(a.listingId) ?? Infinity) : Infinity);
    return { listingId: a.listingId, view: v, firstSeenAt: first, memberIds: c.memberIds };
  });

  // ---- write: dedup_pairs ----
  if (full) await db.query('DELETE FROM dedup_pairs');
  else if (touched.size > 0) await db.query('DELETE FROM dedup_pairs WHERE a_id = ANY($1::uuid[]) OR b_id = ANY($1::uuid[])', [[...touched]]);

  const toWrite: Array<{ run_id: number; a_id: string; b_id: string; score: number; decision: string; features: Record<string, unknown> }> = [];
  for (const [k, e] of fresh) {
    const guard = guardOf.get(k);
    const decision = guard ? 'guard_split' : e.decision;
    toWrite.push({ run_id: runIdFor(e.a, e.b), a_id: e.a, b_id: e.b, score: e.score, decision, features: guard ? { ...e.features, guard } : e.features });
  }
  // surviving stored edges whose guard outcome flipped
  for (const [k, e] of rawMatch) {
    if (fresh.has(k) || !affected.has(e.a) || !affected.has(e.b)) continue;
    const guard = guardOf.get(k);
    const decision = guard ? 'guard_split' : 'match';
    if (decision === e.stored) continue;
    const features: Record<string, unknown> = { ...e.features };
    delete features['guard'];
    if (guard) features['guard'] = guard;
    toWrite.push({ run_id: runIdFor(e.a, e.b), a_id: e.a, b_id: e.b, score: e.score, decision, features });
  }
  await chunked(toWrite, CHUNK, async (part) => {
    await db.query(
      `INSERT INTO dedup_pairs (run_id, a_id, b_id, score, decision, features)
       SELECT x.run_id, x.a_id, x.b_id, x.score, x.decision::dedup_decision, x.features
         FROM jsonb_to_recordset($1::jsonb) AS x(run_id bigint, a_id uuid, b_id uuid, score real, decision text, features jsonb)
       ON CONFLICT (a_id, b_id) DO UPDATE SET score = EXCLUDED.score, decision = EXCLUDED.decision, features = EXCLUDED.features`,
      [JSON.stringify(part)],
    );
  });

  // ---- write: redirect hygiene (before listings are removed) ----
  const assignedIds = ident.assignments.map((a) => a.listingId);
  if (assignedIds.length > 0) await db.query('DELETE FROM listing_redirects WHERE old_id = ANY($1::uuid[])', [assignedIds]);
  let redirectsWritten = 0;
  for (const r of ident.redirects) {
    await db.query('DELETE FROM listing_redirects WHERE old_id = $1', [r.newId]);
    await db.query('UPDATE listing_redirects SET new_id = $2 WHERE new_id = $1', [r.oldId, r.newId]);
    await db.query('DELETE FROM listing_redirects WHERE old_id = new_id');
    const w = await db.query(
      `INSERT INTO listing_redirects (old_id, new_id, at) VALUES ($1, $2, $3::timestamptz)
       ON CONFLICT (old_id) DO UPDATE SET new_id = EXCLUDED.new_id, at = EXCLUDED.at`,
      [r.oldId, r.newId, asOfIso],
    );
    redirectsWritten += w.rowCount ?? 0;
  }

  // ---- write: listings upsert (only rows that actually differ) ----
  let listingsChanged = 0;
  await chunked(views, 500, async (part) => {
    const res = await db.query(
      `INSERT INTO listings (id, canonical_source_listing_id, member_count, source_count, source_ids, rent_min_inr, rent_max_inr,
         unit_kind, bhk, rent_inr, deposit_inr, area_sqft, furnishing, locality_id, geom, pg_sharing, pg_food_included, pg_gender,
         photo_seeds, first_seen_at, last_price_change_at, is_active)
       SELECT x.id, x.canonical, x.member_count, x.source_count, ARRAY(SELECT jsonb_array_elements_text(x.source_ids)),
              x.rent_min, x.rent_max, sl.unit_kind, sl.bhk, sl.rent_inr, sl.deposit_inr, sl.area_sqft, sl.furnishing,
              sl.locality_id, sl.geom, sl.pg_sharing, sl.pg_food_included, sl.pg_gender, sl.photo_seeds, x.first_seen,
              CASE WHEN old.id IS NOT NULL AND old.canonical_source_listing_id = x.canonical AND old.rent_inr <> sl.rent_inr
                   THEN $2::timestamptz ELSE old.last_price_change_at END,
              true
         FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, canonical uuid, member_count int, source_count int, source_ids jsonb,
                                                  rent_min int, rent_max int, first_seen timestamptz)
         JOIN source_listings sl ON sl.id = x.canonical
         LEFT JOIN listings old ON old.id = x.id
       ON CONFLICT (id) DO UPDATE SET
         canonical_source_listing_id = EXCLUDED.canonical_source_listing_id, member_count = EXCLUDED.member_count,
         source_count = EXCLUDED.source_count, source_ids = EXCLUDED.source_ids, rent_min_inr = EXCLUDED.rent_min_inr,
         rent_max_inr = EXCLUDED.rent_max_inr, unit_kind = EXCLUDED.unit_kind, bhk = EXCLUDED.bhk, rent_inr = EXCLUDED.rent_inr,
         deposit_inr = EXCLUDED.deposit_inr, area_sqft = EXCLUDED.area_sqft, furnishing = EXCLUDED.furnishing,
         locality_id = EXCLUDED.locality_id, geom = EXCLUDED.geom, pg_sharing = EXCLUDED.pg_sharing,
         pg_food_included = EXCLUDED.pg_food_included, pg_gender = EXCLUDED.pg_gender, photo_seeds = EXCLUDED.photo_seeds,
         first_seen_at = EXCLUDED.first_seen_at, last_price_change_at = EXCLUDED.last_price_change_at, is_active = true
       WHERE (listings.canonical_source_listing_id, listings.member_count, listings.source_count, listings.source_ids,
              listings.rent_min_inr, listings.rent_max_inr, listings.unit_kind, listings.bhk, listings.rent_inr,
              listings.deposit_inr, listings.area_sqft, listings.furnishing, listings.locality_id,
              ST_AsEWKB(listings.geom::geometry), listings.pg_sharing, listings.pg_food_included, listings.pg_gender,
              listings.photo_seeds, listings.first_seen_at, listings.last_price_change_at, listings.is_active)
         IS DISTINCT FROM
             (EXCLUDED.canonical_source_listing_id, EXCLUDED.member_count, EXCLUDED.source_count, EXCLUDED.source_ids,
              EXCLUDED.rent_min_inr, EXCLUDED.rent_max_inr, EXCLUDED.unit_kind, EXCLUDED.bhk, EXCLUDED.rent_inr,
              EXCLUDED.deposit_inr, EXCLUDED.area_sqft, EXCLUDED.furnishing, EXCLUDED.locality_id,
              ST_AsEWKB(EXCLUDED.geom::geometry), EXCLUDED.pg_sharing, EXCLUDED.pg_food_included, EXCLUDED.pg_gender,
              EXCLUDED.photo_seeds, EXCLUDED.first_seen_at, EXCLUDED.last_price_change_at, EXCLUDED.is_active)`,
      [
        JSON.stringify(
          part.map((v) => ({
            id: v.listingId,
            canonical: v.view.canonicalId,
            member_count: v.view.memberCount,
            source_count: v.view.sourceCount,
            source_ids: v.view.sourceIds,
            rent_min: v.view.rentMinInr,
            rent_max: v.view.rentMaxInr,
            first_seen: new Date(v.firstSeenAt).toISOString(),
          })),
        ),
        asOfIso,
      ],
    );
    listingsChanged += res.rowCount ?? 0;
  });

  // ---- write: membership pointers, then absorb / orphan prior listings ----
  const pointers: Array<{ id: string; lid: string }> = [];
  for (const v of views) for (const id of v.memberIds) pointers.push({ id, lid: v.listingId });
  await chunked(pointers, 2000, async (part) => {
    await db.query(
      `UPDATE source_listings sl SET listing_id = x.lid
         FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, lid uuid)
        WHERE sl.id = x.id AND sl.listing_id IS DISTINCT FROM x.lid`,
      [JSON.stringify(part)],
    );
  });
  if (ident.redirects.length > 0) {
    await db.query(
      `UPDATE source_listings sl SET listing_id = x.new_id
         FROM jsonb_to_recordset($1::jsonb) AS x(old_id uuid, new_id uuid)
        WHERE sl.listing_id = x.old_id`,
      [JSON.stringify(ident.redirects.map((r) => ({ old_id: r.oldId, new_id: r.newId })))],
    );
    const del = await db.query('DELETE FROM listings WHERE id = ANY($1::uuid[])', [ident.redirects.map((r) => r.oldId)]);
    listingsChanged += del.rowCount ?? 0;
  }
  if (ident.orphaned.length > 0) {
    const off = await db.query('UPDATE listings SET is_active = false WHERE id = ANY($1::uuid[]) AND is_active', [ident.orphaned]);
    listingsChanged += off.rowCount ?? 0;
  }

  const stats: DedupStats = {
    mode: full ? 'full' : 'incremental',
    engine_version: ENGINE_VERSION,
    dirty: dirty.size,
    removed: removed.size,
    unblockable: cand.stats.unblockable,
    comparisons: cand.stats.comparisons,
    per_record_mean: cand.stats.perRecordMean,
    per_record_max: cand.stats.perRecordMax,
    largest_block: cand.stats.largestBlock,
    match: matchN,
    possible: possibleN,
    guard_split: guardCounts,
    clusters_affected: clustered.clusters.length,
    ids_inherited: ident.assignments.filter((a) => a.origin === 'inherited').length,
    ids_minted: ident.assignments.filter((a) => a.origin === 'minted').length,
    redirects_written: redirectsWritten,
    canonical_changed: canonicalChanged,
    listings_changed: listingsChanged,
  };
  if (stats.largest_block > 500) input.log?.(`  dedup warning: largest block ${stats.largest_block} > 500`);
  return stats;
}
