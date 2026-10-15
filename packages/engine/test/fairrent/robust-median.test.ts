import { describe, expect, it } from 'vitest';
import {
  areaEpsilon,
  confidenceFor,
  fitPgSubmodel,
  fitRobustMedian,
  furnishingFactors,
  intervalFor,
  looMad,
  looMedian,
  predictPg,
  predictRobustMedian,
  selectBasis,
  shrinkChain,
  shrinkWeight,
} from '../../src/fairrent';
import type { FlatInput, FitListing, PgInput } from '../../src/fairrent';

const ASOF = '2026-01-01T00:00:00.000Z';

function flat(p: Partial<FlatInput> & { id: string; rentInr: number }): FlatInput {
  return {
    kind: 'flat',
    localityId: 1,
    zone: 'south',
    unitKind: 'bhk',
    bhk: 2,
    furnishing: 'semi',
    areaSqft: 1100,
    parking: null,
    tags: [],
    floor: null,
    totalFloors: null,
    ...p,
  };
}
function pg(p: Partial<PgInput> & { id: string; rentInr: number }): PgInput {
  return { kind: 'pg', localityId: 1, zone: 'south', sharing: 'double', food: true, ...p };
}

describe('shrinkWeight', () => {
  it('is n/(n+k)', () => {
    expect(shrinkWeight(46)).toBeCloseTo(46 / 56, 12);
    expect(shrinkWeight(10)).toBe(0.5);
    expect(shrinkWeight(0)).toBe(0);
    expect(shrinkWeight(5, 5)).toBe(0.5);
  });
});

describe('looMedian / looMad', () => {
  it('removes one occurrence of self', () => {
    expect(looMedian([1, 2, 3, 4, 100], 100)).toBe(2.5);
    expect(looMad([1, 2, 3, 4, 100], 100)).toBe(1);
    expect(looMedian([1, 2, 2, 5], 2)).toBe(2);
  });
  it('returns null when nothing is left, throws when self is absent', () => {
    expect(looMedian([7], 7)).toBeNull();
    expect(looMad([7], 7)).toBeNull();
    expect(() => looMedian([1, 2, 3], 9)).toThrow(RangeError);
  });
});

describe('shrinkChain', () => {
  it('shrinks bottom-up with w = n/(n+10)', () => {
    const r = shrinkChain([
      { n: 10, median: 12 },
      { n: 30, median: 10 },
      { n: 100, median: 8 },
    ])!;
    // 8 -> .75*10+.25*8 = 9.5 -> .5*12+.5*9.5 = 10.75
    expect(r.mu).toBeCloseTo(10.75, 12);
    expect(r.weights).toEqual([0.5, 0.75, 1]);
  });
  it('skips null and empty levels with weight 0', () => {
    const r = shrinkChain([null, { n: 0, median: 99 }, { n: 20, median: 3 }])!;
    expect(r.mu).toBe(3);
    expect(r.weights).toEqual([0, 0, 1]);
  });
  it('is null when the city level is empty', () => {
    expect(shrinkChain([{ n: 5, median: 1 }, null])).toBeNull();
    expect(shrinkChain([{ n: 5, median: 1 }, { n: 0, median: 1 }])).toBeNull();
    expect(shrinkChain([])).toBeNull();
  });
});

describe('selectBasis', () => {
  it('picks the first level with n >= 10, else the last', () => {
    expect(selectBasis([3, 12, 50, 200])).toBe(1);
    expect(selectBasis([10, 12])).toBe(0);
    expect(selectBasis([9, 9, 9, 9])).toBe(3);
    expect(selectBasis([3, 4], 4)).toBe(1);
  });
});

describe('confidenceFor / intervalFor', () => {
  it.each([
    [20, 0.25, 0, 'high'],
    [20, 0.26, 0, 'medium'],
    [19, 0.1, 0, 'medium'],
    [8, 0.5, 0, 'medium'],
    [7, 0.1, 0, 'low'],
    [20, 0.25, 1, 'medium'],
    [20, 0.25, 2, 'low'],
    [8, 0.1, 1, 'low'],
    [7, 0.1, 3, 'low'],
  ] as const)('n=%i mad=%f downgrades=%i -> %s', (n, m, d, want) => {
    expect(confidenceFor(n, m, d)).toBe(want);
  });

  it('applies the MAD floor and 1.4826 scale', () => {
    const z = intervalFor(42000, 0);
    const floor = intervalFor(42000, 0.05);
    expect(z).toEqual(floor);
    const h = 1.4826 * 0.05;
    expect(z.lowInr).toBe(Math.round(42000 * Math.exp(-h)));
    expect(z.highInr).toBe(Math.round(42000 * Math.exp(h)));
    expect(Math.abs(z.lowInr - 38999)).toBeLessThanOrEqual(1);
    const wide = intervalFor(42000, 0.2);
    expect(wide.lowInr).toBeLessThan(z.lowInr);
    expect(wide.highInr).toBeGreaterThan(z.highInr);
  });
});

