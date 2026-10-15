import { describe, expect, it } from 'vitest';
import {
  NOT_ENOUGH_COMPS,
  explain,
  explainHedonic,
  explainRobustMedian,
  formatArea,
  formatBhk,
  formatCount,
  pctHalfAway,
} from '../../src/fairrent/explain';

const names = { localityName: 'Koramangala', zone: 'south' as const };

const flat = {
  kind: 'flat' as const,
  unitKind: 'bhk' as const,
  bhk: 2,
  furnishing: 'semi' as const,
  areaSqft: 1100 as number | null,
};

function est(over: Record<string, unknown> = {}, basis: Record<string, unknown> = {}) {
  return {
    expectedInr: 42000,
    confidence: 'high' as const,
    basis: { model: 'robust_median' as const, level: 'L1' as const, n: 46, ...basis },
    ...over,
  };
}

describe('helpers', () => {
  it('formatBhk', () => {
    expect(formatBhk('rk', 1)).toBe('1RK');
    expect(formatBhk('studio', 1)).toBe('Studio');
    expect(formatBhk('bhk', 2)).toBe('2BHK');
    expect(formatBhk('bhk', 6)).toBe('6BHK');
  });
  it('formatCount', () => {
    expect(formatCount(1)).toBe('1 listing');
    expect(formatCount(46)).toBe('46 listings');
    expect(formatCount(0)).toBe('0 listings');
    expect(formatCount(12345)).toBe('12,345 listings');
  });
  it('formatArea', () => {
    expect(formatArea(1100)).toBe('1,100');
    expect(formatArea(350)).toBe('350');
    expect(formatArea(123456)).toBe('1,23,456');
  });
  it('pctHalfAway', () => {
    expect(pctHalfAway(-0.10995)).toBe(11);
    expect(pctHalfAway(0.125)).toBe(13);
    expect(pctHalfAway(-0.125)).toBe(13);
    expect(pctHalfAway(0.0049)).toBe(0);
    expect(pctHalfAway(-0.2298)).toBe(23);
  });
});

describe('explainRobustMedian goldens', () => {
  it('PLAN 3.2 example', () => {
    expect(explainRobustMedian(est(), flat, 37800, names)).toBe(
      '₹4.2K below the Koramangala 2BHK semi-furnished median (₹42K, 46 listings). Adjusted for 1,100 sq ft.',
    );
  });
  it('above', () => {
    expect(explainRobustMedian(est(), flat, 46200, names)).toBe(
      '₹4.2K above the Koramangala 2BHK semi-furnished median (₹42K, 46 listings). Adjusted for 1,100 sq ft.',
    );
  });
  it('area missing drops the adjusted sentence', () => {
    expect(explainRobustMedian(est(), { ...flat, areaSqft: null }, 37800, names)).toBe(
      '₹4.2K below the Koramangala 2BHK semi-furnished median (₹42K, 46 listings).',
    );
  });
  it('L2 fallback', () => {
    expect(explainRobustMedian(est({}, { level: 'L2', n: 23 }), flat, 37800, names)).toBe(
      '₹4.2K below the Koramangala 2BHK median (₹42K, 23 listings). Adjusted for 1,100 sq ft.',
    );
  });
  it('L3 RK', () => {
    const rk = { ...flat, unitKind: 'rk' as const, bhk: 1, areaSqft: 350 };
    expect(
      explainRobustMedian(
        est({ expectedInr: 14000 }, { level: 'L3', n: 31 }),
        rk,
        12500,
        { localityName: 'Indiranagar', zone: 'south_east' },
      ),
    ).toBe('₹1.5K below the South-East Bangalore 1RK median (₹14K, 31 listings). Adjusted for 350 sq ft.');
  });
  it('L4 city and singular', () => {
    expect(explainRobustMedian(est({}, { level: 'L4', n: 1 }), flat, 37800, names)).toBe(
      '₹4.2K below the Bangalore 2BHK median (₹42K, 1 listing). Adjusted for 1,100 sq ft.',
    );
  });
  it('furnished / unfurnished', () => {
    expect(explainRobustMedian(est(), { ...flat, furnishing: 'furnished' }, 37800, names)).toContain(
      'Koramangala 2BHK furnished median',
    );
    expect(explainRobustMedian(est(), { ...flat, furnishing: 'unfurnished' }, 37800, names)).toContain(
      'Koramangala 2BHK unfurnished median',
    );
  });
  it('equal', () => {
    expect(explainRobustMedian(est(), flat, 42000, names)).toBe(
      'At the Koramangala 2BHK semi-furnished median (₹42K, 46 listings). Adjusted for 1,100 sq ft.',
    );
  });
  it('PG levels', () => {
    const pg = { kind: 'pg' as const, sharing: 'double' as const, food: true };
    const e = (level: string) => est({ expectedInr: 9000 }, { level, n: 12 });
    expect(explainRobustMedian(e('P1'), pg, 8000, names)).toBe(
      '₹1K below the Koramangala double-sharing PG with food median (₹9K, 12 listings).',
    );
    expect(explainRobustMedian(e('P2'), { ...pg, food: false }, 8000, names)).toBe(
      '₹1K below the South Bangalore double-sharing PG without food median (₹9K, 12 listings).',
    );
    expect(explainRobustMedian(e('P3'), pg, 8000, names)).toBe(
      '₹1K below the Bangalore double-sharing PG median (₹9K, 12 listings).',
    );
  });
});

describe('explainHedonic', () => {
  const he = (ctx: { l1MedianRentInr: number; l1N: number } | null = { l1MedianRentInr: 42000, l1N: 46 }, over: Record<string, unknown> = {}) => ({
    expectedInr: 38200,
    confidence: 'medium' as const,
    basis: { model: 'hedonic' as const, level: 'hedonic' as const, n: 46, ...(ctx ? { context: ctx } : {}) },
    ...over,
  });
  it('golden', () => {
    expect(explainHedonic(he(), flat, 34000, names)).toBe(
      'Expected ₹38.2K for a 1,100 sq ft semi-furnished 2BHK in Koramangala; listed ₹34K (11% below). Locality median ₹42K across 46 listings.',
    );
  });
  it('above and in line', () => {
    expect(explainHedonic(he(), flat, 42000, names)).toContain('(10% above)');
    expect(explainHedonic(he(), flat, 38200, names)).toContain('(in line with expected)');
  });
  it('omits area, furnishing, and trailing sentence when unknown', () => {
    expect(explainHedonic(he(), { ...flat, areaSqft: null, furnishing: null }, 34000, names)).toBe(
      'Expected ₹38.2K for a 2BHK in Koramangala; listed ₹34K (11% below).',
    );
  });
  it('omits trailing sentence for few comps or no context', () => {
    expect(explainHedonic(he({ l1MedianRentInr: 42000, l1N: 2 }), flat, 34000, names)).not.toContain('Locality median');
    expect(explainHedonic(he(null), flat, 34000, names)).not.toContain('Locality median');
  });
});

describe('explain dispatch', () => {
  it('low confidence is the sentinel', () => {
    expect(explain(est({ confidence: 'low' }), flat, 37800, names)).toBe(NOT_ENOUGH_COMPS);
    expect(NOT_ENOUGH_COMPS).toBe('Not enough comparable listings.');
  });
  it('dispatches on model', () => {
    expect(explain(est(), flat, 37800, names)).toContain('median');
    const h = {
      expectedInr: 38200,
      confidence: 'high' as const,
      basis: { model: 'hedonic' as const, level: 'hedonic' as const, n: 5 },
    };
    expect(explain(h, flat, 34000, names)).toMatch(/^Expected /);
  });
});
