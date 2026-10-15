/** eval:deals label derivation against the full synthetic seed (private database). */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evalDeals } from '../src/eval/deals-eval';
import { seedSynthetic } from '../src/seed';
import { freshIngestDb } from './helpers/db';

let db: Client;
beforeAll(async () => {
  db = await freshIngestDb();
  await seedSynthetic(db);
}, 240_000);
afterAll(async () => {
  await db.end();
});

describe('eval:deals honest labels', () => {
  it('a perfect oracle scores precision 1 / recall 1, includes natural deals, and excludes too_good plants', async () => {
    await db.query('UPDATE listings SET is_deal = false');
    // oracle: flag exactly the listings the labelling rule calls deals (integer arithmetic, same band)
    await db.query(`
      WITH t AS (SELECT max(as_of) AS t FROM ingest_runs WHERE status = 'ok')
      UPDATE listings l SET is_deal = true
       WHERE l.is_active AND EXISTS (
         SELECT 1 FROM source_listings sl
           JOIN seed_truth.source_rows sr ON sr.source_id = sl.source_id AND sr.source_listing_id = sl.source_listing_id
           LEFT JOIN seed_truth.true_deals td ON td.unit_id = sr.unit_id
           JOIN t ON true
           JOIN LATERAL (SELECT x.true_expected_rent_inr r FROM seed_truth.true_rent x WHERE x.unit_id = sr.unit_id AND x.as_of <= t.t ORDER BY x.as_of DESC LIMIT 1) tr ON true
          WHERE sl.listing_id = l.id AND COALESCE(td.kind, '') <> 'too_good'
            AND l.rent_inr * 100 <= 80 * tr.r AND l.rent_inr * 100 >= 45 * tr.r)`);
    const v = await evalDeals(db);
    expect(v.precision).toBe(1);
    expect(v.recall).toBe(1);
    expect(v.ok, v.lines.join('\n')).toBe(true);
    const text = v.lines.join('\n');
    expect(text).toMatch(/too_good_in_deals=0/);
    const m = /planted=(\d+) natural=(\d+)/.exec(text);
    expect(Number(m?.[1])).toBeGreaterThan(0);
    expect(Number(m?.[2])).toBeGreaterThan(0);
    expect(v.strict.recallAll).toBeLessThanOrEqual(1);
  }, 120_000);

  it('flagging a too_good plant fails the guard and does not become a label', async () => {
    const tg = await db.query<{ id: string }>(
      `SELECT l.id FROM listings l JOIN source_listings sl ON sl.listing_id = l.id
         JOIN seed_truth.source_rows s ON s.source_id = sl.source_id AND s.source_listing_id = sl.source_listing_id
        WHERE s.defect = 'too_good' LIMIT 1`,
    );
    if (tg.rows.length === 0) return;
    await db.query('UPDATE listings SET is_deal = true WHERE id = $1', [tg.rows[0]?.id]);
    const v = await evalDeals(db);
    expect(v.ok).toBe(false);
    expect(v.lines.join('\n')).toMatch(/too_good_in_deals=[1-9]/);
    expect(v.precision).toBeLessThan(1);
  }, 120_000);
});
