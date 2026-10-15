import { describe, expect, it } from 'vitest';
import { buildDesign, fitHedonic, irlsHuber, looPrediction, predictHedonic } from '../../src/fairrent/hedonic';
import { fitRobustMedian } from '../../src/fairrent/robust-median';
import { parseArtifact } from '../../src/fairrent/artifact';
import { median } from '../../src/stats/descriptive';
import type { FlatInput } from '../../src/fairrent/types';
import { ALL, AREA_EXP, FURN_EFF, syntheticFlats, syntheticPgs, truthLog } from './fixtures';

const ASOF = '2026-01-01T00:00:00.000Z';

function fitAll(n = 600) {
  const rows = ALL(n);
  const rm = fitRobustMedian(rows, { asOf: ASOF });
  const art = fitHedonic(rows, { asOf: ASOF, pg: rm.pg });
  return { rows, rm, art };
}
const coef = (a: { columns: string[]; beta: number[] }, name: string): number => a.beta[a.columns.indexOf(name)]!;

describe('fitHedonic', () => {
  const { rows, rm, art } = fitAll();

  it('recovers the generating coefficients on a synthetic world', () => {
    expect(art.kind).toBe('hedonic');
    expect(coef(art, 'furn:furnished')).toBeCloseTo(FURN_EFF.furnished, 1);
    expect(Math.abs(coef(art, 'furn:furnished') - FURN_EFF.furnished)).toBeLessThan(0.02);
    expect(Math.abs(coef(art, 'furn:unfurnished') - FURN_EFF.unfurnished)).toBeLessThan(0.02);
    expect(Math.abs(coef(art, 'ln_area_c') - AREA_EXP)).toBeLessThan(0.05);
    expect(Math.abs(coef(art, 'bhk:3') - 0.45)).toBeLessThan(0.03); // 0.85 - 0.40 (ref bhk 2)
    expect(Math.abs(coef(art, 'bhk:1') + 0.4)).toBeLessThan(0.03);
    // amenities have no effect in the world
    for (const c of ['lift', 'parking_car']) expect(Math.abs(coef(art, c))).toBeLessThan(0.02);
  });

  it('drops unsupported unpenalised columns, reports them and pins them at 0', () => {
    for (const c of ['floor_10p', 'bhk:4', 'bhk:5', 'kind_studio', 'furn:unknown', 'area_missing', 'gated', 'bhk:0']) {
      expect(art.droppedColumns).toContain(c);
      expect(coef(art, c)).toBe(0);
    }
    expect(art.droppedColumns).not.toContain('intercept');
    expect(art.droppedColumns).not.toContain('ln_area_c');
  });

  it('stores a header consistent with the fit set and shares the pg block', () => {
    expect(art.schema).toBe('roofline.fairrent');
    expect(art.schemaVersion).toBe(1);
    expect(art.counts).toEqual({ flats: 600, pg: 20 });
    expect(art.fitIds).toEqual(rows.map((r) => r.id).sort());
    expect(art.pg).toEqual(rm.pg);
    expect(art.beta).toHaveLength(art.columns.length);
    expect(art.cholL).toHaveLength(art.columns.length ** 2);
    expect(art.penalized).toHaveLength(art.columns.length);
    expect(art.irls.converged).toBe(true);
    expect(art.huberScale).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const again = fitHedonic(rows, { asOf: ASOF, pg: rm.pg });
    expect(JSON.stringify(again)).toBe(JSON.stringify(art));
  });

  it('survives a JSON round trip: parse + predict equals the original for every fit listing', () => {
    const back = parseArtifact(JSON.parse(JSON.stringify(art)));
    for (const r of rows) {
      const o = { inSample: true, modelRunId: 'r1' };
      expect(predictHedonic(back as typeof art, r, o)).toEqual(predictHedonic(art, r, o));
    }
  });

  it('artifact contains only finite numbers (JSON safe)', () => {
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(art);
  });
});

