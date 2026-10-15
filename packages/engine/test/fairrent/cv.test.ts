import { describe, expect, it } from 'vitest';
import { chooseActive, crossValidate, fnv1a32, foldOf, type CvResult } from '../../src/fairrent/cv';
import { ALL, syntheticFlats } from './fixtures';

const ASOF = '2026-01-01T00:00:00.000Z';
const cv = (mdapeObs: number): CvResult => ({
  model: 'hedonic', n: 10, mdapeObs, coverageObs: 0.7, mdapeObsBadged: mdapeObs, nBadged: 10,
});

describe('foldOf', () => {
  it('fnv1a32 matches published vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
  it('hashes utf-8 bytes', () => {
    expect(fnv1a32('\u00e9')).toBe(0x1e9de8c1);
    expect(fnv1a32('\u{1F600}')).toBe(0x33a29608);
  });
  it('is deterministic, in range and roughly balanced', () => {
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5000; i++) {
      const f = foldOf(`listing-${i}`);
      expect(f).toBe(foldOf(`listing-${i}`));
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(5);
      counts[f]!++;
    }
    for (const c of counts) expect(c).toBeGreaterThan(800);
  });
  it('respects a custom k', () => {
    for (let i = 0; i < 50; i++) expect(foldOf(`x${i}`, 3)).toBeLessThan(3);
  });
});

describe('chooseActive', () => {
  it('picks hedonic only on a strictly lower observed MdAPE', () => {
    expect(chooseActive(cv(0.08), cv(0.0799))).toBe('hedonic');
  });
  it('ties go to robust_median', () => {
    expect(chooseActive(cv(0.08), cv(0.08))).toBe('robust_median');
  });
  it('higher hedonic error keeps robust_median', () => {
    expect(chooseActive(cv(0.08), cv(0.09))).toBe('robust_median');
  });
  it('ignores truth metrics', () => {
    expect(chooseActive({ ...cv(0.08), mdapeTruth: 0.1 }, { ...cv(0.081), mdapeTruth: 0.01 })).toBe('robust_median');
  });
});

describe('crossValidate', () => {
  const rows = ALL(500);
  const res = crossValidate(rows, { asOf: ASOF });

  it('is deterministic', () => {
    expect(crossValidate(rows, { asOf: ASOF })).toEqual(res);
  });
  it('is independent of input order', () => {
    expect(crossValidate([...rows].reverse(), { asOf: ASOF })).toEqual(res);
  });
  it('evaluates every flat out-of-sample exactly once on the same set for both models', () => {
    expect(res.robustMedian.n).toBe(500);
    expect(res.hedonic.n).toBe(500);
    expect(res.robustMedian.model).toBe('robust_median');
    expect(res.hedonic.model).toBe('hedonic');
  });
  it('reports sane metrics', () => {
    for (const m of [res.robustMedian, res.hedonic]) {
      expect(m.mdapeObs).toBeGreaterThan(0);
      expect(m.mdapeObs).toBeLessThan(0.15);
      expect(m.coverageObs).toBeGreaterThanOrEqual(0);
      expect(m.coverageObs).toBeLessThanOrEqual(1);
      expect(m.nBadged).toBeLessThanOrEqual(m.n);
      expect(m.mdapeTruth).toBeUndefined();
    }
  });
  it('hedonic wins on a correctly specified log-linear world', () => {
    expect(res.hedonic.mdapeObs).toBeLessThan(res.robustMedian.mdapeObs);
    expect(res.active).toBe('hedonic');
    expect(res.active).toBe(chooseActive(res.robustMedian, res.hedonic));
  });
  it('adds truth metrics only when a truth map is passed, without changing observed metrics', () => {
    const { truth } = syntheticFlats(500);
    const t = crossValidate(rows, { asOf: ASOF, truth });
    expect(t.hedonic.mdapeTruth).toBeGreaterThan(0);
    expect(t.hedonic.mdapeTruth!).toBeLessThan(t.hedonic.mdapeObs);
    expect(t.hedonic.coverageTruth).toBeGreaterThan(0);
    expect(t.robustMedian.mdapeTruth).toBeDefined();
    expect(t.hedonic.mdapeObs).toBe(res.hedonic.mdapeObs);
    expect(t.active).toBe(res.active);
  });
  it('handles an empty input and pg-only input', () => {
    const e = crossValidate([], { asOf: ASOF });
    expect(e.robustMedian.n).toBe(0);
    expect(e.active).toBe('robust_median');
    expect(crossValidate(ALL(0), { asOf: ASOF }).hedonic.n).toBe(0);
  });
});
