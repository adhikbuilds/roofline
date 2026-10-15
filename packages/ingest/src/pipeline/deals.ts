/**
 * Stage 7: deals. Evaluates every active-model estimate against the engine's eligibility rules, then writes
 * is_deal / deal_score / deal_reason on `listings`. Quarantined rows (too good to be true) are counted for
 * the quality panel and never become deals.
 */
import { evaluateDeal, rankDeals } from '@roofline/engine';
import type { DealVerdict } from '@roofline/engine';
import type { Db } from './db';
import { toDealInput } from './fairrent-core';
import type { EstimateRow, FitRecord } from './fairrent-core';

export interface DealsOutcome {
  eligible: number;
  evaluated: number;
  quarantined: { count: number; listingIds: string[] };
  /** Rule code -> number of listings failing it (a listing can fail several). */
  failed: Record<string, number>;
  ranked: DealVerdict[];
}

export function evaluateAll(records: readonly FitRecord[], estimates: ReadonlyMap<string, EstimateRow>, asOfIso: string): DealsOutcome {
  const verdicts: DealVerdict[] = [];
  const failed: Record<string, number> = {};
  const quarantined: string[] = [];
  for (const rec of records) {
    const v = evaluateDeal(toDealInput(rec, estimates.get(rec.row.id), asOfIso));
    verdicts.push(v);
    for (const f of v.failed) failed[f] = (failed[f] ?? 0) + 1;
    if (v.quarantined) quarantined.push(v.listingId);
  }
  const ranked = rankDeals(verdicts);
  quarantined.sort();
  return { eligible: ranked.length, evaluated: verdicts.length, quarantined: { count: quarantined.length, listingIds: quarantined }, failed, ranked };
}

const CHUNK = 1000;

/** Writes the deal columns. Callers have already cleared them (stage 6 resets every listing). */
export async function writeDeals(db: Db, ranked: readonly DealVerdict[]): Promise<void> {
  for (let i = 0; i < ranked.length; i += CHUNK) {
    const part = ranked.slice(i, i + CHUNK).map((v) => ({ id: v.listingId, score: v.score, reason: v.reason }));
    await db.query(
      `UPDATE listings l SET is_deal = true, deal_score = x.score, deal_reason = x.reason
         FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, score real, reason text) WHERE l.id = x.id`,
      [JSON.stringify(part)],
    );
  }
}
