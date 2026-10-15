import { describe, expect, it } from 'vitest';
import { FAIRRENT_LIMITS, judgeFairRent } from '../src/eval/fairrent-eval';
import { DEALS_LIMITS, GREY_ZONE_PCT, classifyRatio, judgeDeals, scoreRevised } from '../src/eval/deals-eval';
import type { EligibleListing } from '../src/eval/deals-eval';

const cv = (mdapeTruth: number | undefined, coverageObs: number) => ({
  n: 5000, mdapeObs: 0.08, coverageObs, mdapeObsBadged: 0.07, nBadged: 4000, mdapeTruth, coverageTruth: 0.7,
});

describe('judgeFairRent', () => {
  it('passes when the active model is within 0.08 of truth and coverage is 0.55-0.80', () => {
    const r = judgeFairRent({ active: 'hedonic', cv: { robust_median: cv(0.06, 0.66), hedonic: cv(0.05, 0.68) } });
    expect(r.ok).toBe(true);
    expect(r.lines.join('\n')).toMatch(/robust_median.*mdape_vs_truth=0\.0600/);
    expect(r.lines.join('\n')).toMatch(/hedonic.*mdape_vs_truth=0\.0500.*\(active\)/);
    expect(r.lines[r.lines.length - 1]).toBe('eval:fairrent OK');
  });
  it.each([
    [0.0801, 0.7, /mdape_vs_truth/],
    [0.05, 0.5499, /coverage/],
    [0.05, 0.8001, /coverage/],
  ])('fails on mdape %s / coverage %s', (m, c, re) => {
    const r = judgeFairRent({ active: 'robust_median', cv: { robust_median: cv(m, c), hedonic: cv(0.01, 0.7) } });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(re);
    expect(r.lines[r.lines.length - 1]).toBe('eval:fairrent FAILED');
  });
  it('boundaries are inclusive', () => {
    expect(judgeFairRent({ active: 'robust_median', cv: { robust_median: cv(0.08, 0.55), hedonic: cv(0.08, 0.8) } }).ok).toBe(true);
    expect(FAIRRENT_LIMITS).toEqual({ maxMdapeTruth: 0.08, minCoverage: 0.55, maxCoverage: 0.8 });
  });
  it('fails when truth metrics are missing', () => {
    expect(judgeFairRent({ active: 'robust_median', cv: { robust_median: cv(undefined, 0.7), hedonic: cv(0.05, 0.7) } }).ok).toBe(false);
  });
});

describe('classifyRatio (integer arithmetic, grey zone (0.76, 0.84])', () => {
  it('is fixed at 0.76 / 0.84', () => {
    expect(GREY_ZONE_PCT).toEqual({ dealMax: 76, greyMax: 84 });
    expect(DEALS_LIMITS).toEqual({ minPrecision: 0.85, minRecall: 0.75 });
  });
  it.each([
    [50_000, 100_000, 'deal'],
    [76_000, 100_000, 'deal'],
    [76_001, 100_000, 'grey'],
    [84_000, 100_000, 'grey'],
    [84_001, 100_000, 'fair'],
    [100_000, 100_000, 'fair'],
    [26_600, 35_000, 'deal'], // 0.76 * 35_000 is not exact in floats
    [29_400, 35_000, 'grey'], // 0.84 * 35_000
  ])('rent %s vs true %s is %s', (rent, truth, want) => {
    expect(classifyRatio(rent, truth)).toBe(want);
  });
});

const L = (id: string, rent: number, shown: boolean, over: Partial<EligibleListing> = {}): EligibleListing => ({
  listingId: id, unitId: `u-${id}`, rentInr: rent, trueRentInr: 100_000, shown, tooGood: false, ...over,
});