describe('areaEpsilon', () => {
  function cellRows(bhk: number, n: number, exp: number, idPrefix: string): FlatInput[] {
    return Array.from({ length: n }, (_, i) => {
      const area = 600 + 40 * i;
      return flat({ id: `${idPrefix}${i}`, bhk, areaSqft: area, rentInr: Math.round(1000 * area ** exp) });
    });
  }
  it('recovers a per-BHK exponent (source bhk)', () => {
    const e = areaEpsilon(cellRows(2, 25, 0.35, 'a'), { '2': 1000 });
    expect(e['2']!.source).toBe('bhk');
    expect(e['2']!.value).toBeCloseTo(0.35, 3);
    expect(e['2']!.n).toBe(25);
  });
  it('clamps to [0.2, 0.8] but keeps the raw slope', () => {
    const hi = areaEpsilon(cellRows(2, 25, 1.5, 'a'), { '2': 1000 });
    expect(hi['2']!.value).toBe(0.8);
    expect(hi['2']!.raw).toBeCloseTo(1.5, 3);
    const lo = areaEpsilon(cellRows(2, 25, 0.05, 'a'), { '2': 1000 });
    expect(lo['2']!.value).toBe(0.2);
  });
  it('falls back to the pooled slope when a BHK has < 20 rows', () => {
    const rows = [...cellRows(2, 25, 0.5, 'a'), ...cellRows(3, 5, 0.5, 'b')];
    const e = areaEpsilon(rows, { '2': 1000, '3': 1000 });
    expect(e['3']!.source).toBe('pooled');
    expect(e['3']!.value).toBeCloseTo(0.5, 3);
  });
  it('falls back to the default 0.35 when no slope exists', () => {
    const same = Array.from({ length: 30 }, (_, i) => flat({ id: `s${i}`, rentInr: 30000 + i }));
    const e = areaEpsilon(same, { '2': 1100 });
    expect(e['2']).toEqual({ value: 0.35, raw: null, n: 0, source: 'default' });
    expect(areaEpsilon([], {})['0']!.source).toBe('default');
  });
  it('ignores rows with missing area and cells smaller than 3', () => {
    const rows = [
      flat({ id: 'x1', areaSqft: null, rentInr: 30000 }),
      flat({ id: 'x2', areaSqft: 900, rentInr: 30000, localityId: 2 }),
      flat({ id: 'x3', areaSqft: 1000, rentInr: 31000, localityId: 2 }),
    ];
    expect(areaEpsilon(rows, {})['2']!.source).toBe('default');
  });
});

describe('furnishingFactors', () => {
  const rowsFor = (locs: number[], dFurn: number, dUnf: number, n = 3) =>
    locs.flatMap((loc) => [
      ...Array.from({ length: n }, () => ({ localityId: loc, bhkKey: 2, furnishing: 'semi' as const, z: 10 })),
      ...Array.from({ length: n }, () => ({ localityId: loc, bhkKey: 2, furnishing: 'furnished' as const, z: 10 + dFurn })),
      ...Array.from({ length: n }, () => ({ localityId: loc, bhkKey: 2, furnishing: 'unfurnished' as const, z: 10 + dUnf })),
    ]);

  it('uses the paired weighted median with >= 5 qualifying localities', () => {
    const f = furnishingFactors(rowsFor([1, 2, 3, 4, 5], 0.15, -0.1))['2']!;
    expect(f.method).toBe('paired');
    expect(f.furnished).toBeCloseTo(0.15, 12);
    expect(f.unfurnished).toBeCloseTo(-0.1, 12);
  });
  it('falls back to the city ratio of medians below 5 localities', () => {
    const f = furnishingFactors(rowsFor([1, 2], 0.15, -0.1))['2']!;
    expect(f.method).toBe('city');
    expect(f.furnished).toBeCloseTo(0.15, 12);
  });
  it('is 0 / none without a semi group and covers every BHK key', () => {
    const all = furnishingFactors([{ localityId: 1, bhkKey: 2, furnishing: 'furnished', z: 11 }]);
    expect(all['2']).toEqual({ furnished: 0, unfurnished: 0, method: 'none' });
    expect(Object.keys(all).sort()).toEqual(['0', '1', '2', '3', '4', '5']);
  });
  it('is robust to locality mix (paired, not pooled)', () => {
    // furnished stock sits in pricey localities; pooled city ratio would be inflated
    const rows = [
      ...rowsFor([1, 2, 3, 4, 5], 0.1, 0),
      ...[1, 2, 3, 4, 5].flatMap((loc) =>
        Array.from({ length: 3 }, () => ({ localityId: loc, bhkKey: 2, furnishing: 'furnished' as const, z: 10.1 })),
      ),
    ];
    // add expensive localities with furnished only
    const f = furnishingFactors(rows)['2']!;
    expect(f.furnished).toBeCloseTo(0.1, 12);
  });
});

