/**
 * Hedonic (v2) building blocks: sparse design matrix, ridge-Huber IRLS, exact leave-one-out.
 * Plus fitHedonic / predictHedonic, which produce and consume the JSON-serialisable HedonicArtifact.
 */
import {
  cholesky,
  choleskySolve,
  quadFormInv,
  weightedGramSparse,
  weightedXtySparse,
} from '../stats/linalg';
import { ENGINE_VERSION } from '../version';
import { createTrace } from '../trace';
import { mad, median } from '../stats/descriptive';
import { confidenceFor, DEFAULT_CONSTANTS, intervalFor, predictPg } from './robust-median';
import type {
  Downgrade,
  FitListing,
  FlatInput,
  HedonicArtifact,
  HedonicConstants,
  PgSubmodel,
  PredictOptions,
  Prediction,
  Zone,
} from './types';

export interface SparseRow {
  idx: Int32Array;
  val: Float64Array;
}
export interface Design {
  rows: SparseRow[];
  p: number;
  columns: string[];
  penalized: boolean[];
}
export interface IrlsOptions {
  lambda?: number;
  huberK?: number;
  tol?: number;
  maxIter?: number;
}
export interface IrlsResult {
  beta: Float64Array;
  weights: Float64Array;
  scale: number;
  chol: Float64Array;
  iterations: number;
  converged: boolean;
}

const ZONES: readonly Zone[] = ['east', 'south_east', 'south', 'west', 'north', 'north_east']; // central = ref
const BHK_KEYS = [0, 1, 3, 4, 5]; // 2 = ref

function bhkKeyOf(unitKind: 'rk' | 'studio' | 'bhk', bhk: number): number {
  return unitKind === 'bhk' ? Math.min(bhk, 5) : 0;
}

/** Build the sparse design. Locality columns come from the distinct localities in `rows`, sorted. */
export function buildDesign(
  rows: readonly FlatInput[],
  refArea: Readonly<Record<string, number>>,
): Design {
  const columns: string[] = [];
  const penalized: boolean[] = [];
  const add = (name: string, pen = false): number => {
    columns.push(name);
    penalized.push(pen);
    return columns.length - 1;
  };
  add('intercept');
  for (const z of ZONES) add(`zone:${z}`);
  const locs = [...new Set(rows.map((r) => r.localityId))].sort((a, b) => a - b);
  for (const l of locs) add(`loc:${l}`, true);
  for (const b of BHK_KEYS) add(`bhk:${b}`);
  for (const name of [
    'kind_studio', 'furn:furnished', 'furn:unfurnished', 'furn:unknown', 'ln_area_c', 'area_missing',
    'parking_car', 'gated', 'lift', 'floor_ground', 'floor_4_9', 'floor_10p', 'floor_unknown',
  ]) add(name);

  const index = new Map<string, number>(columns.map((c, j) => [c, j]));
  const out: SparseRow[] = rows.map((r) => designRow(r, index, refArea));
  return { rows: out, p: columns.length, columns, penalized };
}

/**
 * One sparse design row for `r` against a fixed column index (by name). Columns that are absent from the
 * index (a locality unseen at fit time) simply contribute nothing.
 */
export function designRow(
  r: FlatInput,
  index: ReadonlyMap<string, number>,
  refArea: Readonly<Record<string, number>>,
): SparseRow {
  const idx: number[] = [];
  const val: number[] = [];
  const put = (name: string, v = 1): void => {
    const j = index.get(name);
    if (j === undefined) return;
    idx.push(j);
    val.push(v);
  };
  put('intercept');
  if (r.zone !== 'central') put(`zone:${r.zone}`);
  put(`loc:${r.localityId}`);
  const b = bhkKeyOf(r.unitKind, r.bhk);
  if (b !== 2) put(`bhk:${b}`);
  if (r.unitKind === 'studio') put('kind_studio');
  if (r.furnishing !== 'semi') put(`furn:${r.furnishing ?? 'unknown'}`);
  const ref = refArea[String(b)];
  if (r.areaSqft === null || ref === undefined || !(ref > 0) || !(r.areaSqft > 0)) put('area_missing');
  else put('ln_area_c', Math.log(r.areaSqft / ref));
  if (r.parking === 'car' || r.parking === 'both') put('parking_car');
  if (r.tags.includes('Gated')) put('gated');
  if (r.tags.includes('Lift')) put('lift');
  if (r.floor === null) put('floor_unknown');
  else if (r.floor === 0) put('floor_ground');
  else if (r.floor >= 10) put('floor_10p');
  else if (r.floor >= 4) put('floor_4_9');
  return { idx: Int32Array.from(idx), val: Float64Array.from(val) };
}