describe('scoreRevised (population and grey-zone math)', () => {
  it('excludes grey-zone units from precision and recall', () => {
    const r = scoreRevised([
      L('a', 70_000, true), // deal, shown: TP
      L('b', 80_000, true), // grey, shown: excluded from precision
      L('c', 80_000, false), // grey, not shown: excluded from recall
      L('d', 95_000, true), // fair, shown: FP
      L('e', 60_000, false), // deal, missed
    ]);
    expect(r.shownOutsideGrey).toBe(2);
    expect(r.shownTruePositives).toBe(1);
    expect(r.precision).toBe(0.5);
    expect(r.dealUnits).toBe(2);
    expect(r.dealUnitsHit).toBe(1);
    expect(r.recall).toBe(0.5);
    expect(r.greyUnits).toBe(2);
  });
  it('keeps unshown (e.g. low-confidence) flats in the recall denominator', () => {
    const r = scoreRevised([L('a', 70_000, true), L('lowconf', 70_000, false), L('lowconf2', 50_000, false)]);
    expect(r.dealUnits).toBe(3);
    expect(r.recall).toBeCloseTo(1 / 3, 12);
    expect(r.precision).toBe(1);
  });
  it('too_good plants are never true deals: shown ones are false positives, absent ones are not in recall', () => {
    const r = scoreRevised([L('a', 70_000, true), L('tg', 30_000, true, { tooGood: true }), L('tg2', 30_000, false, { tooGood: true })]);
    expect(r.shownTruePositives).toBe(1);
    expect(r.shownOutsideGrey).toBe(2);
    expect(r.precision).toBe(0.5);
    expect(r.dealUnits).toBe(1);
    expect(r.recall).toBe(1);
  });
  it('counts a unit once even with several listings, and hits it if any listing is shown', () => {
    const r = scoreRevised([
      { ...L('a', 70_000, false), unitId: 'u1' },
      { ...L('b', 70_000, true), unitId: 'u1' },
    ]);
    expect(r.dealUnits).toBe(1);
    expect(r.dealUnitsHit).toBe(1);
    expect(r.recall).toBe(1);
  });
  it('is zero (not NaN) on an empty population', () => {
    const r = scoreRevised([]);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
  });
});

describe('judgeDeals (revised gate, strict printed alongside)', () => {
  const strict = { deals: 100, truePositives: 78, trueDeals: 248, trueDealsActive: 160, hitUnits: 78, tooGoodInDeals: 0, quarantined: 7 };
  const rows = (tp: number, fp: number, miss: number): EligibleListing[] => [
    ...Array.from({ length: tp }, (_, i) => L(`tp${i}`, 70_000, true)),
    ...Array.from({ length: fp }, (_, i) => L(`fp${i}`, 95_000, true)),
    ...Array.from({ length: miss }, (_, i) => L(`m${i}`, 70_000, false)),
  ];
  it('passes at exactly precision 0.85 and recall 0.75', () => {
    const r = judgeDeals({ strict, revised: scoreRevised(rows(15, 3, 5)) }); // 15/18=0.833 -> fail
    expect(r.ok).toBe(false);
    const ok = judgeDeals({ strict, revised: scoreRevised([...rows(17, 3, 0), ...rows(0, 0, 0)]) }); // 17/20 = 0.85, recall 1
    expect(ok.ok).toBe(true);
    const edge = judgeDeals({ strict, revised: scoreRevised(rows(15, 0, 5)) }); // recall 0.75
    expect(edge.ok).toBe(true);
    expect(edge.lines[edge.lines.length - 1]).toBe('eval:deals OK');
  });
  it('fails on recall below 0.75 or any too_good deal, and prints strict next to revised', () => {
    const lowRecall = judgeDeals({ strict, revised: scoreRevised(rows(14, 0, 6)) });
    expect(lowRecall.ok).toBe(false);
    expect(lowRecall.lines.join('\n')).toMatch(/revised.*precision=1\.0000.*recall=0\.7000/);
    expect(lowRecall.lines.join('\n')).toMatch(/strict.*precision=0\.7800.*recall=0\.4875/);
    const tg = judgeDeals({ strict: { ...strict, tooGoodInDeals: 1 }, revised: scoreRevised(rows(20, 0, 0)) });
    expect(tg.ok).toBe(false);
    expect(tg.lines.join('\n')).toMatch(/too_good_in_deals=1/);
    expect(tg.lines[tg.lines.length - 1]).toBe('eval:deals FAILED');
  });
  it('strict numbers never gate', () => {
    const r = judgeDeals({ strict: { ...strict, truePositives: 0, hitUnits: 0 }, revised: scoreRevised(rows(20, 0, 0)) });
    expect(r.ok).toBe(true);
    expect(r.strict.precision).toBe(0);
  });
});
