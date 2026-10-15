/**
 * `pnpm eval:fairrent`: reads the active model_runs row and gates on the stored cross-validated metrics
 * (the same numbers the methodology page will show). In-sample LOO figures are printed as a secondary check.
 */
import type { Db } from '../pipeline/db';

export const FAIRRENT_LIMITS = { maxMdapeTruth: 0.08, minCoverage: 0.55, maxCoverage: 0.8 } as const;

interface CvMetrics {
  n?: number;
  mdapeObs?: number;
  coverageObs?: number;
  mdapeObsBadged?: number | null;
  nBadged?: number;
  mdapeTruth?: number;
  coverageTruth?: number;
}
export interface FairRentMetrics {
  active: 'robust_median' | 'hedonic';
  cv: { robust_median: CvMetrics; hedonic: CvMetrics };
}
export interface FairRentVerdict {
  ok: boolean;
  lines: string[];
}

const f = (v: number | null | undefined): string => (v === null || v === undefined ? 'n/a' : v.toFixed(4));

export function judgeFairRent(m: FairRentMetrics): FairRentVerdict {
  const lines: string[] = [];
  for (const kind of ['robust_median', 'hedonic'] as const) {
    const c = m.cv[kind];
    lines.push(
      `${kind.padEnd(13)} n=${c.n ?? 'n/a'} mdape_vs_truth=${f(c.mdapeTruth)} mdape_obs=${f(c.mdapeObs)} coverage_obs=${f(c.coverageObs)} ` +
        `coverage_truth=${f(c.coverageTruth)} mdape_obs_badged=${f(c.mdapeObsBadged)} (n=${c.nBadged ?? 'n/a'})${kind === m.active ? ' (active)' : ''}`,
    );
  }
  const a = m.cv[m.active];
  const fails: string[] = [];
  if (a.mdapeTruth === undefined || !(a.mdapeTruth <= FAIRRENT_LIMITS.maxMdapeTruth)) {
    fails.push(`active mdape_vs_truth ${f(a.mdapeTruth)} must be <= ${FAIRRENT_LIMITS.maxMdapeTruth}`);
  }
  if (a.coverageObs === undefined || a.coverageObs < FAIRRENT_LIMITS.minCoverage || a.coverageObs > FAIRRENT_LIMITS.maxCoverage) {
    fails.push(`active coverage_obs ${f(a.coverageObs)} must be within ${FAIRRENT_LIMITS.minCoverage}-${FAIRRENT_LIMITS.maxCoverage}`);
  }
  for (const x of fails) lines.push(`  FAIL ${x}`);
  const ok = fails.length === 0;
  lines.push(ok ? 'eval:fairrent OK' : 'eval:fairrent FAILED');
  return { ok, lines };
}

export async function evalFairRent(db: Db): Promise<FairRentVerdict> {
  const res = await db.query<{ kind: 'robust_median' | 'hedonic'; metrics: { cv?: CvMetrics }; is_active: boolean }>(
    // Public CV numbers come from model_runs.metrics; the truth-derived ones from the admin-only seed_truth.model_run_eval.
    `SELECT DISTINCT ON (r.kind) r.kind::text AS kind,
            jsonb_set(r.metrics, '{cv}', COALESCE(r.metrics -> 'cv', '{}'::jsonb) || COALESCE(e.metrics -> 'cv', '{}'::jsonb)) AS metrics,
            r.is_active
       FROM model_runs r LEFT JOIN seed_truth.model_run_eval e ON e.model_run_id = r.id
      ORDER BY r.kind, r.id DESC`,
  );
  const active = await db.query<{ kind: 'robust_median' | 'hedonic'; id: string; as_of: Date }>(
    `SELECT kind::text AS kind, id, as_of FROM model_runs WHERE is_active`,
  );
  const act = active.rows[0];
  if (!act) return { ok: false, lines: ['no active model run: run `pnpm model:fit`', 'eval:fairrent FAILED'] };
  const by = Object.fromEntries(res.rows.map((r) => [r.kind, r.metrics.cv ?? {}])) as FairRentMetrics['cv'];
  const verdict = judgeFairRent({ active: act.kind, cv: { robust_median: by.robust_median ?? {}, hedonic: by.hedonic ?? {} } });

  // Secondary: the stored (in-sample, leave-one-out) estimates of the active run against truth and observed rent.
  const sec = await db.query<{ n: string; mdape_truth: number | null; cover_obs: number | null; n_truth: string }>(
    `WITH t AS (
       SELECT e.expected_inr, e.low_inr, e.high_inr, l.rent_inr, tr.true_expected_rent_inr AS truth
         FROM fair_rent_estimates e
         JOIN listings l ON l.id = e.listing_id
         LEFT JOIN source_listings sl ON sl.id = l.canonical_source_listing_id
         LEFT JOIN seed_truth.source_rows sr ON sr.source_id = sl.source_id AND sr.source_listing_id = sl.source_listing_id
         LEFT JOIN LATERAL (SELECT true_expected_rent_inr FROM seed_truth.true_rent r WHERE r.unit_id = sr.unit_id AND r.as_of <= $2::timestamptz
                             ORDER BY r.as_of DESC LIMIT 1) tr ON true
        WHERE e.model_run_id = $1 AND e.confidence <> 'low' AND l.unit_kind <> 'pg_bed')
     SELECT count(*) AS n, count(truth) AS n_truth,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(expected_inr - truth)::float8 / truth) FILTER (WHERE truth IS NOT NULL) AS mdape_truth,
            avg((rent_inr BETWEEN low_inr AND high_inr)::int)::float8 AS cover_obs
       FROM t`,
    [act.id, act.as_of.toISOString()],
  );
  const s = sec.rows[0];
  if (s) {
    verdict.lines.splice(
      verdict.lines.length - 1, 0,
      `in-sample (badged flats, n=${s.n}): mdape_vs_truth=${f(s.mdape_truth)} coverage_obs=${f(s.cover_obs)}`,
    );
  }
  return verdict;
}
