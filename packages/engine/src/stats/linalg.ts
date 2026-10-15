/**
 * Small dense/sparse linear algebra for SPD normal equations. Pure; row-major Float64Array matrices.
 */

export type LinalgErrorCode = 'NOT_POSITIVE_DEFINITE' | 'DIMENSION_MISMATCH';

export class LinalgError extends Error {
  readonly code: LinalgErrorCode;
  readonly column?: number;
  constructor(code: LinalgErrorCode, message: string, column?: number) {
    super(message);
    this.name = 'LinalgError';
    this.code = code;
    if (column !== undefined) this.column = column;
  }
}

function dim(cond: boolean, msg: string): void {
  if (!cond) throw new LinalgError('DIMENSION_MISMATCH', msg);
}

/** Lower Cholesky factor of SPD n×n row-major A; throws NOT_POSITIVE_DEFINITE when pivot <= 1e-12*max(1,maxDiag). */
export function cholesky(a: Float64Array, n: number): Float64Array {
  dim(Number.isInteger(n) && n >= 0 && a.length === n * n, 'cholesky: expected n*n matrix');
  let maxDiag = 1;
  for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, a[i * n + i]!);
  const tol = 1e-12 * maxDiag;
  const l = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let d = a[j * n + j]!;
    for (let k = 0; k < j; k++) d -= l[j * n + k]! * l[j * n + k]!;
    if (!(d > tol)) {
      throw new LinalgError('NOT_POSITIVE_DEFINITE', `cholesky: non-positive pivot at column ${j}`, j);
    }
    const ljj = Math.sqrt(d);
    l[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = a[i * n + j]!;
      for (let k = 0; k < j; k++) s -= l[i * n + k]! * l[j * n + k]!;
      l[i * n + j] = s / ljj;
    }
  }
  return l;
}

/** Solve L x = b (L lower triangular). */
export function forwardSolve(l: Float64Array, n: number, b: Float64Array): Float64Array {
  dim(l.length === n * n && b.length === n, 'forwardSolve: dimension mismatch');
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= l[i * n + k]! * x[k]!;
    x[i] = s / l[i * n + i]!;
  }
  return x;
}

/** Solve Lᵀ x = b (L lower triangular). */
export function backSolve(l: Float64Array, n: number, b: Float64Array): Float64Array {
  dim(l.length === n * n && b.length === n, 'backSolve: dimension mismatch');
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let k = i + 1; k < n; k++) s -= l[k * n + i]! * x[k]!;
    x[i] = s / l[i * n + i]!;
  }
  return x;
}

/** Solve A x = b given the Cholesky factor of A. */
export function choleskySolve(l: Float64Array, n: number, b: Float64Array): Float64Array {
  return backSolve(l, n, forwardSolve(l, n, b));
}

export function solveSPD(a: Float64Array, n: number, b: Float64Array): Float64Array {
  return choleskySolve(cholesky(a, n), n, b);
}

/** xᵀ A⁻¹ x = ‖L⁻¹ x‖². */
export function quadFormInv(l: Float64Array, n: number, x: Float64Array): number {
  const z = forwardSolve(l, n, x);
  let s = 0;
  for (let i = 0; i < n; i++) s += z[i]! * z[i]!;
  return s;
}

interface SparseRowLike {
  idx: Int32Array;
  val: Float64Array;
}

function checkRow(r: SparseRowLike, p: number): void {
  dim(r.idx.length === r.val.length, 'sparse row: idx/val length mismatch');
  for (let k = 0; k < r.idx.length; k++) {
    const j = r.idx[k]!;
    dim(j >= 0 && j < p, `sparse row: index ${j} out of range`);
  }
}

/** XᵀWX (p×p, symmetric, row-major) for sparse rows. */
export function weightedGramSparse(
  rows: readonly SparseRowLike[],
  p: number,
  w: Float64Array,
): Float64Array {
  dim(w.length === rows.length, 'weightedGramSparse: weight length mismatch');
  const g = new Float64Array(p * p);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    checkRow(r, p);
    const wi = w[i]!;
    for (let a = 0; a < r.idx.length; a++) {
      const wa = wi * r.val[a]!;
      const ja = r.idx[a]!;
      for (let b = 0; b < r.idx.length; b++) {
        const at = ja * p + r.idx[b]!;
        g[at] = g[at]! + wa * r.val[b]!;
      }
    }
  }
  return g;
}

/** XᵀWy for sparse rows. */
export function weightedXtySparse(
  rows: readonly SparseRowLike[],
  p: number,
  w: Float64Array,
  y: Float64Array,
): Float64Array {
  dim(w.length === rows.length && y.length === rows.length, 'weightedXtySparse: length mismatch');
  const v = new Float64Array(p);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    checkRow(r, p);
    const c = w[i]! * y[i]!;
    for (let a = 0; a < r.idx.length; a++) {
      const j = r.idx[a]!;
      v[j] = v[j]! + c * r.val[a]!;
    }
  }
  return v;
}
