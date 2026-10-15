import { ENGINE_VERSION } from '../version';
import { mad, median } from '../stats/descriptive';
import { theilSenSlope } from '../stats/theil-sen';
import { weightedMedian } from '../stats/weighted';
import { createTrace } from '../trace';
import type {
  CellJson,
  CommonConstants,
  Confidence,
  Downgrade,
  EpsilonEntry,
  FactorMethod,
  FitListing,
  FlatInput,
  Furnishing,
  FurnishingEntry,
  PgInput,
  PgSubmodel,
  PredictOptions,
  Prediction,
  RobustMedianArtifact,
  RobustMedianConstants,
} from './types';

export const SHRINK_K = 10;

export const DEFAULT_CONSTANTS: RobustMedianConstants = {
  shrinkK: SHRINK_K,
  basisMinN: 10,
  looMaxN: 30,
  madScale: 1.4826,
  madFloor: 0.05,
  confidence: { highN: 20, highMad: 0.25, mediumN: 8 },
  epsClamp: [0.2, 0.8],
  epsDefault: 0.35,
  tsMaxN: 2000,
  furnPairMinN: 3,
  furnMinLocalities: 5,
};

const BHK_KEYS = [0, 1, 2, 3, 4, 5] as const;
const EPS_MIN_BHK_ROWS = 20;
const EPS_MIN_CELL_N = 3;

// ---------------------------------------------------------------- primitives

/** Shrinkage weight n / (n + k). */
export function shrinkWeight(n: number, k: number = SHRINK_K): number {
  return n <= 0 ? 0 : n / (n + k);
}

/** Remove one occurrence of `self` from a sorted array. Throws when `self` is absent. */
function removeOne(sorted: readonly number[], self: number): number[] {
  let lo = 0;
  let hi = sorted.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = sorted[mid]!;
    if (v === self) {
      at = mid;
      break;
    }
    if (v < self) lo = mid + 1;
    else hi = mid - 1;
  }
  if (at < 0) throw new RangeError('leave-one-out: own value not found in cell');
  return [...sorted.slice(0, at), ...sorted.slice(at + 1)];
}

/** Type-7 median of an already sorted array. */
function sortedMedian(s: readonly number[]): number | null {
  if (s.length === 0) return null;
  const h = (s.length - 1) / 2;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo]! + (h - lo) * (s[hi]! - s[lo]!);
}

/** Median of a sorted cell with one occurrence of `self` removed; null when nothing remains. */
export function looMedian(sortedYs: readonly number[], self: number): number | null {
  return sortedMedian(removeOne(sortedYs, self));
}

/** Raw MAD of a sorted cell with one occurrence of `self` removed; null when nothing remains. */
export function looMad(sortedYs: readonly number[], self: number): number | null {
  return mad(removeOne(sortedYs, self));
}

/**
 * Bottom-up shrinkage. `levels` run deepest -> city. Each non-empty level blends its own
 * median (weight n/(n+k)) with the already shrunk coarser level. The city level is the anchor
 * (weight 1). Null when the city level is empty.
 */
export function shrinkChain(
  levels: ReadonlyArray<{ n: number; median: number } | null>,
  k: number = SHRINK_K,
): { mu: number; weights: number[] } | null {
  if (levels.length === 0) return null;
  const last = levels[levels.length - 1];
  if (!last || last.n <= 0) return null;
  const weights = new Array<number>(levels.length).fill(0);
  weights[levels.length - 1] = 1;
  let mu = last.median;
  for (let i = levels.length - 2; i >= 0; i--) {
    const lv = levels[i];
    if (!lv || lv.n <= 0) continue;
    const w = shrinkWeight(lv.n, k);
    weights[i] = w;
    mu = w * lv.median + (1 - w) * mu;
  }
  return { mu, weights };
}

/** Index of the first level with n >= minN, else the last level. */
export function selectBasis(counts: readonly number[], minN: number = 10): number {
  for (let i = 0; i < counts.length; i++) if (counts[i]! >= minN) return i;
  return counts.length - 1;
}

