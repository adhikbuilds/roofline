/**
 * `pnpm eval:dedup`: pairwise precision/recall and B-cubed F1 of the stored clustering against
 * seed_truth.source_rows.unit_id (admin role only), plus hard_negative_merges, blocking_recall and possible_pairs.
 *
 * Population: member rows (accepted AND active) that have a truth row. Predicted cluster = source_listings.listing_id.
 */
import { buildBlockIndex, candidatePairs, gate, type DedupRecord } from '@roofline/engine';
import type { Db } from '../pipeline/db';
import { loadMembers } from '../pipeline/dedup';

export const DEDUP_THRESHOLDS = { precision: 0.98, recall: 0.92, bcubedF1: 0.95, hardNegatives: 150, blockingRecall: 0.995 } as const;

export interface DedupEval {
  members: number;
  pairwisePrecision: number;
  pairwiseRecall: number;
  bcubedPrecision: number;
  bcubedRecall: number;
  bcubedF1: number;
  hardNegativesEvaluated: number;
  hardNegativeMerges: number;
  blockingRecall: number;
  /** Same share over every true pair, including ones a hard gate rules out. */
  blockingRecallAll: number;
  truePairs: number;
  possiblePairs: number;
  ok: boolean;
  lines: string[];
}

const choose2 = (n: number): number => (n * (n - 1)) / 2;

export interface LabelledRow {
  predicted: string;
  truth: string;
}

/** Pairwise and B-cubed metrics over labelled rows. Exported for unit tests with hand-computed numbers. */
export function clusterMetrics(rows: readonly LabelledRow[]): {
  precision: number; recall: number; bcubedPrecision: number; bcubedRecall: number; bcubedF1: number; truePairs: number; predictedPairs: number; tp: number;
} {
  const pred = new Map<string, number>();
  const truth = new Map<string, number>();
  const cell = new Map<string, number>();
  for (const r of rows) {
    pred.set(r.predicted, (pred.get(r.predicted) ?? 0) + 1);
    truth.set(r.truth, (truth.get(r.truth) ?? 0) + 1);
    const k = `${r.predicted}\u0000${r.truth}`;
    cell.set(k, (cell.get(k) ?? 0) + 1);
  }
  let predictedPairs = 0;
  let truePairs = 0;
  let tp = 0;
  for (const n of pred.values()) predictedPairs += choose2(n);
  for (const n of truth.values()) truePairs += choose2(n);
  for (const n of cell.values()) tp += choose2(n);
  let bp = 0;
  let br = 0;
  for (const r of rows) {
    const both = cell.get(`${r.predicted}\u0000${r.truth}`) as number;
    bp += both / (pred.get(r.predicted) as number);
    br += both / (truth.get(r.truth) as number);
  }
  const n = rows.length;
  const bcubedPrecision = n === 0 ? 1 : bp / n;
  const bcubedRecall = n === 0 ? 1 : br / n;
  const f = bcubedPrecision + bcubedRecall === 0 ? 0 : (2 * bcubedPrecision * bcubedRecall) / (bcubedPrecision + bcubedRecall);
  return {
    precision: predictedPairs === 0 ? 1 : tp / predictedPairs,
    recall: truePairs === 0 ? 1 : tp / truePairs,
    bcubedPrecision, bcubedRecall, bcubedF1: f, truePairs, predictedPairs, tp,
  };
}

