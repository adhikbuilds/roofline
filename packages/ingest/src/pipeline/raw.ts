/** Stage 1: store raw payloads. Only rows whose content differs from the latest stored payload move on. */
import type { RawListing } from '../adapter';
import { sha256Hex, stableStringify } from '../ids';
import type { Db } from './db';

const CHUNK = 500;

export interface RawStageResult {
  fetched: number;
  seenIds: string[];
  changed: RawListing[];
  unchangedIds: string[];
}

export async function storeRaw(db: Db, runId: number, sourceId: string, asOf: Date, rows: Iterable<RawListing>): Promise<RawStageResult> {
  const latest = new Map<string, RawListing>();
  for (const r of rows) latest.set(r.sourceListingId, r); // last occurrence of an id wins
  const incoming = [...latest.values()].map((r) => ({ raw: r, payload: stableStringify(r) }));
  const hashed = incoming.map((x) => ({ ...x, hash: sha256Hex(x.payload) }));

  const prev = await db.query<{ source_listing_id: string; content_hash: string }>(
    `SELECT DISTINCT ON (source_listing_id) source_listing_id, content_hash
       FROM raw_listings WHERE source_id = $1
      ORDER BY source_listing_id, fetched_at DESC, id DESC`,
    [sourceId],
  );
  const prevHash = new Map(prev.rows.map((r) => [r.source_listing_id, r.content_hash.trim()]));

  const changed = hashed.filter((h) => prevHash.get(h.raw.sourceListingId) !== h.hash);
  const unchangedIds = hashed.filter((h) => prevHash.get(h.raw.sourceListingId) === h.hash).map((h) => h.raw.sourceListingId);

  for (let i = 0; i < changed.length; i += CHUNK) {
    const part = changed.slice(i, i + CHUNK);
    await db.query(
      `INSERT INTO raw_listings (run_id, source_id, source_listing_id, content_hash, payload, fetched_at)
       SELECT $1, $2, t.sid, t.hash, t.payload::jsonb, $3::timestamptz
         FROM unnest($4::text[], $5::text[], $6::text[]) AS t(sid, hash, payload)
       ON CONFLICT (source_id, source_listing_id, content_hash)
       DO UPDATE SET run_id = EXCLUDED.run_id, fetched_at = EXCLUDED.fetched_at`,
      [runId, sourceId, asOf.toISOString(), part.map((p) => p.raw.sourceListingId), part.map((p) => p.hash), part.map((p) => p.payload)],
    );
  }
  return { fetched: hashed.length, seenIds: hashed.map((h) => h.raw.sourceListingId), changed: changed.map((c) => c.raw), unchangedIds };
}