describe('predictHedonic', () => {
  const { rows, rm, art } = fitAll();
  const flats = rows.filter((r): r is FlatInput => r.kind === 'flat');

  it('in-sample estimate equals the exact LOO prediction from irlsHuber', () => {
    const d = buildDesign(flats, art.refArea);
    const y = Float64Array.from(flats, (f) => Math.log(f.rentInr));
    const pen = Float64Array.from(d.penalized, (p) => (p ? 1 : 0));
    const r = irlsHuber(d, y, pen, { lambda: art.constants.lambda });
    for (const i of [0, 1, 17, 250, 599]) {
      const p = predictHedonic(art, flats[i]!, { inSample: true, modelRunId: 'r' })!;
      expect(Math.abs(p.expectedInr - Math.exp(looPrediction(d, y, r, i)))).toBeLessThanOrEqual(1);
      expect(p.basis.loo).toBe(true);
    }
  });

  it('out-of-sample estimate matches the noiseless truth closely', () => {
    const fresh = syntheticFlats(150, 1234).rows.map((f) => ({ ...f, id: `new-${f.id}` }));
    const errs = fresh.map((f) => {
      const p = predictHedonic(art, f, { inSample: false, modelRunId: 'r' })!;
      const t = Math.exp(truthLog(f));
      expect(p.lowInr).toBeLessThan(p.expectedInr);
      expect(p.highInr).toBeGreaterThan(p.expectedInr);
      return Math.abs(p.expectedInr - t) / t;
    });
    expect(median(errs)!).toBeLessThan(0.02);
  });

  it('fills basis, confidence and l1 context', () => {
    const p = predictHedonic(art, flats[0]!, { inSample: true, modelRunId: 'run-9' })!;
    expect(p.basis.model).toBe('hedonic');
    expect(p.basis.level).toBe('hedonic');
    expect(p.basis.modelRunId).toBe('run-9');
    expect(p.basis.engineVersion).toBe('0.3.0');
    expect(p.basis.areaAdjusted).toBe(true);
    expect(p.basis.epsilon).toBeCloseTo(coef(art, 'ln_area_c'), 10);
    expect(p.basis.nEff).toBeGreaterThan(20);
    expect(p.basis.context!.l1N).toBeGreaterThan(3);
    expect(p.confidence).toBe('high');
    expect(p.trace.steps.length).toBeGreaterThan(0);
  });

  it('in-sample l1 context excludes the listing itself', () => {
    const f = flats[0]!;
    const inS = predictHedonic(art, f, { inSample: true, modelRunId: 'r' })!;
    const outS = predictHedonic(art, { ...f, id: 'zzz' }, { inSample: false, modelRunId: 'r' })!;
    expect(inS.basis.context!.l1N).toBe(outS.basis.context!.l1N - 1);
    expect(inS.basis.nEff).toBe(outS.basis.nEff - 1);
  });

  it('downgrades when area or furnishing is missing', () => {
    const f = { ...flats[0]!, id: 'x1', areaSqft: null, furnishing: null };
    const p = predictHedonic(art, f, { inSample: false, modelRunId: 'r' })!;
    expect(p.basis.downgrades).toEqual(['area_missing', 'furnishing_missing']);
    expect(p.basis.areaAdjusted).toBe(false);
    expect(p.basis.epsilon).toBeNull();
    expect(p.basis.context).toBeUndefined();
    expect(p.confidence).toBe('low');
  });

  it('handles a locality unseen in the fit (no deviation, low locality support)', () => {
    const p = predictHedonic(art, { ...flats[0]!, id: 'nl', localityId: 999 }, { inSample: false, modelRunId: 'r' })!;
    expect(p.expectedInr).toBeGreaterThan(0);
    expect(p.basis.nEff).toBe(0);
    expect(p.confidence).toBe('low');
  });

  it('delegates pg listings to the embedded pg submodel', () => {
    const pgs = syntheticPgs(20);
    const p = predictHedonic(art, pgs[0]!, { inSample: true, modelRunId: 'r' })!;
    expect(p.basis.level).toMatch(/^P[123]$/);
    expect(p.expectedInr).toBeGreaterThan(7000);
  });

  it('asserts inSample matches the fit set', () => {
    expect(() => predictHedonic(art, flats[0]!, { inSample: false, modelRunId: 'r' })).toThrow();
    expect(() => predictHedonic(art, { ...flats[0]!, id: 'nope' }, { inSample: true, modelRunId: 'r' })).toThrow();
  });

  it('rejects non-positive rent on fit', () => {
    expect(() => fitHedonic([{ ...flats[0]!, rentInr: 0 }], { asOf: ASOF, pg: rm.pg })).toThrow();
  });

  it('returns null for flats when the artifact has no flats', () => {
    const empty = fitHedonic(syntheticPgs(5), { asOf: ASOF, pg: rm.pg });
    expect(predictHedonic(empty, { ...flats[0]!, id: 'q' }, { inSample: false, modelRunId: 'r' })).toBeNull();
  });
});
