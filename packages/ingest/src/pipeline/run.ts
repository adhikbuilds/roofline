/**
 * One weekly ingest: for every adapter, fetch -> store raw (stage 1); then the combined batch goes through
 * normalize (2), locality (3) and quality (4) so every source shares one statistical baseline; finally
 * persist. Each adapter gets its own ingest_runs row. Everything runs in a single transaction.
 */
import { ENGINE_VERSION } from '@roofline/engine';
import type { RawListing, SourceAdapter } from '../adapter';
import { sourceListingUuid } from '../ids';
import type { Db } from './db';
import { canonicalizeLocality, loadRefData } from './locality';
import { normalizeRaw } from './normalize';
import { runDedup } from './dedup';
import { delistMissing, persistDrafts, touchSeen } from './persist';
import { assessDrafts, loadPriorAccepted } from './quality';
import { storeRaw } from './raw';
import type { Draft, RefData, RunResult, RunStats } from './types';

const emptyStats = (): RunStats => ({
  fetched: 0, unchanged: 0, raw_stored: 0, processed: 0, accepted: 0, rejected: 0, reasons: {}, warnings: {},
  locality: {}, repaired: { unit: 0, annual: 0 }, extracted_by_rules: 0, delisted: 0, listings_upserted: 0,
  price_observations: 0, batch_size: 0, raw_inserted: 0, listings_changed: 0,
});
const bump = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};

export interface RunWeekOptions {
  ref?: RefData;
  /** Rescore every block and re-assign identities against all listings (stage 5). */
  full?: boolean;
  /** Report progress; defaults to silent. */
  log?: (line: string) => void;
}

async function collect(adapter: SourceAdapter, asOf: Date): Promise<RawListing[]> {
  const ctl = new AbortController();
  const out: RawListing[] = [];
  for await (const row of adapter.fetch({ asOf, signal: ctl.signal })) out.push(row);
  return out;
}

export async function runWeek(db: Db, adapters: SourceAdapter[], asOf: Date, opts: RunWeekOptions = {}): Promise<RunResult[]> {
  await db.query('BEGIN');
  try {
    const ref = opts.ref ?? (await loadRefData(db));
    const priorMembers = new Set(
      (await db.query<{ id: string }>(`SELECT id FROM source_listings WHERE quality_status = 'accepted' AND is_active`)).rows.map((r) => r.id),
    );
    const statsByRun = new Map<number, RunStats>();
    const results: Array<{ sourceId: string; runId: number }> = [];
    const drafts: Draft[] = [];
    const seen: Array<{ sourceId: string; ids: string[] }> = [];

    for (const adapter of adapters) {
      const run = await db.query<{ id: string }>(
        `INSERT INTO ingest_runs (source_id, as_of, started_at, engine_version) VALUES ($1, $2, $2, $3) RETURNING id`,
        [adapter.id, asOf.toISOString(), ENGINE_VERSION],
      );
      const runId = Number(run.rows[0]?.id);
      const stats = emptyStats();
      statsByRun.set(runId, stats);
      results.push({ sourceId: adapter.id, runId });

      const rows = await collect(adapter, asOf);
      const raw = await storeRaw(db, runId, adapter.id, asOf, rows);
      stats.fetched = raw.fetched;
      stats.unchanged = raw.unchangedIds.length;
      stats.raw_stored = raw.changed.length;
      stats.raw_inserted = raw.changed.length;
      await touchSeen(db, adapter.id, raw.unchangedIds, asOf);
      seen.push({ sourceId: adapter.id, ids: raw.seenIds });

      const ctx = { runId, sourceId: adapter.id, isSynthetic: adapter.license.kind === 'synthetic', asOf };
      for (const r of raw.changed) drafts.push(normalizeRaw(r, ctx)); // stage 2
    }

    const prior = await loadPriorAccepted(db);
    const unmatched = await canonicalizeLocality(drafts, ref, db); // stage 3
    assessDrafts(drafts, prior, ref); // stage 4 (repair + quality)

    for (const d of drafts) {
      const s = statsByRun.get(d.runId) as RunStats;
      s.processed += 1;
      s.batch_size = drafts.length;
      bump(s.locality, d.localityMethod);
      if (d.extractedBy) s.extracted_by_rules += 1;
      if (d.flags.has('RENT_UNIT_REPAIRED')) s.repaired.unit += 1;
      if (d.flags.has('RENT_ANNUAL_REPAIRED')) s.repaired.annual += 1;
      if (d.status === 'accepted') s.accepted += 1;
      else s.rejected += 1;
      for (const r of d.reasons) bump(s.reasons, r);
      for (const w of d.warnings) bump(s.warnings, w);
    }

    for (const [raw, u] of [...unmatched.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      await db.query(
        `INSERT INTO locality_unmatched (raw_norm, sample_raw, count, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (raw_norm) DO UPDATE
           SET count = locality_unmatched.count + EXCLUDED.count, last_seen_at = EXCLUDED.last_seen_at`,
        [raw, u.sample, u.count, asOf.toISOString()],
      );
    }

    const persisted = await persistDrafts(db, drafts, asOf);
    for (const s of seen) {
      const run = results.find((r) => r.sourceId === s.sourceId) as { runId: number };
      (statsByRun.get(run.runId) as RunStats).delisted = (await delistMissing(db, s.sourceId, s.ids)).length;
    }

    // stage 5: dedup, identity, listings
    if (results.length > 0) {
      const acceptedDraftIds = new Set(drafts.filter((d) => d.status === 'accepted').map((d) => sourceListingUuid(d.sourceId, d.sourceListingId)));
      const dedup = await runDedup(db, { asOf, runs: results, priorMemberIds: priorMembers, acceptedDraftIds, full: opts.full ?? false, log: opts.log });
      const lowest = Math.min(...results.map((r) => r.runId));
      for (const r of results) {
        const s = statsByRun.get(r.runId) as RunStats;
        s.dedup = r.runId === lowest ? dedup : { see_run: lowest };
        s.listings_changed = r.runId === lowest ? dedup.listings_changed : 0;
      }
    }
    for (const r of results) {
      const stats = statsByRun.get(r.runId) as RunStats;
      stats.listings_upserted = persisted.listingsUpserted.get(r.runId) ?? 0;
      stats.price_observations = persisted.priceObservations.get(r.runId) ?? 0;
      await db.query(`UPDATE ingest_runs SET status = 'ok', finished_at = now(), stats = $2::jsonb WHERE id = $1`, [r.runId, JSON.stringify(stats)]);
      opts.log?.(`  ${r.sourceId} run ${r.runId}: fetched=${stats.fetched} processed=${stats.processed} accepted=${stats.accepted} rejected=${stats.rejected} delisted=${stats.delisted}`);
    }
    await db.query('COMMIT');
    return results.map((r) => ({ ...r, stats: statsByRun.get(r.runId) as RunStats }));
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