export function confidenceFor(
  nEff: number,
  madLog: number,
  downgrades: number,
  c: CommonConstants['confidence'] = DEFAULT_CONSTANTS.confidence,
): Confidence {
  const order: Confidence[] = ['low', 'medium', 'high'];
  let level = nEff >= c.highN && madLog <= c.highMad ? 2 : nEff >= c.mediumN ? 1 : 0;
  level = Math.max(0, level - downgrades);
  return order[level]!;
}

export function intervalFor(
  expectedInr: number,
  madLog: number,
  c: Pick<CommonConstants, 'madScale' | 'madFloor'> = DEFAULT_CONSTANTS,
): { lowInr: number; highInr: number } {
  const h = c.madScale * Math.max(madLog, c.madFloor);
  return {
    lowInr: Math.round(expectedInr * Math.exp(-h)),
    highInr: Math.round(expectedInr * Math.exp(h)),
  };
}

// ---------------------------------------------------------------- helpers

function bhkKeyOf(x: Pick<FlatInput, 'unitKind' | 'bhk'>): number {
  return x.unitKind === 'bhk' ? Math.min(Math.max(x.bhk, 0), 5) : 0;
}

function assertRent(x: FitListing): void {
  if (!Number.isFinite(x.rentInr) || x.rentInr <= 0) {
    throw new RangeError(`fitRobustMedian: rentInr must be positive (listing ${x.id})`);
  }
}

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

function buildCells(groups: Map<string, number[]>, looMaxN: number): Record<string, CellJson> {
  const out: Record<string, CellJson> = {};
  for (const key of [...groups.keys()].sort()) {
    const ys = [...groups.get(key)!].sort((a, b) => a - b);
    const cell: CellJson = { n: ys.length, median: median(ys)!, mad: mad(ys)! };
    if (ys.length < looMaxN) cell.ys = ys;
    out[key] = cell;
  }
  return out;
}

interface LooCell {
  n: number;
  median: number;
  mad: number;
}