export async function evalDedup(db: Db): Promise<DedupEval> {
  const res = await db.query<{ id: string; listing_id: string | null; unit_id: string; defect: string | null }>(
    `SELECT sl.id, sl.listing_id, t.unit_id, t.defect
       FROM source_listings sl
       JOIN seed_truth.source_rows t ON t.source_id = sl.source_id AND t.source_listing_id = sl.source_listing_id
      WHERE sl.quality_status = 'accepted' AND sl.is_active AND sl.listing_id IS NOT NULL`,
  );
  const rows = res.rows.map((r) => ({ predicted: r.listing_id as string, truth: r.unit_id }));
  const m = clusterMetrics(rows);

  // Hard negatives: each planted row is the only row of its unit, so any other row sharing its listing is a merge.
  // Judged by listing_id whether or not the row is still active, so all planted pairs are evaluated.
  const hn = await db.query<{ evaluated: string; merges: string }>(
    `SELECT count(*) AS evaluated,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM source_listings o JOIN seed_truth.source_rows ot
                ON ot.source_id = o.source_id AND ot.source_listing_id = o.source_listing_id
               WHERE o.listing_id = sl.listing_id AND ot.unit_id <> t.unit_id)) AS merges
       FROM seed_truth.source_rows t
       JOIN source_listings sl ON sl.source_id = t.source_id AND sl.source_listing_id = t.source_listing_id
      WHERE t.defect = 'hard_negative' AND sl.listing_id IS NOT NULL`,
  );
  const hnEvaluated = Number(hn.rows[0]?.evaluated);
  const hnMerges = Number(hn.rows[0]?.merges);

  const possible = await db.query<{ n: string }>(`SELECT count(*) AS n FROM dedup_pairs WHERE decision = 'possible'`);

  // Blocking recall: share of true duplicate pairs (same unit, both members, not excluded by a hard gate) that share a
  // probe key at all. Pairs a gate excludes (rent spread > 1.25x etc.) can never be clustered, so they are reported apart.
  const { recs } = await loadMembers(db);
  const unitOf = new Map(res.rows.map((r) => [r.id, r.unit_id]));
  const byUnit = new Map<string, string[]>();
  for (const [id, u] of unitOf) byUnit.set(u, [...(byUnit.get(u) ?? []), id]);
  const cand = candidatePairs(buildBlockIndex([...recs.values()]), recs, recs.keys());
  const candSet = new Set(cand.pairs.map((p) => `${p.a}|${p.b}`));
  let truePairsN = 0;
  let sharedProbe = 0;
  let allPairs = 0;
  let allShared = 0;
  let gatedAway = 0; // true pairs a hard gate (rent > 1.25x, geo > 1 km, ...) rules out no matter what blocking does
  for (const ids of byUnit.values()) {
    const sorted = [...ids].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        allPairs++;
        if (candSet.has(`${sorted[i]}|${sorted[j]}`)) allShared++;
        if (!gate(recs.get(sorted[i] as string) as DedupRecord, recs.get(sorted[j] as string) as DedupRecord).ok) {
          gatedAway++;
          continue;
        }
        truePairsN++;
        if (candSet.has(`${sorted[i]}|${sorted[j]}`)) sharedProbe++;
      }
    }
  }
  const blockingRecall = truePairsN === 0 ? 1 : sharedProbe / truePairsN;
  const blockingRecallAll = allPairs === 0 ? 1 : allShared / allPairs;

  const ok =
    m.precision >= DEDUP_THRESHOLDS.precision &&
    m.recall >= DEDUP_THRESHOLDS.recall &&
    m.bcubedF1 >= DEDUP_THRESHOLDS.bcubedF1 &&
    hnEvaluated === DEDUP_THRESHOLDS.hardNegatives &&
    hnMerges === 0 &&
    blockingRecall >= DEDUP_THRESHOLDS.blockingRecall;

  const f = (x: number): string => x.toFixed(4);
  const lines = [
    `members=${rows.length} true_pairs=${m.truePairs} predicted_pairs=${m.predictedPairs} tp=${m.tp}`,
    `pairwise_precision=${f(m.precision)} (>= ${DEDUP_THRESHOLDS.precision})`,
    `pairwise_recall=${f(m.recall)} (>= ${DEDUP_THRESHOLDS.recall})`,
    `bcubed_precision=${f(m.bcubedPrecision)} bcubed_recall=${f(m.bcubedRecall)} bcubed_f1=${f(m.bcubedF1)} (>= ${DEDUP_THRESHOLDS.bcubedF1})`,
    `hard_negatives_evaluated=${hnEvaluated} (must be ${DEDUP_THRESHOLDS.hardNegatives}) hard_negative_merges=${hnMerges} (must be 0)`,
    `blocking_recall=${f(blockingRecall)} over ${truePairsN} gate-eligible true pairs (>= ${DEDUP_THRESHOLDS.blockingRecall}); blocking_recall_all_pairs=${f(blockingRecallAll)} over ${allPairs} gated_away=${gatedAway} possible_pairs=${Number(possible.rows[0]?.n)}`,
    ok ? 'eval:dedup OK' : 'eval:dedup FAILED',
  ];
  return {
    members: rows.length,
    pairwisePrecision: m.precision, pairwiseRecall: m.recall,
    bcubedPrecision: m.bcubedPrecision, bcubedRecall: m.bcubedRecall, bcubedF1: m.bcubedF1,
    hardNegativesEvaluated: hnEvaluated, hardNegativeMerges: hnMerges,
    blockingRecall, blockingRecallAll, truePairs: m.truePairs, possiblePairs: Number(possible.rows[0]?.n), ok, lines,
  };
}
