/** Versioned, hand-validated reader for `model_runs.artifact` (the engine has no runtime deps). */
import type { FairRentArtifact, HedonicArtifact, RobustMedianArtifact } from './types';

export const ARTIFACT_SCHEMA = 'roofline.fairrent' as const;
export const ARTIFACT_SCHEMA_VERSION = 1 as const;

export type { FairRentArtifact, HedonicArtifact, RobustMedianArtifact };

export class ArtifactError extends Error {
  constructor(message: string) {
    super(`invalid fair-rent artifact: ${message}`);
    this.name = 'ArtifactError';
  }
}

type Obj = Record<string, unknown>;

function fail(path: string, what: string): never {
  throw new ArtifactError(`${path} ${what}`);
}
function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) fail(path, 'must be an object');
  return v;
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'must be a finite number');
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'must be a string');
  return v;
}
function numArray(v: unknown, path: string, len?: number): number[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
    fail(path, 'must be an array of finite numbers');
  }
  if (len !== undefined && v.length !== len) fail(path, `must have length ${len}`);
  return v as number[];
}
function strArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) fail(path, 'must be an array of strings');
  return v as string[];
}
function record(v: unknown, path: string, each: (x: unknown, p: string) => void): void {
  for (const [k, x] of Object.entries(obj(v, path))) each(x, `${path}.${k}`);
}
function numRecord(v: unknown, path: string): void {
  record(v, path, (x, p) => void num(x, p));
}
function cell(v: unknown, path: string): void {
  const c = obj(v, path);
  num(c.n, `${path}.n`);
  num(c.median, `${path}.median`);
  num(c.mad, `${path}.mad`);
  if (c.ys !== undefined) numArray(c.ys, `${path}.ys`);
}
function cellMap(v: unknown, path: string): void {
  record(v, path, cell);
}
function nMad(v: unknown, path: string): void {
  const c = obj(v, path);
  num(c.n, `${path}.n`);
  num(c.mad, `${path}.mad`);
}

function commonConstants(v: unknown, path: string): void {
  const c = obj(v, path);
  for (const k of ['shrinkK', 'basisMinN', 'looMaxN', 'madScale', 'madFloor']) num(c[k], `${path}.${k}`);
  const conf = obj(c.confidence, `${path}.confidence`);
  for (const k of ['highN', 'highMad', 'mediumN']) num(conf[k], `${path}.confidence.${k}`);
}

function pgSubmodel(v: unknown, path: string): void {
  const pg = obj(v, path);
  record(pg.foodLog, `${path}.foodLog`, (x, p) => {
    const f = obj(x, p);
    num(f.value, `${p}.value`);
    if (!['paired', 'city', 'none'].includes(f.method as string)) fail(`${p}.method`, 'is not a known method');
  });
  const cells = obj(pg.cells, `${path}.cells`);
  for (const l of ['p1', 'p2', 'p3']) cellMap(cells[l], `${path}.cells.${l}`);
}

function robustMedian(a: Obj): void {
  const c = obj(a.constants, 'constants');
  commonConstants(c, 'constants');
  for (const k of ['epsDefault', 'tsMaxN', 'furnPairMinN', 'furnMinLocalities']) num(c[k], `constants.${k}`);
  numArray(c.epsClamp, 'constants.epsClamp', 2);
  const flat = obj(a.flat, 'flat');
  numRecord(flat.refArea, 'flat.refArea');
  record(flat.epsilon, 'flat.epsilon', (x, p) => {
    const e = obj(x, p);
    num(e.value, `${p}.value`);
    num(e.n, `${p}.n`);
    if (e.raw !== null) num(e.raw, `${p}.raw`);
    if (!['bhk', 'pooled', 'default'].includes(e.source as string)) fail(`${p}.source`, 'is not a known source');
  });
  record(flat.furnishingLog, 'flat.furnishingLog', (x, p) => {
    const f = obj(x, p);
    num(f.furnished, `${p}.furnished`);
    num(f.unfurnished, `${p}.unfurnished`);
    if (!['paired', 'city', 'none'].includes(f.method as string)) fail(`${p}.method`, 'is not a known method');
  });
  const cells = obj(flat.cells, 'flat.cells');
  for (const l of ['l1', 'l2', 'l3', 'l4']) cellMap(cells[l], `flat.cells.${l}`);
  pgSubmodel(a.pg, 'pg');
}

function hedonic(a: Obj): void {
  const c = obj(a.constants, 'constants');
  commonConstants(c, 'constants');
  for (const k of ['lambda', 'huberK', 'tol', 'maxIter']) num(c[k], `constants.${k}`);
  if (c.zoneRef !== 'central') fail('constants.zoneRef', 'must be "central"');
  const columns = strArray(a.columns, 'columns');
  const p = columns.length;
  if (p === 0) fail('columns', 'must not be empty');
  if (!Array.isArray(a.penalized) || a.penalized.length !== p || a.penalized.some((x) => typeof x !== 'boolean')) {
    fail('penalized', `must be an array of ${p} booleans`);
  }
  const dropped = strArray(a.droppedColumns, 'droppedColumns');
  if (dropped.some((d) => !columns.includes(d))) fail('droppedColumns', 'must name existing columns');
  numArray(a.beta, 'beta', p);
  numArray(a.cholL, 'cholL', p * p);
  num(a.huberScale, 'huberScale');
  numRecord(a.refArea, 'refArea');
  const irls = obj(a.irls, 'irls');
  num(irls.iterations, 'irls.iterations');
  if (typeof irls.converged !== 'boolean') fail('irls.converged', 'must be a boolean');
  const rm = obj(a.residualMad, 'residualMad');
  record(rm.locBhk, 'residualMad.locBhk', nMad);
  record(rm.zoneBhk, 'residualMad.zoneBhk', nMad);
  num(rm.global, 'residualMad.global');
  const ctx = obj(a.context, 'context');
  record(ctx.l1, 'context.l1', (x, q) => {
    const e = obj(x, q);
    num(e.n, `${q}.n`);
    num(e.medianRent, `${q}.medianRent`);
    if (e.rents !== undefined) numArray(e.rents, `${q}.rents`);
  });
  pgSubmodel(a.pg, 'pg');
}

/**
 * Validate an untrusted value (usually `JSON.parse` of `model_runs.artifact`) and return it typed.
 * Throws ArtifactError for unknown schema/schemaVersion/kind or any structural problem.
 */
export function parseArtifact(json: unknown): FairRentArtifact {
  if (!isObj(json)) throw new ArtifactError('artifact must be an object');
  const a = json;
  if (a.schema !== ARTIFACT_SCHEMA) fail('schema', `must be "${ARTIFACT_SCHEMA}"`);
  if (a.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    fail('schemaVersion', `${String(a.schemaVersion)} is not supported (expected ${ARTIFACT_SCHEMA_VERSION})`);
  }
  if (a.kind !== 'robust_median' && a.kind !== 'hedonic') fail('kind', 'must be "robust_median" or "hedonic"');
  str(a.engineVersion, 'engineVersion');
  str(a.asOf, 'asOf');
  strArray(a.fitIds, 'fitIds');
  const counts = obj(a.counts, 'counts');
  num(counts.flats, 'counts.flats');
  num(counts.pg, 'counts.pg');
  if (a.kind === 'robust_median') {
    robustMedian(a);
    return a as unknown as RobustMedianArtifact;
  }
  hedonic(a);
  return a as unknown as HedonicArtifact;
}
