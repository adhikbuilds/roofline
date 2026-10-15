import { mad, median, quantiles } from '../stats';
import { OUTLIER_PARAMS as P } from './constants';
import type { OutlierLevel, OutlierResult, QualityRow } from './types';

export interface BaselineOptions {
  /** Area elasticity of rent used for the area-adjusted log rent. */
  epsilon?: number;
}

interface CellStats {
  n: number;
  medianArea: number | null;
  medianR: number;
  madR: number;
  q1: number;
  q3: number;
}

export interface Baseline {
  readonly epsilon: number;
  readonly cells: ReadonlyMap<string, CellStats>;
}

const validArea = (a: number | null): a is number => a != null && Number.isFinite(a) && a > 0;
const usable = (r: QualityRow): boolean => Number.isFinite(r.rentInr) && r.rentInr > 0;

/** Group suffix: BHK for flats, sharing for PG. */
function suffix(r: QualityRow): string {
  return r.kind === 'pg' ? `pg:${r.pgSharing ?? 'na'}` : `flat:${r.bhk ?? 'na'}`;
}

function keys(r: QualityRow): Array<[OutlierLevel, string]> {
  const s = suffix(r);
  const out: Array<[OutlierLevel, string]> = [];
  if (r.localityId != null) out.push(['locality', `L${r.localityId}|${s}`]);
  if (r.zone != null) out.push(['zone', `Z${r.zone}|${s}`]);
  out.push(['city', `C|${s}`]);
  return out;
}

/** Area-adjusted log rent: ln(rent) - eps * ln(area / medianArea). */
function adjusted(r: QualityRow, medArea: number | null, eps: number): number {
  const base = Math.log(r.rentInr);
  return validArea(r.areaSqft) && medArea !== null ? base - eps * Math.log(r.areaSqft / medArea) : base;
}

/**
 * Build per-group statistics from a sample. Callers pass the previous run's accepted
 * set plus the current batch's hard-rule survivors (see assessBatch).
 */
export function buildBaseline(samples: readonly QualityRow[], opts: BaselineOptions = {}): Baseline {
  const epsilon = opts.epsilon ?? P.epsilon;
  const groups = new Map<string, QualityRow[]>();
  for (const s of samples) {
    if (!usable(s)) continue;
    for (const [, k] of keys(s)) {
      const g = groups.get(k);
      if (g) g.push(s);
      else groups.set(k, [s]);
    }
  }
  const cells = new Map<string, CellStats>();
  for (const [k, rows] of groups) {
    const areas = rows.map((r) => r.areaSqft).filter(validArea);
    const medianArea = median(areas);
    const rs = rows.map((r) => adjusted(r, medianArea, epsilon));
    const [q1, q3] = quantiles(rs, [0.25, 0.75]) as [number, number];
    cells.set(k, { n: rows.length, medianArea, medianR: median(rs)!, madR: mad(rs)!, q1, q3 });
  }
  return { epsilon, cells };
}

/**
 * Locality cell (MAD, n>=8) -> zone cell (MAD, n>=8) -> city cell (Tukey far-out IQR fences).
 * Returns level 'none' (never rejects) when even the city group is too small.
 */
export function checkOutlier(baseline: Baseline, row: QualityRow): OutlierResult {
  let cityN = 0;
  for (const [level, k] of keys(row)) {
    const c = baseline.cells.get(k);
    if (level === 'city') cityN = c?.n ?? 0;
    if (!c) continue;
    if (level !== 'city' && c.n >= P.minCellN) {
      const r = adjusted(row, c.medianArea, baseline.epsilon);
      const z = (P.zScale * (r - c.medianR)) / Math.max(c.madR, P.madFloor);
      const rejected = z < P.zLow || z > P.zHigh;
      return rejected
        ? { rejected, level, n: c.n, z, code: 'RENT_OUTLIER_MAD' }
        : { rejected, level, n: c.n, z };
    }
    if (level === 'city' && c.n >= P.minIqrN) {
      const r = adjusted(row, c.medianArea, baseline.epsilon);
      const spread = c.q3 - c.q1;
      const rejected = r < c.q1 - P.iqrK * spread || r > c.q3 + P.iqrK * spread;
      return rejected
        ? { rejected, level, n: c.n, code: 'RENT_OUTLIER_IQR' }
        : { rejected, level, n: c.n };
    }
  }
  return { rejected: false, level: 'none', n: cityN };
}