/** Cell statistics as seen by one listing: leave-one-out when in-sample. Null when empty. */
function viewCell(
  cell: CellJson | undefined,
  selfY: number,
  inSample: boolean,
  looMaxN: number,
): LooCell | null {
  if (!cell || cell.n <= 0) return null;
  if (!inSample) return { n: cell.n, median: cell.median, mad: cell.mad };
  if (cell.n < looMaxN && cell.ys) {
    const rest = removeOne(cell.ys, selfY);
    if (rest.length === 0) return null;
    return { n: rest.length, median: sortedMedian(rest)!, mad: mad(rest)! };
  }
  if (cell.n - 1 <= 0) return null;
  return { n: cell.n - 1, median: cell.median, mad: cell.mad };
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

/** Weighted median of per-group differences, else a city-wide difference, else 0. */
function pairedFactor(
  groups: ReadonlyArray<{ a: readonly number[]; b: readonly number[] }>,
  cityA: readonly number[],
  cityB: readonly number[],
  minN: number,
  minGroups: number,
): { value: number; method: FactorMethod } {
  const ds: number[] = [];
  const ws: number[] = [];
  for (const g of groups) {
    if (g.a.length >= minN && g.b.length >= minN) {
      ds.push(median(g.a)! - median(g.b)!);
      ws.push(Math.min(g.a.length, g.b.length));
    }
  }
  if (ds.length >= minGroups) return { value: weightedMedian(ds, ws)!, method: 'paired' };
  if (cityA.length > 0 && cityB.length > 0) {
    return { value: median(cityA)! - median(cityB)!, method: 'city' };
  }
  return { value: 0, method: 'none' };
}

const METHOD_RANK: Record<FactorMethod, number> = { none: 0, city: 1, paired: 2 };

// ---------------------------------------------------------------- flats: fit pieces

/**
 * Per-BHK area exponent: Theil-Sen slope of cell-demeaned ln(rent) on ln(area), clamped.
 * `refArea` is accepted for signature symmetry with the artifact; the exponent does not need it.
 */
export function areaEpsilon(
  rows: readonly FlatInput[],
  refArea: Readonly<Record<string, number>>,
): Record<string, EpsilonEntry> {
  void refArea;
  const C = DEFAULT_CONSTANTS;
  const cells = new Map<string, FlatInput[]>();
  for (const r of rows) {
    if (r.areaSqft === null || !(r.areaSqft > 0)) continue;
    pushTo(cells, `${r.localityId}|${bhkKeyOf(r)}|${r.furnishing ?? 'null'}`, r);
  }
  const pts = new Map<number, Array<{ id: string; x: number; y: number }>>();
  const all: Array<{ id: string; x: number; y: number }> = [];
  for (const members of cells.values()) {
    if (members.length < EPS_MIN_CELL_N) continue;
    const lx = members.map((m) => Math.log(m.areaSqft!));
    const ly = members.map((m) => Math.log(m.rentInr));
    const mx = median(lx)!;
    const my = median(ly)!;
    const b = bhkKeyOf(members[0]!);
    members.forEach((m, i) => {
      const p = { id: m.id, x: lx[i]! - mx, y: ly[i]! - my };
      pushTo(pts, b, p);
      all.push(p);
    });
  }
  const slope = (list: Array<{ id: string; x: number; y: number }>): number | null => {
    const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const step = Math.max(1, Math.ceil(sorted.length / C.tsMaxN));
    const sub = step === 1 ? sorted : sorted.filter((_, i) => i % step === 0);
    return theilSenSlope(
      sub.map((p) => p.x),
      sub.map((p) => p.y),
    );
  };
  const clamp = (v: number) => Math.min(C.epsClamp[1], Math.max(C.epsClamp[0], v));
  let pooled: number | null | undefined;
  const out: Record<string, EpsilonEntry> = {};
  for (const b of BHK_KEYS) {
    const mine = pts.get(b) ?? [];
    const raw = mine.length >= EPS_MIN_BHK_ROWS ? slope(mine) : null;
    if (raw !== null) {
      out[String(b)] = { value: clamp(raw), raw, n: mine.length, source: 'bhk' };
      continue;
    }
    if (pooled === undefined) pooled = slope(all);
    out[String(b)] =
      pooled !== null
        ? { value: clamp(pooled), raw: pooled, n: all.length, source: 'pooled' }
        : { value: C.epsDefault, raw: null, n: 0, source: 'default' };
  }
  return out;
}

/** Log furnishing factors relative to semi-furnished, per BHK key (see PLAN 3.2). */
export function furnishingFactors(
  z: ReadonlyArray<{ localityId: number; bhkKey: number; furnishing: Furnishing | null; z: number }>,
): Record<string, FurnishingEntry> {
  const C = DEFAULT_CONSTANTS;
  const out: Record<string, FurnishingEntry> = {};
  for (const b of BHK_KEYS) {
    const byLoc = new Map<number, Record<Furnishing, number[]>>();
    const city: Record<Furnishing, number[]> = { furnished: [], semi: [], unfurnished: [] };
    for (const r of z) {
      if (r.bhkKey !== b || r.furnishing === null) continue;
      let g = byLoc.get(r.localityId);
      if (!g) byLoc.set(r.localityId, (g = { furnished: [], semi: [], unfurnished: [] }));
      g[r.furnishing].push(r.z);
      city[r.furnishing].push(r.z);
    }
    const groups = [...byLoc.values()];
    const f = pairedFactor(
      groups.map((g) => ({ a: g.furnished, b: g.semi })),
      city.furnished,
      city.semi,
      C.furnPairMinN,
      C.furnMinLocalities,
    );
    const u = pairedFactor(
      groups.map((g) => ({ a: g.unfurnished, b: g.semi })),
      city.unfurnished,
      city.semi,
      C.furnPairMinN,
      C.furnMinLocalities,
    );
    out[String(b)] = {
      furnished: f.value,
      unfurnished: u.value,
      method: METHOD_RANK[f.method] <= METHOD_RANK[u.method] ? f.method : u.method,
    };
  }
  return out;
}

// ---------------------------------------------------------------- PG submodel

const foodTag = (food: boolean): string => (food ? 'food' : 'nofood');

export function fitPgSubmodel(rows: readonly PgInput[], c: RobustMedianConstants = DEFAULT_CONSTANTS): PgSubmodel {
  const usable = rows.filter((r) => r.sharing !== null);
  const foodLog: PgSubmodel['foodLog'] = {};
  const sharings = [...new Set(usable.map((r) => r.sharing!))].sort();
  for (const s of sharings) {
    const mine = usable.filter((r) => r.sharing === s && r.food !== null);
    const byZone = new Map<string, { a: number[]; b: number[] }>();
    const cityA: number[] = [];
    const cityB: number[] = [];
    for (const r of mine) {
      let g = byZone.get(r.zone);
      if (!g) byZone.set(r.zone, (g = { a: [], b: [] }));
      const v = Math.log(r.rentInr);
      (r.food ? g.a : g.b).push(v);
      (r.food ? cityA : cityB).push(v);
    }
    foodLog[s] = pairedFactor([...byZone.values()], cityA, cityB, c.furnPairMinN, c.furnMinLocalities);
  }
  const p1 = new Map<string, number[]>();
  const p2 = new Map<string, number[]>();
  const p3 = new Map<string, number[]>();
  for (const r of usable) {
    const s = r.sharing!;
    const psi = foodLog[s]!.value;
    const y = Math.log(r.rentInr) - (r.food === true ? psi : 0);
    if (r.food !== null) {
      pushTo(p1, `${r.localityId}|${s}|${foodTag(r.food)}`, y);
      pushTo(p2, `${r.zone}|${s}|${foodTag(r.food)}`, y);
    }
    pushTo(p3, s, y);
  }
  return {
    foodLog,
    cells: {
      p1: buildCells(p1, c.looMaxN),
      p2: buildCells(p2, c.looMaxN),
      p3: buildCells(p3, c.looMaxN),
    },
  };
}

interface LevelEval {
  views: Array<LooCell | null>;
  mu: number;
  basisIdx: number;
}

/** Shared by flats and PGs: LOO views -> shrinkage -> basis. Null when the city level is empty. */
function evaluateLevels(
  cells: ReadonlyArray<CellJson | undefined>,
  selfY: number,
  inSample: boolean,
  c: CommonConstants,
  skip: ReadonlyArray<boolean> = [],
): LevelEval | null {
  const views = cells.map((cell, i) => (skip[i] ? null : viewCell(cell, selfY, inSample, c.looMaxN)));
  const chain = shrinkChain(views, c.shrinkK);
  if (!chain) return null;
  const basisIdx = selectBasis(
    views.map((v) => v?.n ?? 0),
    c.basisMinN,
  );
  return { views, mu: chain.mu, basisIdx };
}

export function predictPg(
  pg: PgSubmodel,
  c: CommonConstants,
  x: PgInput,
  o: PredictOptions,
): Prediction | null {
  if (x.sharing === null) return null;
  const psi = pg.foodLog[x.sharing]?.value ?? 0;
  const foodKnown = x.food !== null;
  const psiUsed = x.food === true ? psi : 0;
  const selfY = Math.log(x.rentInr) - psiUsed;
  const tag = foodKnown ? foodTag(x.food!) : '';
  const ev = evaluateLevels(
    [
      pg.cells.p1[`${x.localityId}|${x.sharing}|${tag}`],
      pg.cells.p2[`${x.zone}|${x.sharing}|${tag}`],
      pg.cells.p3[x.sharing],
    ],
    selfY,
    o.inSample,
    c,
    [!foodKnown, !foodKnown, false],
  );
  if (!ev) return null;
  const expectedInr = Math.max(1, Math.round(Math.exp(ev.mu + psiUsed)));
  const bv = ev.views[ev.basisIdx]!;
  const nEff = ev.views[0]?.n ?? 0;
  const downgrades: Downgrade[] = foodKnown ? [] : ['food_missing'];
  const confidence = confidenceFor(nEff, bv.mad, downgrades.length, c.confidence);
  const { lowInr, highInr } = intervalFor(expectedInr, bv.mad, c);
  const level = (['P1', 'P2', 'P3'] as const)[ev.basisIdx]!;
  const trace = createTrace()
    .step('pg.cells', `Compared with ${bv.n} PG listings at level ${level}.`, {
      counts: ev.views.map((v) => v?.n ?? 0),
      loo: o.inSample,
    })
    .step('pg.food', `Food factor ${psiUsed.toFixed(4)} (log).`, { sharing: x.sharing, food: x.food })
    .build();
  return {
    expectedInr,
    lowInr,
    highInr,
    confidence,
    basis: {
      model: 'robust_median',
      level,
      n: bv.n,
      nEff,
      madLog: bv.mad,
      epsilon: null,
      areaAdjusted: false,
      loo: o.inSample,
      downgrades,
      modelRunId: o.modelRunId,
      engineVersion: ENGINE_VERSION,
    },
    trace,
  };
}

// ---------------------------------------------------------------- flats: fit & predict

function flatTerms(
  a: Pick<RobustMedianArtifact['flat'], 'refArea' | 'epsilon' | 'furnishingLog'>,
  x: FlatInput,
): { b: number; eps: number; areaTerm: number; areaAdjusted: boolean; phi: number } {
  const b = bhkKeyOf(x);
  const eps = a.epsilon[String(b)]?.value ?? DEFAULT_CONSTANTS.epsDefault;
  const ref = a.refArea[String(b)];
  const areaAdjusted = x.areaSqft !== null && x.areaSqft > 0 && ref !== undefined;
  const areaTerm = areaAdjusted ? eps * Math.log(x.areaSqft! / ref!) : 0;
  const f = a.furnishingLog[String(b)];
  const phi = x.furnishing === 'furnished' ? (f?.furnished ?? 0) : x.furnishing === 'unfurnished' ? (f?.unfurnished ?? 0) : 0;
  return { b, eps, areaTerm, areaAdjusted, phi };
}

const flatKeys = (x: FlatInput, b: number) => ({
  l1: x.furnishing === null ? null : `${x.localityId}|${b}|${x.furnishing}`,
  l2: `${x.localityId}|${b}`,
  l3: `${x.zone}|${b}`,
  l4: `${b}`,
});

export function fitRobustMedian(
  rows: readonly FitListing[],
  opts: { asOf: string; constants?: Partial<RobustMedianConstants> },
): RobustMedianArtifact {
  for (const r of rows) assertRent(r);
  const constants: RobustMedianConstants = {
    ...DEFAULT_CONSTANTS,
    ...opts.constants,
    confidence: { ...DEFAULT_CONSTANTS.confidence, ...opts.constants?.confidence },
  };
  const flats = rows.filter((r): r is FlatInput => r.kind === 'flat');
  const pgs = rows.filter((r): r is PgInput => r.kind === 'pg');

  const areasByB = new Map<number, number[]>();
  for (const f of flats) if (f.areaSqft !== null && f.areaSqft > 0) pushTo(areasByB, bhkKeyOf(f), f.areaSqft);
  const refArea: Record<string, number> = {};
  for (const b of [...areasByB.keys()].sort((p, q) => p - q)) refArea[String(b)] = median(areasByB.get(b)!)!;

  const epsilon = areaEpsilon(flats, refArea);

  const partial = { refArea, epsilon, furnishingLog: {} as Record<string, FurnishingEntry> };
  const zRows = flats.map((f) => {
    const t = flatTerms(partial, f);
    return { f, t, z: Math.log(f.rentInr) - t.areaTerm };
  });
  const furnishingLog = furnishingFactors(
    zRows.map(({ f, t, z }) => ({ localityId: f.localityId, bhkKey: t.b, furnishing: f.furnishing, z })),
  );
  const full = { refArea, epsilon, furnishingLog };

  const g1 = new Map<string, number[]>();
  const g2 = new Map<string, number[]>();
  const g3 = new Map<string, number[]>();
  const g4 = new Map<string, number[]>();
  for (const f of flats) {
    const t = flatTerms(full, f);
    const y = Math.log(f.rentInr) - t.areaTerm - t.phi;
    const k = flatKeys(f, t.b);
    if (k.l1 !== null) pushTo(g1, k.l1, y);
    pushTo(g2, k.l2, y);
    pushTo(g3, k.l3, y);
    pushTo(g4, k.l4, y);
  }

  return {
    schema: 'roofline.fairrent',
    schemaVersion: 1,
    kind: 'robust_median',
    engineVersion: ENGINE_VERSION,
    asOf: opts.asOf,
    fitIds: rows.map((r) => r.id).sort(),
    counts: { flats: flats.length, pg: pgs.length },
    constants,
    flat: {
      refArea,
      epsilon,
      furnishingLog,
      cells: {
        l1: buildCells(g1, constants.looMaxN),
        l2: buildCells(g2, constants.looMaxN),
        l3: buildCells(g3, constants.looMaxN),
        l4: buildCells(g4, constants.looMaxN),
      },
    },
    pg: fitPgSubmodel(pgs, constants),
  };
}

function predictFlat(a: RobustMedianArtifact, x: FlatInput, o: PredictOptions): Prediction | null {
  const t = flatTerms(a.flat, x);
  const selfY = Math.log(x.rentInr) - t.areaTerm - t.phi;
  const k = flatKeys(x, t.b);
  const c = a.constants;
  const ev = evaluateLevels(
    [
      k.l1 === null ? undefined : a.flat.cells.l1[k.l1],
      a.flat.cells.l2[k.l2],
      a.flat.cells.l3[k.l3],
      a.flat.cells.l4[k.l4],
    ],
    selfY,
    o.inSample,
    c,
    [k.l1 === null, false, false, false],
  );
  if (!ev) return null;
  const expectedInr = Math.max(1, Math.round(Math.exp(ev.mu + t.phi + t.areaTerm)));
  const bv = ev.views[ev.basisIdx]!;
  const nEff = ev.basisIdx <= 1 ? bv.n : (ev.views[1]?.n ?? 0);
  const downgrades: Downgrade[] = [];
  if (x.areaSqft === null) downgrades.push('area_missing');
  if (x.furnishing === null) downgrades.push('furnishing_missing');
  const confidence = confidenceFor(nEff, bv.mad, downgrades.length, c.confidence);
  const { lowInr, highInr } = intervalFor(expectedInr, bv.mad, c);
  const level = (['L1', 'L2', 'L3', 'L4'] as const)[ev.basisIdx]!;
  const trace = createTrace()
    .step('rm.cells', `Compared with ${bv.n} listings at level ${level}.`, {
      counts: ev.views.map((v) => v?.n ?? 0),
      loo: o.inSample,
    })
    .step('rm.adjust', `Area term ${t.areaTerm.toFixed(4)}, furnishing term ${t.phi.toFixed(4)} (log).`, {
      epsilon: t.eps,
      areaAdjusted: t.areaAdjusted,
    })
    .build();
  return {
    expectedInr,
    lowInr,
    highInr,
    confidence,
    basis: {
      model: 'robust_median',
      level,
      n: bv.n,
      nEff,
      madLog: bv.mad,
      epsilon: t.areaAdjusted ? t.eps : null,
      areaAdjusted: t.areaAdjusted,
      loo: o.inSample,
      downgrades,
      modelRunId: o.modelRunId,
      engineVersion: ENGINE_VERSION,
    },
    trace,
  };
}

/**
 * Predict for one listing. `inSample` must match whether the listing is in `a.fitIds`
 * (asserted); in-sample predictions are leave-one-out. Null when no estimate is possible.
 */
export function predictRobustMedian(
  a: RobustMedianArtifact,
  x: FitListing,
  o: PredictOptions,
): Prediction | null {
  if (inFitIds(a.fitIds, x.id) !== o.inSample) {
    throw new Error(
      `predictRobustMedian: inSample=${o.inSample} but listing ${x.id} ${o.inSample ? 'is not' : 'is'} in the fit set`,
    );
  }
  return x.kind === 'pg' ? predictPg(a.pg, a.constants, x, o) : predictFlat(a, x, o);
}
