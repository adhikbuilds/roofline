/**
 * `pnpm eval:quality`: compares what the pipeline rejected with what the generator planted, using
 * seed_truth.source_rows.defect (admin role only). Prints planted_rejects / matched / extra_rejects.
 */
import { DEFECT_OUTCOME, PLANTED_REJECT_DEFECTS, type DefectKind } from '../adapters/synthetic/params';
import type { Db } from '../pipeline/db';

/** Extra rejects tolerated, as a share of all source rows. */
export const EXTRA_REJECT_TOLERANCE = 0.01;

/** Warning each non-rejected defect must carry (null = none required). */
const EXPECTED_WARNING: Partial<Record<DefectKind, string>> = {
  rent_annual: 'RENT_ANNUAL_REPAIRED',
  rent_lakh: 'RENT_UNIT_REPAIRED',
  locality_from_geo: 'LOCALITY_FROM_GEO',
  locality_bangalore_geo: 'LOCALITY_FROM_GEO',
  empty_locality_geo: 'LOCALITY_FROM_GEO',
  furnishing_invalid: 'FURNISHING_INVALID',
  area_zero: 'AREA_MISSING',
};

export interface DefectLine {
  defect: string;
  expected: string;
  planted: number;
  asExpected: number;
}

export interface QualityEval {
  plantedRejects: number;
  matched: number;
  extraRejects: number;
  totalRows: number;
  totalRejected: number;
  extraPct: number;
  ok: boolean;
  defects: DefectLine[];
  lines: string[];
}

export async function evalQuality(db: Db): Promise<QualityEval> {
  const planted = await db.query<{ n: string }>(
    'SELECT count(*) AS n FROM seed_truth.source_rows WHERE defect = ANY($1::text[])',
    [PLANTED_REJECT_DEFECTS],
  );
  const matched = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM seed_truth.source_rows t
       JOIN source_listings sl ON sl.source_id = t.source_id AND sl.source_listing_id = t.source_listing_id
      WHERE t.defect = ANY($1::text[]) AND sl.quality_status = 'rejected'`,
    [PLANTED_REJECT_DEFECTS],
  );
  const totals = await db.query<{ total: string; rejected: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE quality_status = 'rejected') AS rejected FROM source_listings`,
  );
  const per = await db.query<{ defect: string; planted: string; rejected: string; accepted: string; warned: string }>(
    `SELECT t.defect, count(*) AS planted,
            count(*) FILTER (WHERE sl.quality_status = 'rejected') AS rejected,
            count(*) FILTER (WHERE sl.quality_status = 'accepted') AS accepted,
            count(*) FILTER (WHERE sl.quality_status = 'accepted' AND sl.quality_warnings @> ARRAY[w.code]) AS warned
       FROM seed_truth.source_rows t
       JOIN source_listings sl ON sl.source_id = t.source_id AND sl.source_listing_id = t.source_listing_id
       LEFT JOIN (SELECT unnest($1::text[]) AS defect, unnest($2::text[]) AS code) w ON w.defect = t.defect
      WHERE t.defect IS NOT NULL
      GROUP BY t.defect ORDER BY t.defect`,
    [Object.keys(EXPECTED_WARNING), Object.values(EXPECTED_WARNING)],
  );

  const plantedRejects = Number(planted.rows[0]?.n);
  const matchedN = Number(matched.rows[0]?.n);
  const totalRows = Number(totals.rows[0]?.total);
  const totalRejected = Number(totals.rows[0]?.rejected);
  const extraRejects = totalRejected - matchedN;
  const extraPct = totalRows === 0 ? 0 : extraRejects / totalRows;

  const defects: DefectLine[] = per.rows.map((r) => {
    const d = r.defect as DefectKind;
    const expected = DEFECT_OUTCOME[d] ?? 'accepted';
    const asExpected =
      expected === 'rejected' ? Number(r.rejected)
      : EXPECTED_WARNING[d] ? Number(r.warned)
      : Number(r.accepted);
    return { defect: r.defect, expected, planted: Number(r.planted), asExpected };
  });
  const defectsOk = defects.every((d) => d.asExpected === d.planted);
  const ok = totalRows > 0 && matchedN === plantedRejects && extraPct <= EXTRA_REJECT_TOLERANCE && defectsOk;

  const lines = [
    `planted_rejects=${plantedRejects} matched=${matchedN} extra_rejects=${extraRejects} (${(extraPct * 100).toFixed(2)}% of ${totalRows} rows, limit ${(EXTRA_REJECT_TOLERANCE * 100).toFixed(0)}%) total_rejected=${totalRejected}`,
    ...defects.map((d) => `  ${d.defect.padEnd(26)} expected=${d.expected.padEnd(16)} ${d.asExpected}/${d.planted}`),
    ok ? 'eval:quality OK' : 'eval:quality FAILED',
  ];
  return { plantedRejects, matched: matchedN, extraRejects, totalRows, totalRejected, extraPct, ok, defects, lines };
}
