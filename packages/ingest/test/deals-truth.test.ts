import { describe, expect, it } from 'vitest';
import { DEAL_BAND, labelTrueDeal } from '../src/adapters/synthetic/truth';
import { judgeDeals, scoreRevised, scoreStrict } from '../src/eval/deals-eval';

describe('labelTrueDeal (ground-truth rule)', () => {
  it('exposes the band', () => {
    expect(DEAL_BAND).toEqual({ maxRatio: 0.8, minRatio: 0.45 });
  });
  it('0.80 x true expected is a deal (inclusive), one rupee above is not', () => {
    expect(labelTrueDeal({ observedRent: 80_000, trueRent: 100_000 })).toBe('natural');
    expect(labelTrueDeal({ observedRent: 80_001, trueRent: 100_000 })).toBeNull();
  });
  it('0.45 x true expected is a deal (inclusive), one rupee below is not', () => {
    expect(labelTrueDeal({ observedRent: 45_000, trueRent: 100_000 })).toBe('natural');
    expect(labelTrueDeal({ observedRent: 44_999, trueRent: 100_000 })).toBeNull();
  });
  it('uses exact integer arithmetic at awkward values', () => {
    // 0.8 * 35_000 is not exactly representable in floats; the rule must still be inclusive
    expect(labelTrueDeal({ observedRent: 28_000, trueRent: 35_000 })).toBe('natural');
    expect(labelTrueDeal({ observedRent: 15_750, trueRent: 35_000 })).toBe('natural');
  });
  it('planted deals keep kind deal, natural ones are labelled natural', () => {
    expect(labelTrueDeal({ observedRent: 70_000, trueRent: 100_000, planted: 'deal' })).toBe('deal');
    expect(labelTrueDeal({ observedRent: 70_000, trueRent: 100_000 })).toBe('natural');
  });
  it('a planted deal whose observed rent left the band is no longer a deal', () => {
    expect(labelTrueDeal({ observedRent: 90_000, trueRent: 100_000, planted: 'deal' })).toBeNull();
  });
  it('too_good plants are never deals, even inside the band', () => {
    expect(labelTrueDeal({ observedRent: 30_000, trueRent: 100_000, planted: 'too_good' })).toBeNull();
    expect(labelTrueDeal({ observedRent: 70_000, trueRent: 100_000, planted: 'too_good' })).toBeNull();
  });
  it('the x0.30 plant is a non-deal by the band alone', () => {
    expect(labelTrueDeal({ observedRent: 30_000, trueRent: 100_000 })).toBeNull();
  });
  it('rejects non-positive or missing inputs', () => {
    expect(labelTrueDeal({ observedRent: 0, trueRent: 100_000 })).toBeNull();
    expect(labelTrueDeal({ observedRent: 50_000, trueRent: 0 })).toBeNull();
    expect(labelTrueDeal({ observedRent: Number.NaN, trueRent: 100_000 })).toBeNull();
  });
});

describe('strict deal math (informational, no longer gating)', () => {
  it('precision uses listing level true positives, recall uses distinct hit units over active deal units', () => {
    const r = scoreStrict({ deals: 200, truePositives: 190, hitUnits: 180, trueDeals: 300, trueDealsActive: 220, tooGoodInDeals: 0, quarantined: 5 });
    expect(r.precision).toBeCloseTo(0.95, 12);
    expect(r.recall).toBeCloseTo(180 / 220, 12);
    expect(r.recallAll).toBeCloseTo(0.6, 12);
  });
  it('is zero rather than NaN with no deals or no units', () => {
    const r = scoreStrict({ deals: 0, truePositives: 0, trueDeals: 0, trueDealsActive: 0, tooGoodInDeals: 0, quarantined: 0 });
    expect(r).toEqual({ precision: 0, recall: 0, recallAll: 0 });
  });
  it('reports the natural/planted split in the output lines', () => {
    const r = judgeDeals({
      strict: { deals: 10, truePositives: 9, hitUnits: 9, trueDeals: 12, trueDealsActive: 10, tooGoodInDeals: 0, quarantined: 0, plantedUnits: 7, naturalUnits: 5 },
      revised: scoreRevised([]),
    });
    expect(r.lines.join('\n')).toMatch(/planted=7 natural=5/);
  });
});