function predictRow(row: SparseRow, beta: Float64Array): number {
  let s = 0;
  for (let k = 0; k < row.idx.length; k++) s += row.val[k]! * beta[row.idx[k]!]!;
  return s;
}

function solveWith(
  d: Design,
  y: Float64Array,
  w: Float64Array,
  ridge: Float64Array,
): { beta: Float64Array; chol: Float64Array } {
  const a = weightedGramSparse(d.rows, d.p, w);
  for (let j = 0; j < d.p; j++) {
    const diag = j * d.p + j;
    a[diag] = a[diag]! + ridge[j]!;
    // unpenalised column with no support: pin its coefficient at 0
    if (a[diag] === 0) a[diag] = 1;
  }
  const chol = cholesky(a, d.p);
  const beta = choleskySolve(chol, d.p, weightedXtySparse(d.rows, d.p, w, y));
  return { beta, chol };
}

/**
 * Ridge Huber IRLS. Effective ridge on column j is lambda * penalties[j].
 * Returned weights/chol are those of the final solve (needed for exact LOO).
 */
export function irlsHuber(
  d: Design,
  y: Float64Array,
  penalties: Float64Array,
  opts: IrlsOptions = {},
): IrlsResult {
  const { lambda = 1, huberK = 1.345, tol = 1e-8, maxIter = 50 } = opts;
  const n = d.rows.length;
  if (y.length !== n) throw new RangeError('irlsHuber: y length must equal row count');
  if (penalties.length !== d.p) throw new RangeError('irlsHuber: penalties length must equal p');
  const ridge = penalties.map((v) => v * lambda);
  let w: Float64Array = new Float64Array(n).fill(1);
  let { beta, chol } = solveWith(d, y, w, ridge);
  let scale = 1e-6;
  let iterations = 0;
  let converged = false;
  while (iterations < maxIter) {
    iterations++;
    const r = Array.from(y, (yi, i) => yi - predictRow(d.rows[i]!, beta));
    scale = Math.max(1.4826 * (mad(r) ?? 0), 1e-6);
    const cut = huberK * scale;
    w = Float64Array.from(r, (ri) => (Math.abs(ri) <= cut ? 1 : cut / Math.abs(ri)));
    const next = solveWith(d, y, w, ridge);
    let delta = 0;
    for (let j = 0; j < d.p; j++) delta = Math.max(delta, Math.abs(next.beta[j]! - beta[j]!));
    beta = next.beta;
    chol = next.chol;
    if (delta < tol) {
      converged = true;
      break;
    }
  }
  return { beta, weights: w, scale, chol, iterations, converged };
}

/** Exact leave-one-out prediction of row i at the final IRLS weights: y_i - r_i/(1-h_ii). */
export function looPrediction(d: Design, y: Float64Array, r: IrlsResult, i: number): number {
  const row = d.rows[i]!;
  const x = new Float64Array(d.p);
  for (let k = 0; k < row.idx.length; k++) x[row.idx[k]!] = row.val[k]!;
  const h = r.weights[i]! * quadFormInv(r.chol, d.p, x);
  const resid = y[i]! - predictRow(row, r.beta);
  return y[i]! - resid / (1 - h);
}

// ---------------------------------------------------------------- fit & predict

export const HEDONIC_DEFAULTS: HedonicConstants = {
  shrinkK: DEFAULT_CONSTANTS.shrinkK,
  basisMinN: DEFAULT_CONSTANTS.basisMinN,
  looMaxN: DEFAULT_CONSTANTS.looMaxN,
  madScale: DEFAULT_CONSTANTS.madScale,
  madFloor: DEFAULT_CONSTANTS.madFloor,
  confidence: { ...DEFAULT_CONSTANTS.confidence },
  lambda: 1,
  huberK: 1.345,
  tol: 1e-8,
  maxIter: 50,
  zoneRef: 'central',
};

const bhkKey = (x: Pick<FlatInput, 'unitKind' | 'bhk'>): number => bhkKeyOf(x.unitKind, x.bhk);
const locBhkKey = (x: FlatInput): string => `${x.localityId}|${bhkKey(x)}`;
const zoneBhkKey = (x: FlatInput): string => `${x.zone}|${bhkKey(x)}`;
const l1Key = (x: FlatInput): string | null =>
  x.furnishing === null ? null : `${x.localityId}|${bhkKey(x)}|${x.furnishing}`;

function push<V>(m: Map<string, V[]>, k: string, v: V): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

function finiteOr(v: number | null | undefined, fallback: number): number {
  return v === null || v === undefined || !Number.isFinite(v) ? fallback : v;
}