describe('fitRobustMedian / predictRobustMedian', () => {
  const rents = [30000, 32000, 34000, 36000, 38000, 40000, 42000, 44000, 46000];
  const nine = rents.map((r, i) => flat({ id: `f${i}`, rentInr: r }));
  const newFlat = (p: Partial<FlatInput> = {}) => flat({ id: 'new', rentInr: 40000, ...p });

  it('a 9-row cell yields its median (out of sample)', () => {
    const a = fitRobustMedian(nine, { asOf: ASOF });
    const p = predictRobustMedian(a, newFlat(), { inSample: false, modelRunId: 'run' })!;
    expect(p.expectedInr).toBe(38000);
    expect(p.basis.level).toBe('L4'); // n=9 < 10 everywhere
    expect(p.basis.n).toBe(9);
    expect(p.basis.nEff).toBe(9);
    expect(p.basis.loo).toBe(false);
    expect(p.confidence).toBe('medium');
    expect(p.basis.model).toBe('robust_median');
    expect(p.basis.modelRunId).toBe('run');
    expect(p.lowInr).toBeLessThan(p.expectedInr);
    expect(p.highInr).toBeGreaterThan(p.expectedInr);
    expect(p.trace.steps.length).toBeGreaterThan(0);
  });

  it('leave-one-out excludes self at every level', () => {
    const rows = [...nine, flat({ id: 'big', rentInr: 200000 })];
    const a = fitRobustMedian(rows, { asOf: ASOF });
    const inS = predictRobustMedian(a, rows[9]!, { inSample: true, modelRunId: 'r' })!;
    expect(inS.expectedInr).toBe(38000);
    expect(inS.basis.n).toBe(9);
    expect(inS.basis.loo).toBe(true);
    const oos = predictRobustMedian(a, newFlat({ rentInr: 200000 }), { inSample: false, modelRunId: 'r' })!;
    expect(oos.expectedInr).toBe(Math.round(Math.sqrt(38000 * 40000)));
    expect(oos.basis.level).toBe('L1');
    expect(oos.basis.n).toBe(10);
  });

  it('asserts inSample against fitIds', () => {
    const a = fitRobustMedian(nine, { asOf: ASOF });
    expect(a.fitIds).toEqual([...a.fitIds].sort());
    expect(() => predictRobustMedian(a, newFlat(), { inSample: true, modelRunId: 'r' })).toThrow();
    expect(() => predictRobustMedian(a, nine[0]!, { inSample: false, modelRunId: 'r' })).toThrow();
  });

  it('adjusts for area with the fitted exponent and downgrades when area is missing', () => {
    const rows = Array.from({ length: 30 }, (_, i) => {
      const area = 800 + 25 * i;
      return flat({ id: `a${i}`, areaSqft: area, rentInr: Math.round(40000 * (area / 1100) ** 0.35) });
    });
    const a = fitRobustMedian(rows, { asOf: ASOF });
    expect(a.flat.epsilon['2']!.value).toBeCloseTo(0.35, 3);
    const big = predictRobustMedian(a, flat({ id: 'n1', areaSqft: 1650, rentInr: 45000 }), { inSample: false, modelRunId: 'r' })!;
    expect(big.expectedInr / (40000 * 1.5 ** 0.35)).toBeCloseTo(1, 2);
    expect(big.basis.areaAdjusted).toBe(true);
    expect(big.basis.epsilon).toBeCloseTo(0.35, 3);
    expect(big.confidence).toBe('high');
    const noArea = predictRobustMedian(a, flat({ id: 'n2', areaSqft: null, rentInr: 45000 }), { inSample: false, modelRunId: 'r' })!;
    expect(noArea.basis.areaAdjusted).toBe(false);
    expect(noArea.basis.epsilon).toBeNull();
    expect(noArea.basis.downgrades).toEqual(['area_missing']);
    expect(noArea.confidence).toBe('medium');
  });

  it('applies the furnishing factor and treats unknown furnishing as semi-equivalent with a downgrade', () => {
    const rows: FlatInput[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push(flat({ id: `s${i}`, rentInr: 30000 + 500 * i, furnishing: 'semi' }));
      rows.push(flat({ id: `f${i}`, rentInr: Math.round((30000 + 500 * i) * 1.2), furnishing: 'furnished' }));
    }
    const a = fitRobustMedian(rows, { asOf: ASOF });
    expect(a.flat.furnishingLog['2']!.furnished).toBeCloseTo(Math.log(1.2), 3);
    const semi = predictRobustMedian(a, flat({ id: 'n1', rentInr: 1, furnishing: 'semi' }), { inSample: false, modelRunId: 'r' })!;
    const furn = predictRobustMedian(a, flat({ id: 'n2', rentInr: 1, furnishing: 'furnished' }), { inSample: false, modelRunId: 'r' })!;
    const unk = predictRobustMedian(a, flat({ id: 'n3', rentInr: 1, furnishing: null }), { inSample: false, modelRunId: 'r' })!;
    expect(furn.expectedInr / semi.expectedInr).toBeCloseTo(1.2, 2);
    expect(unk.expectedInr).toBe(semi.expectedInr);
    expect(unk.basis.downgrades).toContain('furnishing_missing');
  });

  it('shrinks sparse localities toward the zone and city', () => {
    const rows: FlatInput[] = [];
    for (let i = 0; i < 40; i++) rows.push(flat({ id: `c${i}`, localityId: 2, rentInr: 40000 }));
    rows.push(flat({ id: 'p1', localityId: 1, rentInr: 60000 }), flat({ id: 'p2', localityId: 1, rentInr: 60000 }));
    const a = fitRobustMedian(rows, { asOf: ASOF });
    const p = predictRobustMedian(a, flat({ id: 'n', localityId: 1, rentInr: 1 }), { inSample: false, modelRunId: 'r' })!;
    const expected = shrinkChain([
      { n: 2, median: Math.log(60000) },
      { n: 2, median: Math.log(60000) },
      { n: 42, median: a.flat.cells.l3['south|2']!.median },
      { n: 42, median: a.flat.cells.l4['2']!.median },
    ])!;
    expect(p.expectedInr).toBe(Math.round(Math.exp(expected.mu)));
    expect(p.expectedInr).toBeGreaterThan(40000);
    expect(p.expectedInr).toBeLessThan(60000);
    expect(p.basis.level).toBe('L3');
    expect(p.basis.nEff).toBe(2);
    expect(p.confidence).toBe('low');
  });

  it('returns null for an empty city cell (unseen BHK)', () => {
    const a = fitRobustMedian(nine, { asOf: ASOF });
    expect(predictRobustMedian(a, newFlat({ bhk: 4 }), { inSample: false, modelRunId: 'r' })).toBeNull();
  });

  it('stores ys only for cells below looMaxN', () => {
    const rows = Array.from({ length: 35 }, (_, i) => flat({ id: `k${i}`, rentInr: 30000 + 100 * i }));
    const a = fitRobustMedian(rows, { asOf: ASOF });
    expect(a.flat.cells.l4['2']!.ys).toBeUndefined();
    expect(a.flat.cells.l4['2']!.n).toBe(35);
    const small = fitRobustMedian(nine, { asOf: ASOF });
    expect(small.flat.cells.l4['2']!.ys).toHaveLength(9);
  });

  it('rejects non-positive rents', () => {
    expect(() => fitRobustMedian([flat({ id: 'z', rentInr: 0 })], { asOf: ASOF })).toThrow(RangeError);
  });

  it('survives a JSON round trip with identical in-sample predictions', () => {
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const rows: FitListing[] = [];
    for (let i = 0; i < 400; i++) {
      const loc = 1 + Math.floor(rnd() * 8);
      const bhk = 1 + Math.floor(rnd() * 3);
      const area = 400 + Math.floor(rnd() * 1200);
      rows.push(
        flat({
          id: `r${i}`,
          localityId: loc,
          zone: loc < 4 ? 'south' : 'east',
          bhk,
          furnishing: rnd() < 0.1 ? null : (['furnished', 'semi', 'unfurnished'] as const)[Math.floor(rnd() * 3)]!,
          areaSqft: rnd() < 0.1 ? null : area,
          rentInr: Math.round((15000 * bhk * (area / 800) ** 0.35 * Math.exp(0.1 * (rnd() - 0.5))) / 500) * 500 || 500,
        }),
      );
    }
    for (let i = 0; i < 120; i++) {
      rows.push(
        pg({
          id: `p${i}`,
          localityId: 1 + Math.floor(rnd() * 4),
          sharing: (['single', 'double', 'triple'] as const)[Math.floor(rnd() * 3)]!,
          food: rnd() < 0.15 ? null : rnd() < 0.5,
          rentInr: 6000 + Math.floor(rnd() * 8000),
        }),
      );
    }
    const a = fitRobustMedian(rows, { asOf: ASOF });
    const b = JSON.parse(JSON.stringify(a)) as typeof a;
    expect(b).toEqual(a);
    let produced = 0;
    for (const r of rows) {
      const o = { inSample: true, modelRunId: 'r' };
      const pa = predictRobustMedian(a, r, o);
      expect(predictRobustMedian(b, r, o)).toEqual(pa);
      if (pa) {
        produced++;
        expect(Number.isInteger(pa.expectedInr)).toBe(true);
        expect(pa.lowInr).toBeLessThanOrEqual(pa.expectedInr);
        expect(pa.highInr).toBeGreaterThanOrEqual(pa.expectedInr);
      }
    }
    expect(produced).toBeGreaterThan(450);
  });
});

