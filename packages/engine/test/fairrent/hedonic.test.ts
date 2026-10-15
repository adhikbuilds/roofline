import { describe, expect, it } from 'vitest';
import {
  buildDesign,
  irlsHuber,
  looPrediction,
  type Design,
} from '../../src/fairrent/hedonic';
import type { FlatInput } from '../../src/fairrent/types';

// deterministic pseudo-noise (no Math.random)
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

function fixture(n: number, outliers: number) {
  const rnd = lcg(42);
  const truth = [1.5, 2, -3, 0.5];
  const rows: Design['rows'] = [];
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = [rnd() * 4, rnd() * 4, rnd() * 4];
    rows.push({ idx: Int32Array.from([0, 1, 2, 3]), val: Float64Array.from([1, ...x]) });
    y[i] = truth[0]! + truth[1]! * x[0]! + truth[2]! * x[1]! + truth[3]! * x[2]! + rnd() * 0.002;
  }
  for (let i = 0; i < outliers; i++) y[i * 7] = y[i * 7]! + 50 + i;
  const d: Design = { rows, p: 4, columns: ['i', 'a', 'b', 'c'], penalized: [false, false, false, false] };
  return { d, y, truth };
}

describe('irlsHuber', () => {
  it('recovers known coefficients within 1e-3 despite gross outliers', () => {
    const { d, y, truth } = fixture(200, 10);
    const r = irlsHuber(d, y, new Float64Array(4), { lambda: 0 });
    expect(r.converged).toBe(true);
    truth.forEach((v, j) => expect(Math.abs(r.beta[j]! - v)).toBeLessThan(1e-3));
    expect(r.weights[0]!).toBeLessThan(0.1);
    expect(r.iterations).toBeLessThanOrEqual(50);
  });
  it('is deterministic', () => {
    const { d, y } = fixture(100, 5);
    const a = irlsHuber(d, y, new Float64Array(4));
    const b = irlsHuber(d, y, new Float64Array(4));
    expect(Array.from(a.beta)).toEqual(Array.from(b.beta));
  });
  it('ridge penalty shrinks penalised coefficients toward zero', () => {
    const { d, y } = fixture(100, 0);
    const free = irlsHuber(d, y, new Float64Array(4));
    const pen = irlsHuber(d, y, Float64Array.from([0, 0, 1e6, 0]));
    expect(Math.abs(pen.beta[2]!)).toBeLessThan(Math.abs(free.beta[2]!) * 0.1);
  });
  it('reports non-convergence without throwing', () => {
    const { d, y } = fixture(100, 10);
    const r = irlsHuber(d, y, new Float64Array(4), { maxIter: 1, tol: 1e-15 });
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(1);
  });
  it('throws on length mismatch', () => {
    const { d } = fixture(10, 0);
    expect(() => irlsHuber(d, new Float64Array(9), new Float64Array(4))).toThrow();
    expect(() => irlsHuber(d, new Float64Array(10), new Float64Array(3))).toThrow();
  });
});

describe('looPrediction', () => {
  it('matches brute-force refit without row i for OLS-weighted fit (no outliers)', () => {
    const { d, y } = fixture(40, 0);
    const opts = { lambda: 0, huberK: 1e9 }; // effectively OLS, weights all 1
    const full = irlsHuber(d, y, new Float64Array(4), opts);
    const i = 5;
    const d2: Design = { ...d, rows: d.rows.filter((_, k) => k !== i) };
    const y2 = Float64Array.from(Array.from(y).filter((_, k) => k !== i));
    const sub = irlsHuber(d2, y2, new Float64Array(4), opts);
    const row = d.rows[i]!;
    let pred = 0;
    for (let k = 0; k < row.idx.length; k++) pred += row.val[k]! * sub.beta[row.idx[k]!]!;
    expect(looPrediction(d, y, full, i)).toBeCloseTo(pred, 8);
  });
});

function flat(id: string, o: Partial<FlatInput> = {}): FlatInput {
  return {
    kind: 'flat', id, localityId: 3, zone: 'east', unitKind: 'bhk', bhk: 2, furnishing: 'semi',
    areaSqft: 1100, rentInr: 40000, parking: 'none', tags: [], floor: 2, totalFloors: 8, ...o,
  };
}

describe('buildDesign', () => {
  const refArea = { '0': 400, '1': 700, '2': 1100, '3': 1500, '4': 2000, '5': 3000 };
  it('encodes reference row with intercept and locality dummy only', () => {
    const d = buildDesign([flat('a', { zone: 'central' })], refArea);
    expect(d.columns.length).toBe(d.p);
    expect(d.penalized.length).toBe(d.p);
    const names = Array.from(d.rows[0]!.idx).map((j) => d.columns[j]);
    expect(names).toContain('intercept');
    expect(names).toContain('loc:3');
    expect(d.rows[0]!.val.every((v) => v === 1 || v === 0)).toBe(true);
    expect(d.penalized[d.columns.indexOf('loc:3')]).toBe(true);
    expect(d.penalized[d.columns.indexOf('intercept')]).toBe(false);
  });
  it('encodes zone, bhk, furnishing, amenities, floor and area terms', () => {
    const d = buildDesign(
      [flat('a', { zone: 'south', bhk: 3, furnishing: 'furnished', areaSqft: 3000 * 0 + 1500 * Math.E,
        parking: 'both', tags: ['Gated', 'Lift'], floor: 12 })],
      refArea,
    );
    const m = new Map(Array.from(d.rows[0]!.idx).map((j, k) => [d.columns[j]!, d.rows[0]!.val[k]!]));
    expect(m.get('zone:south')).toBe(1);
    expect(m.get('bhk:3')).toBe(1);
    expect(m.get('furn:furnished')).toBe(1);
    expect(m.get('parking_car')).toBe(1);
    expect(m.get('gated')).toBe(1);
    expect(m.get('lift')).toBe(1);
    expect(m.get('floor_10p')).toBe(1);
    expect(m.get('ln_area_c')).toBeCloseTo(1, 10);
  });
  it('flags missing area/furnishing/floor and studio kind', () => {
    const d = buildDesign(
      [flat('a', { unitKind: 'studio', bhk: 1, areaSqft: null, furnishing: null, floor: null })],
      refArea,
    );
    const names = Array.from(d.rows[0]!.idx).map((j) => d.columns[j]);
    expect(names).toEqual(expect.arrayContaining(['kind_studio', 'area_missing', 'furn:unknown', 'floor_unknown', 'bhk:0']));
    expect(names).not.toContain('ln_area_c');
  });
  it('is stable across row order', () => {
    const a = buildDesign([flat('a', { localityId: 1 }), flat('b', { localityId: 2 })], refArea);
    const b = buildDesign([flat('b', { localityId: 2 }), flat('a', { localityId: 1 })], refArea);
    expect(a.columns).toEqual(b.columns);
  });
});
