import { describe, expect, it } from 'vitest';
import {
  LinalgError,
  backSolve,
  cholesky,
  choleskySolve,
  forwardSolve,
  quadFormInv,
  solveSPD,
  weightedGramSparse,
  weightedXtySparse,
} from '../../src/stats/linalg';

const A = new Float64Array([4, 12, -16, 12, 37, -43, -16, -43, 98]);
const L = new Float64Array([2, 0, 0, 6, 1, 0, -8, 5, 3]);

describe('cholesky', () => {
  it('factors a known matrix', () => {
    const l = cholesky(A, 3);
    l.forEach((v, i) => expect(v).toBeCloseTo(L[i]!, 12));
  });
  it('rejects non-SPD', () => {
    const bad = new Float64Array([1, 2, 2, 1]);
    try {
      cholesky(bad, 2);
      throw new Error('no throw');
    } catch (e) {
      expect(e).toBeInstanceOf(LinalgError);
      expect((e as LinalgError).code).toBe('NOT_POSITIVE_DEFINITE');
      expect((e as LinalgError).column).toBe(1);
    }
  });
  it('rejects singular and zero matrices', () => {
    expect(() => cholesky(new Float64Array([1, 1, 1, 1]), 2)).toThrow(LinalgError);
    expect(() => cholesky(new Float64Array(4), 2)).toThrow(LinalgError);
  });
  it('rejects dimension mismatch', () => {
    try {
      cholesky(new Float64Array(5), 2);
      throw new Error('no throw');
    } catch (e) {
      expect((e as LinalgError).code).toBe('DIMENSION_MISMATCH');
    }
  });
  it('handles n = 0 and n = 1', () => {
    expect(cholesky(new Float64Array(0), 0).length).toBe(0);
    expect(cholesky(new Float64Array([9]), 1)[0]).toBe(3);
  });
});

describe('solves', () => {
  const l = cholesky(A, 3);
  it('forward and back solve invert L and Lt', () => {
    const b = new Float64Array([1, 2, 3]);
    const x = forwardSolve(l, 3, b);
    // L x = b
    expect(2 * x[0]!).toBeCloseTo(1, 12);
    expect(6 * x[0]! + x[1]!).toBeCloseTo(2, 12);
    expect(-8 * x[0]! + 5 * x[1]! + 3 * x[2]!).toBeCloseTo(3, 12);
    const y = backSolve(l, 3, b);
    // Lt y = b
    expect(2 * y[0]! + 6 * y[1]! - 8 * y[2]!).toBeCloseTo(1, 12);
    expect(y[1]! + 5 * y[2]!).toBeCloseTo(2, 12);
    expect(3 * y[2]!).toBeCloseTo(3, 12);
  });
  it('solveSPD returns known solution', () => {
    const x = solveSPD(A, 3, new Float64Array([-20, -43, 192]));
    // A * [1, -1, 2]^T = [4-12-32, 12-37-86, -16+43+196]
    const b = new Float64Array([4 - 12 - 32, 12 - 37 - 86, -16 + 43 + 196]);
    const s = solveSPD(A, 3, b);
    [1, -1, 2].forEach((v, i) => expect(s[i]!).toBeCloseTo(v, 9));
    expect(x.length).toBe(3);
  });
  it('choleskySolve matches solveSPD and does not mutate inputs', () => {
    const b = new Float64Array([1, 2, 3]);
    const bc = Float64Array.from(b);
    const a = choleskySolve(l, 3, b);
    const s = solveSPD(A, 3, b);
    a.forEach((v, i) => expect(v).toBeCloseTo(s[i]!, 12));
    expect(Array.from(b)).toEqual(Array.from(bc));
  });
  it('rejects length mismatch', () => {
    expect(() => forwardSolve(l, 3, new Float64Array(2))).toThrow(LinalgError);
  });
  it('quadFormInv equals x^T A^-1 x', () => {
    const x = new Float64Array([1, -2, 0.5]);
    const s = solveSPD(A, 3, x);
    const direct = x[0]! * s[0]! + x[1]! * s[1]! + x[2]! * s[2]!;
    expect(quadFormInv(l, 3, x)).toBeCloseTo(direct, 10);
  });
});

describe('sparse normal equations', () => {
  const rows = [
    { idx: Int32Array.from([0, 2]), val: Float64Array.from([1, 2]) },
    { idx: Int32Array.from([0, 1]), val: Float64Array.from([1, -1]) },
    { idx: Int32Array.from([1, 2]), val: Float64Array.from([3, 1]) },
  ];
  const dense = [
    [1, 0, 2],
    [1, -1, 0],
    [0, 3, 1],
  ];
  const w = Float64Array.from([1, 0.5, 2]);
  const y = Float64Array.from([2, -1, 4]);
  it('gram matches dense and is symmetric', () => {
    const g = weightedGramSparse(rows, 3, w);
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) {
        let s = 0;
        for (let i = 0; i < 3; i++) s += w[i]! * dense[i]![a]! * dense[i]![b]!;
        expect(g[a * 3 + b]!).toBeCloseTo(s, 12);
      }
  });
  it('xty matches dense', () => {
    const v = weightedXtySparse(rows, 3, w, y);
    for (let a = 0; a < 3; a++) {
      let s = 0;
      for (let i = 0; i < 3; i++) s += w[i]! * dense[i]![a]! * y[i]!;
      expect(v[a]!).toBeCloseTo(s, 12);
    }
  });
  it('rejects weight length mismatch and out-of-range idx', () => {
    expect(() => weightedGramSparse(rows, 3, new Float64Array(2))).toThrow(LinalgError);
    expect(() =>
      weightedGramSparse([{ idx: Int32Array.from([3]), val: Float64Array.from([1]) }], 3, new Float64Array(1).fill(1)),
    ).toThrow(LinalgError);
  });
});
