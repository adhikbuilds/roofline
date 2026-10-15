/**
 * Stages 6-7 against the full synthetic seed (private database). The first block uses the real robust-median
 * engine with a stubbed v2/CV so the DB writes are covered even before v2 exists; the second runs the real engine.
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINE_VERSION, fitRobustMedian, predictRobustMedian } from '@roofline/engine';
import type { RobustMedianArtifact } from '@roofline/engine';
import { evalDeals } from '../src/eval/deals-eval';
import { evalFairRent } from '../src/eval/fairrent-eval';
import { seedSynthetic } from '../src/seed';
import { runModelStages } from '../src/pipeline/fairrent';
import type { ArtifactLike, CvLike, Models } from '../src/pipeline/fairrent';
import { engineModels } from '../src/pipeline/models';
import { freshIngestDb } from './helpers/db';

interface Metrics {
  cv: { folds: number; mdapeObs: number };
  selection: { rule: string; active: boolean };
  deals: { quarantined: { count: number; listingIds: string[] } };
  pg: { looMdapeObs: number };
}
let db: Client;
beforeAll(async () => {
  db = await freshIngestDb();
  await seedSynthetic(db);
}, 240_000);
afterAll(async () => {
  await db.end();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query(sql, params)).rows[0] as T;
const count = async (sql: string): Promise<number> => Number((await one<{ n: string }>(sql)).n);

const cvStub = (m: number): CvLike => ({ n: 100, mdapeObs: m, coverageObs: 0.66, mdapeObsBadged: m, nBadged: 90, mdapeTruth: 0.05, coverageTruth: 0.7 });
function stubModels(active: 'robust_median' | 'hedonic'): Models {
  return {
    crossValidate: () => ({ robustMedian: cvStub(0.08), hedonic: cvStub(0.07), active }),
    fitRobustMedian: (rows, o) => fitRobustMedian(rows, o) as unknown as ArtifactLike,
    fitHedonic: (rows, o) => ({ ...(fitRobustMedian(rows, o) as unknown as ArtifactLike), kind: 'hedonic' }),
    predict: (a, x, o) => predictRobustMedian({ ...a, kind: 'robust_median' } as unknown as RobustMedianArtifact, x, o),
  };
}

describe('stages 6-7 (stubbed v2)', () => {
  it('writes both runs, estimates for both, and flags exactly one active run', async () => {
    const res = await runModelStages(db, { models: stubModels('hedonic') });
    expect(res.active).toBe('hedonic');
    const runs = await db.query<{ kind: string; is_active: boolean; engine_version: string }>('SELECT kind::text, is_active, engine_version FROM model_runs ORDER BY id');
    expect(runs.rows).toEqual([
      { kind: 'robust_median', is_active: false, engine_version: ENGINE_VERSION },
      { kind: 'hedonic', is_active: true, engine_version: ENGINE_VERSION },
    ]);
    const perRun = await db.query<{ model_run_id: string; n: string }>('SELECT model_run_id::text, count(*) AS n FROM fair_rent_estimates GROUP BY 1 ORDER BY 1');
    expect(perRun.rows).toHaveLength(2);
    expect(perRun.rows.every((r) => Number(r.n) > 3000)).toBe(true);
    expect(res.fitCount.flats + res.fitCount.pg).toBeGreaterThan(4000);
  });

  it('stamps engine version and model run id on every estimate basis', async () => {
    const bad = await count(
      `SELECT count(*) AS n FROM fair_rent_estimates e
        WHERE e.basis->>'modelRunId' IS DISTINCT FROM e.model_run_id::text OR e.basis->>'engineVersion' IS DISTINCT FROM '${ENGINE_VERSION}'`,
    );
    expect(bad).toBe(0);
  });

  it('stores cv metrics, selection, pg and deals metrics on the runs', async () => {
    const m = await one<{ metrics: Metrics }>('SELECT metrics FROM model_runs WHERE is_active');
    expect(m.metrics.cv).toMatchObject({ folds: 5, mdapeObs: 0.07 });
    expect(m.metrics.selection).toEqual({ rule: 'lower_mdape_obs_strict_ties_v1', active: true });
    expect(m.metrics.deals.quarantined.count).toBe(m.metrics.deals.quarantined.listingIds.length);
    expect(typeof m.metrics.pg.looMdapeObs).toBe('number');
    const other = await one<{ metrics: Metrics }>('SELECT metrics FROM model_runs WHERE NOT is_active');
    expect(other.metrics.selection.active).toBe(false);
    expect(other.metrics.cv.mdapeObs).toBe(0.08);
  });

  it('keeps truth-derived metrics out of model_runs and in the admin-only seed_truth.model_run_eval', async () => {
    expect(await count(`SELECT count(*) AS n FROM model_runs WHERE metrics::text ~* 'truth'`)).toBe(0);
    const ev = await one<{ metrics: { cv: { mdapeTruth: number; coverageTruth: number } } }>(
      `SELECT e.metrics FROM seed_truth.model_run_eval e JOIN model_runs r ON r.id = e.model_run_id WHERE r.is_active`,
    );
    expect(ev.metrics.cv).toMatchObject({ mdapeTruth: 0.05, coverageTruth: 0.7 });
    expect(await count('SELECT count(*) AS n FROM seed_truth.model_run_eval')).toBe(await count('SELECT count(*) AS n FROM model_runs'));
    // as the web role: no truth keys visible, and the eval table is denied
    await db.query('BEGIN');
    try {
      await db.query('SET LOCAL ROLE roofline_app');
      const leak = await one<{ leaks: boolean }>(`SELECT coalesce(bool_or(metrics::text ~* 'truth'), false) AS leaks FROM model_runs`);
      expect(leak.leaks).toBe(false);
      await db.query('SAVEPOINT s');
      await expect(db.query('SELECT 1 FROM seed_truth.model_run_eval LIMIT 1')).rejects.toThrow(/permission denied/);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('cascades model_run_eval rows when a run is deleted', async () => {
    const fk = await one<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = 'seed_truth.model_run_eval'::regclass AND c.contype = 'f'`,
    );
    expect(fk.def).toContain('ON DELETE CASCADE');
  });

  it('satisfies the Phase 3 SQL acceptance checks', async () => {
    expect(await count(`SELECT count(*) AS n FROM listings WHERE is_deal AND (fair_delta_pct > -0.20 OR fair_delta_pct < -0.55 OR confidence = 'low')`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM listings WHERE badge IS NOT NULL AND fair_explanation IS NULL`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM listings WHERE confidence = 'low' AND badge IS NOT NULL`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM listings l JOIN source_listings sl ON sl.listing_id = l.id
      JOIN seed_truth.source_rows s ON s.source_id = sl.source_id AND s.source_listing_id = sl.source_listing_id
      WHERE s.defect = 'too_good' AND l.is_deal`)).toBe(0);
  });

  it('stamps the active run id and engine version on every listing the active model scored', async () => {
    const active = await one<{ id: string }>('SELECT id::text FROM model_runs WHERE is_active');
    const scored = await one<{ n: string; wrong: string }>(
      `SELECT count(*) AS n,
              count(*) FILTER (WHERE fair_model_run_id::text <> $1 OR fair_engine_version IS DISTINCT FROM $2) AS wrong
         FROM listings WHERE fair_rent_inr IS NOT NULL`,
      [active.id, ENGINE_VERSION],
    );
    expect(Number(scored.n)).toBeGreaterThan(3000);
    expect(Number(scored.wrong)).toBe(0);
    // a stamped run id always has an estimate row behind it, and the version moves with the id
    expect(await count(
      `SELECT count(*) AS n FROM listings l WHERE l.fair_model_run_id IS NOT NULL AND (l.fair_engine_version IS NULL OR NOT EXISTS (
         SELECT 1 FROM fair_rent_estimates e WHERE e.listing_id = l.id AND e.model_run_id = l.fair_model_run_id))`,
    )).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM listings WHERE (fair_model_run_id IS NULL) <> (fair_engine_version IS NULL)`)).toBe(0);
  });

  it('references model_runs with ON DELETE SET NULL so pruning an old run never blocks or cascades into listings', async () => {
    const r = await one<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
        WHERE c.conrelid = 'listings'::regclass AND c.contype = 'f' AND c.confrelid = 'model_runs'::regclass`,
    );
    expect(r.def).toContain('(fair_model_run_id)');
    expect(r.def).toContain('ON DELETE SET NULL');
  });

  it('a low-confidence listing shows the refusal sentence and no numbers', async () => {
    const r = await one<{ n: string; bad: string }>(
      `SELECT count(*) AS n, count(*) FILTER (WHERE fair_rent_inr IS NOT NULL OR fair_delta_pct IS NOT NULL OR fair_explanation <> 'Not enough comparable listings.') AS bad
         FROM listings WHERE confidence = 'low'`,
    );
    expect(Number(r.n)).toBeGreaterThan(0);
    expect(Number(r.bad)).toBe(0);
  });

  it('every active listing has a confidence and every deal reason names fair rent and comps', async () => {
    expect(await count(`SELECT count(*) AS n FROM listings WHERE is_active AND confidence IS NULL`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM listings WHERE is_deal AND (deal_reason NOT LIKE '%below fair rent%' OR deal_reason NOT LIKE '%comps%' OR deal_score IS NULL)`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM listings WHERE NOT is_deal AND (deal_score IS NOT NULL OR deal_reason IS NOT NULL)`)).toBe(0);
  });

  it('is safe to re-run: one active run, no stale deals from the previous fit', async () => {
    await runModelStages(db, { models: stubModels('robust_median') });
    expect(await count(`SELECT count(*) AS n FROM model_runs WHERE is_active`)).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM model_runs`)).toBe(4);
    expect((await one<{ kind: string }>('SELECT kind::text FROM model_runs WHERE is_active')).kind).toBe('robust_median');
    const active = await one<{ id: string }>('SELECT id::text FROM model_runs WHERE is_active');
    expect(await count(`SELECT count(*) AS n FROM listings WHERE fair_model_run_id IS NOT NULL AND fair_model_run_id::text <> '${active.id}'`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM listings WHERE fair_rent_inr IS NOT NULL AND fair_model_run_id IS NULL`)).toBe(0);
    // denormalised columns come only from the active (latest) run
    const mismatch = await count(
      `SELECT count(*) AS n FROM listings l JOIN fair_rent_estimates e ON e.listing_id = l.id AND e.model_run_id = (SELECT id FROM model_runs WHERE is_active)
        WHERE e.confidence <> 'low' AND (l.fair_rent_inr <> e.expected_inr OR l.fair_delta_pct IS DISTINCT FROM e.delta_pct)`,
    );
    expect(mismatch).toBe(0);
  });

  it('rolls back everything when a stage throws', async () => {
    const before = await count('SELECT count(*) AS n FROM model_runs');
    const boom: Models = { ...stubModels('robust_median'), predict: () => { throw new Error('boom'); } };
    await expect(runModelStages(db, { models: boom })).rejects.toThrow('boom');
    expect(await count('SELECT count(*) AS n FROM model_runs')).toBe(before);
    expect(await count(`SELECT count(*) AS n FROM model_runs WHERE is_active`)).toBe(1);
  });
});

describe('stages 6-7 with the real engine', () => {
  it('meets the fair-rent gates and keeps every deal invariant (deal precision/recall is gated by eval:deals)', async () => {
    const res = await runModelStages(db, { models: engineModels() });
    const fr = await evalFairRent(db);
    expect(fr.ok, fr.lines.join('\n')).toBe(true);
    const dl = await evalDeals(db);
    expect(dl.lines.join('\n')).toContain('too_good_in_deals=0');
    expect(res.cv.hedonic.mdapeObs).toBeGreaterThan(0);
    expect(await count(`SELECT count(*) AS n FROM listings WHERE is_deal AND (fair_delta_pct > -0.20 OR fair_delta_pct < -0.55 OR confidence = 'low')`)).toBe(0);
  }, 240_000);
});