function assertRent(x: FitListing): void {
  if (!Number.isFinite(x.rentInr) || x.rentInr <= 0) {
    throw new RangeError(`fitHedonic: listing ${x.id} has non-positive rent`);
  }
}

function sortedMedian(s: readonly number[]): number {
  const h = (s.length - 1) / 2;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo]! + (h - lo) * (s[hi]! - s[lo]!);
}

function inFitIds(ids: readonly string[], id: string): boolean {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = ids[mid]!;
    if (v === id) return true;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

function cellMads(groups: Map<string, number[]>): Record<string, { n: number; mad: number }> {
  const out: Record<string, { n: number; mad: number }> = {};
  for (const k of [...groups.keys()].sort()) {
    const v = groups.get(k)!;
    out[k] = { n: v.length, mad: finiteOr(mad(v), 0) };
  }
  return out;
}

/**
 * Fit the v2 hedonic model on the flats in `rows` (PGs only contribute to ids/counts; they are priced by the
 * embedded `pg` submodel). Unpenalised columns with no support are dropped (coefficient 0, listed).
 */
export function fitHedonic(
  rows: readonly FitListing[],
  opts: { asOf: string; pg: PgSubmodel; options?: IrlsOptions },
): HedonicArtifact {
  for (const r of rows) assertRent(r);
  const constants: HedonicConstants = {
    ...HEDONIC_DEFAULTS,
    ...opts.options,
    confidence: { ...HEDONIC_DEFAULTS.confidence },
  };
  const flats = rows.filter((r): r is FlatInput => r.kind === 'flat');

  const areasByB = new Map<string, number[]>();
  for (const f of flats) if (f.areaSqft !== null && f.areaSqft > 0) push(areasByB, String(bhkKey(f)), f.areaSqft);
  const refArea: Record<string, number> = {};
  for (const b of [...areasByB.keys()].sort((p, q) => Number(p) - Number(q))) refArea[b] = median(areasByB.get(b)!)!;

  const d = buildDesign(flats, refArea);
  const y = Float64Array.from(flats, (f) => Math.log(f.rentInr));
  const penalties = Float64Array.from(d.penalized, (p) => (p ? 1 : 0));
  const fit = irlsHuber(d, y, penalties, constants);

  const support = new Float64Array(d.p);
  for (const row of d.rows) {
    for (let k = 0; k < row.idx.length; k++) {
      const j = row.idx[k]!;
      support[j] = support[j]! + row.val[k]! ** 2;
    }
  }
  const droppedColumns = d.columns.filter((_, j) => !d.penalized[j] && support[j] === 0);

  // exact LOO residuals -> cell MADs; l1 raw-rent context
  const byLoc = new Map<string, number[]>();
  const byZone = new Map<string, number[]>();
  const all: number[] = [];
  const l1 = new Map<string, number[]>();
  flats.forEach((f, i) => {
    const loo = looPrediction(d, y, fit, i);
    const resid = Number.isFinite(loo) && Math.abs(loo) < 50 ? y[i]! - loo : y[i]! - predictRow(d.rows[i]!, fit.beta);
    all.push(resid);
    push(byLoc, locBhkKey(f), resid);
    push(byZone, zoneBhkKey(f), resid);
    const k = l1Key(f);
    if (k !== null) push(l1, k, f.rentInr);
  });
  const l1Cells: HedonicArtifact['context']['l1'] = {};
  for (const k of [...l1.keys()].sort()) {
    const rents = l1.get(k)!.sort((a, b) => a - b);
    l1Cells[k] = {
      n: rents.length,
      medianRent: sortedMedian(rents),
      ...(rents.length < constants.looMaxN ? { rents } : {}),
    };
  }

  return {
    schema: 'roofline.fairrent',
    schemaVersion: 1,
    kind: 'hedonic',
    engineVersion: ENGINE_VERSION,
    asOf: opts.asOf,
    fitIds: rows.map((r) => r.id).sort(),
    counts: { flats: flats.length, pg: rows.length - flats.length },
    constants,
    columns: d.columns,
    penalized: d.penalized,
    droppedColumns,
    beta: Array.from(fit.beta),
    cholL: Array.from(fit.chol),
    huberScale: fit.scale,
    refArea,
    irls: { iterations: fit.iterations, converged: fit.converged },
    residualMad: { locBhk: cellMads(byLoc), zoneBhk: cellMads(byZone), global: finiteOr(mad(all), 0) },
    context: { l1: l1Cells },
    pg: opts.pg,
  };
}

function removeOneSorted(sorted: readonly number[], v: number): number[] {
  const at = sorted.indexOf(v);
  if (at < 0) throw new RangeError('leave-one-out: own value not found in cell');
  return [...sorted.slice(0, at), ...sorted.slice(at + 1)];
}

/**
 * Predict one listing. `inSample` must match membership of `a.fitIds` (asserted); in-sample flats get the exact
 * leave-one-out prediction reconstructed from the stored Cholesky factor and Huber scale.
 */
export function predictHedonic(a: HedonicArtifact, x: FitListing, o: PredictOptions): Prediction | null {
  if (inFitIds(a.fitIds, x.id) !== o.inSample) {
    throw new Error(
      `predictHedonic: inSample=${o.inSample} but listing ${x.id} ${o.inSample ? 'is not' : 'is'} in the fit set`,
    );
  }
  if (x.kind === 'pg') return predictPg(a.pg, a.constants, x, o);
  if (a.counts.flats === 0) return null;

  const p = a.columns.length;
  const index = new Map<string, number>(a.columns.map((c, j) => [c, j]));
  const row = designRow(x, index, a.refArea);
  let xb = 0;
  for (let k = 0; k < row.idx.length; k++) xb += row.val[k]! * a.beta[row.idx[k]!]!;

  let linear = xb;
  if (o.inSample) {
    if (!(x.rentInr > 0)) throw new RangeError(`predictHedonic: in-sample listing ${x.id} needs a positive rent`);
    const yi = Math.log(x.rentInr);
    const r = yi - xb;
    const cut = a.constants.huberK * a.huberScale;
    const w = Math.abs(r) <= cut ? 1 : cut / Math.abs(r);
    const dense = new Float64Array(p);
    for (let k = 0; k < row.idx.length; k++) dense[row.idx[k]!] = row.val[k]!;
    const h = w * quadFormInv(Float64Array.from(a.cholL), p, dense);
    const loo = yi - r / (1 - h);
    if (h < 1 - 1e-9 && Number.isFinite(loo)) linear = loo;
  }
  const expectedInr = Math.max(1, Math.round(Math.exp(linear)));

  // support counts (leave-one-out when in sample)
  const adj = o.inSample ? 1 : 0;
  const loc = a.residualMad.locBhk[locBhkKey(x)];
  const zone = a.residualMad.zoneBhk[zoneBhkKey(x)];
  const nEff = Math.max(0, (loc?.n ?? 0) - adj);
  const minN = a.constants.basisMinN;
  const madLog = loc && loc.n >= minN ? loc.mad : zone && zone.n >= minN ? zone.mad : a.residualMad.global;

  const downgrades: Downgrade[] = [];
  if (x.areaSqft === null) downgrades.push('area_missing');
  if (x.furnishing === null) downgrades.push('furnishing_missing');
  const confidence = confidenceFor(nEff, madLog, downgrades.length, a.constants.confidence);
  const { lowInr, highInr } = intervalFor(expectedInr, madLog, a.constants);

  let context: { l1MedianRentInr: number; l1N: number } | undefined;
  const k1 = l1Key(x);
  const cell = k1 === null ? undefined : a.context.l1[k1];
  if (cell) {
    const useLoo = o.inSample && cell.rents !== undefined;
    const n1 = cell.n - adj;
    if (n1 > 0) {
      const med = useLoo ? sortedMedian(removeOneSorted(cell.rents!, x.rentInr)) : cell.medianRent;
      context = { l1MedianRentInr: med, l1N: n1 };
    }
  }

  const ref = a.refArea[String(bhkKey(x))];
  const areaAdjusted = x.areaSqft !== null && x.areaSqft > 0 && ref !== undefined && ref > 0;
  const epsilon = areaAdjusted ? (a.beta[index.get('ln_area_c')!] ?? null) : null;
  const trace = createTrace()
    .step('hd.fit', `Hedonic model: ${a.counts.flats} flats, ${p - a.droppedColumns.length} active terms.`, {
      lambda: a.constants.lambda,
      iterations: a.irls.iterations,
      converged: a.irls.converged,
    })
    .step('hd.predict', `Expected log rent ${linear.toFixed(4)}${o.inSample ? ' (leave-one-out)' : ''}.`, {
      locality: nEff,
      madLog,
    })
    .build();
  return {
    expectedInr,
    lowInr,
    highInr,
    confidence,
    basis: {
      model: 'hedonic',
      level: 'hedonic',
      n: nEff,
      nEff,
      madLog,
      epsilon,
      areaAdjusted,
      loo: o.inSample,
      downgrades,
      modelRunId: o.modelRunId,
      engineVersion: ENGINE_VERSION,
      ...(context ? { context } : {}),
    },
    trace,
  };
}