describe('PG submodel', () => {
  const ratioRows = (): PgInput[] =>
    Array.from({ length: 6 }, (_, i) => [
      pg({ id: `n${i}`, food: false, rentInr: 10000 + 500 * i }),
      pg({ id: `f${i}`, food: true, rentInr: Math.round((10000 + 500 * i) * 1.2) }),
    ]).flat();

  it('estimates the food factor city-wide when fewer than 5 zones qualify', () => {
    const m = fitPgSubmodel(ratioRows());
    expect(m.foodLog['double']!.method).toBe('city');
    expect(m.foodLog['double']!.value).toBeCloseTo(Math.log(1.2), 3);
    expect(Object.keys(m.cells.p1)).toEqual(expect.arrayContaining(['1|double|food', '1|double|nofood']));
    expect(m.cells.p3['double']!.n).toBe(12);
  });

  it('predicts with and without food and returns null for unknown sharing', () => {
    const m = fitPgSubmodel(ratioRows());
    const c = fitRobustMedian([], { asOf: ASOF }).constants;
    const o = { inSample: false, modelRunId: 'r' };
    const withFood = predictPg(m, c, pg({ id: 'q1', food: true, rentInr: 1 }), o)!;
    const noFood = predictPg(m, c, pg({ id: 'q2', food: false, rentInr: 1 }), o)!;
    expect(withFood.expectedInr / noFood.expectedInr).toBeCloseTo(1.2, 2);
    expect(withFood.basis.areaAdjusted).toBe(false);
    expect(predictPg(m, c, pg({ id: 'q3', sharing: null, rentInr: 1 }), o)).toBeNull();
    const unknownFood = predictPg(m, c, pg({ id: 'q4', food: null, rentInr: 1 }), o)!;
    expect(unknownFood.basis.downgrades).toContain('food_missing');
    expect(unknownFood.basis.level).toBe('P3');
    expect(predictPg(m, c, pg({ id: 'q5', sharing: 'quad', rentInr: 1 }), o)).toBeNull();
  });

  it('is low confidence for sparse localities and uses LOO in-sample', () => {
    const rows = ratioRows();
    const a = fitRobustMedian(rows, { asOf: ASOF });
    const p = predictRobustMedian(a, rows[0]!, { inSample: true, modelRunId: 'r' })!;
    expect(p.basis.loo).toBe(true);
    expect(p.basis.level).toBe('P3'); // P1/P2 hold 5 after LOO, P3 holds 11
    expect(p.basis.n).toBe(11);
    expect(p.basis.nEff).toBe(5); // locality comps only
    expect(p.confidence).toBe('low');
  });
});
