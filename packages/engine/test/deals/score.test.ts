import { describe, expect, it } from 'vitest';
import {
  DEAL_RULES,
  dealComponents,
  dealEligibility,
  dealReason,
  dealScore,
  evaluateDeal,
  rankDeals,
  type DealInput,
} from '../../src/deals/score';
import { deltaOf, storedDelta } from '../../src/fairrent/badge';

function mk(over: Partial<DealInput> = {}): DealInput {
  const rent = over.rentInr ?? 30500;
  const expected = over.expectedInr === undefined ? 39600 : over.expectedInr;
  const delta = expected === null ? null : deltaOf(rent, expected);
  return {
    listingId: 'a',
    asOf: '2026-03-10T00:00:00.000Z',
    rentInr: rent,
    expectedInr: expected,
    delta,
    deltaStored: delta === null ? null : storedDelta(delta),
    confidence: 'high',
    nEff: 52,
    qualityStatus: 'accepted',
    warnings: [],
    photoCount: 6,
    areaSqft: 1000,
    depositInr: 90000,
    floorKnown: true,
    parkingKnown: true,
    firstSeenAt: '2026-03-07T00:00:00.000Z',
    lastSeenAt: '2026-03-09T00:00:00.000Z',
    sourceCount: 2,
    rentMinInr: 30500,
    rentMaxInr: 31000,
    ...over,
  };
}

describe('eligibility', () => {
  it('passes the base fixture', () => {
    expect(dealEligibility(mk())).toEqual({ failed: [], quarantined: false });
  });

  const failing: Array<[string, Partial<DealInput>, string]> = [
    ['NO_ESTIMATE', { expectedInr: null }, 'NO_ESTIMATE'],
    ['DELTA_ABOVE_MAX', { rentInr: 32000, rentMinInr: 32000, rentMaxInr: 32000 }, 'DELTA_ABOVE_MAX'],
    ['DEAL_TOO_GOOD_TO_VERIFY', { rentInr: 15000, rentMinInr: 15000, rentMaxInr: 15000 }, 'DEAL_TOO_GOOD_TO_VERIFY'],
    ['LOW_CONFIDENCE', { confidence: 'low' }, 'LOW_CONFIDENCE'],
    ['QUALITY_NOT_ACCEPTED', { qualityStatus: 'rejected' }, 'QUALITY_NOT_ACCEPTED'],
    ['QUALITY_WARNING AREA_MISSING', { warnings: ['AREA_MISSING'] }, 'QUALITY_WARNING'],
    ['QUALITY_WARNING LOCALITY_FROM_GEO', { warnings: ['LOCALITY_FROM_GEO'] }, 'QUALITY_WARNING'],
    ['QUALITY_WARNING BHK_AREA_MISMATCH', { warnings: ['BHK_AREA_MISMATCH'] }, 'QUALITY_WARNING'],
    ['FEW_PHOTOS', { photoCount: 2 }, 'FEW_PHOTOS'],
    ['AREA_UNKNOWN', { areaSqft: null }, 'AREA_UNKNOWN'],
    ['STALE', { lastSeenAt: '2026-02-23T23:59:59.000Z' }, 'STALE'],
    ['SOURCE_SPREAD', { rentMinInr: 30500, rentMaxInr: 35076 }, 'SOURCE_SPREAD'],
  ];
  it.each(failing)('%s fails', (_n, over, code) => {
    const r = dealEligibility(mk(over));
    expect(r.failed).toContain(code);
  });

  it('each rule code has a fixture and the list is complete', () => {
    const covered = new Set(failing.map((f) => f[2]));
    for (const r of DEAL_RULES) expect(covered.has(r)).toBe(true);
  });

  it('DEPOSIT_MISSING warning is allowed', () => {
    expect(dealEligibility(mk({ warnings: ['DEPOSIT_MISSING'] })).failed).toEqual([]);
  });

  it('too-good quarantines; exact boundaries', () => {
    const q = dealEligibility(mk({ rentInr: 15000 }));
    expect(q.quarantined).toBe(true);
    // delta exactly -0.55 in double: quarantined (fround is below -0.55)
    const exact = mk({ rentInr: 4500, expectedInr: 10000 });
    expect(exact.delta).toBe(-0.55);
    expect(dealEligibility(exact).quarantined).toBe(true);
    // delta exactly -0.20 is eligible
    const edge = mk({ rentInr: 8000, expectedInr: 10000, rentMinInr: 8000, rentMaxInr: 8000 });
    expect(edge.delta).toBe(-0.2);
    expect(dealEligibility(edge).failed).toEqual([]);
  });

  it('stale: exactly 14 days passes', () => {
    expect(dealEligibility(mk({ lastSeenAt: '2026-02-24T00:00:00.000Z' })).failed).toEqual([]);
  });

  it('spread: exactly 15% passes', () => {
    expect(
      dealEligibility(mk({ rentMinInr: 20000, rentMaxInr: 23000, rentInr: 30500 })).failed,
    ).toEqual([]);
  });

  it('evaluates all rules and orders failed[] canonically', () => {
    const r = dealEligibility(
      mk({ photoCount: 0, areaSqft: null, confidence: 'low', qualityStatus: 'rejected' }),
    );
    expect(r.failed).toEqual(['LOW_CONFIDENCE', 'QUALITY_NOT_ACCEPTED', 'FEW_PHOTOS', 'AREA_UNKNOWN']);
  });

  it('no estimate only reports NO_ESTIMATE for delta rules', () => {
    const r = dealEligibility(mk({ expectedInr: null, delta: null, deltaStored: null }));
    expect(r.failed).toEqual(['NO_ESTIMATE']);
  });
});

describe('score', () => {
  it('golden 1', () => {
    const c = dealComponents(mk());
    expect(c.ageDays).toBe(3);
    expect(c.confW).toBe(1);
    expect(c.freshness).toBeCloseTo(0.9, 12);
    expect(c.completeness).toBe(1);
    expect(c.magnitude).toBeCloseTo(0.2297979798, 9);
    expect(dealScore(c)).toBeCloseTo(0.2068181818, 9);
  });
  it('golden 2: medium, stale-ish, partial completeness', () => {
    const c = dealComponents(
      mk({
        confidence: 'medium',
        firstSeenAt: '2026-02-18T00:00:00.000Z',
        depositInr: null,
        photoCount: 4,
      }),
    );
    expect(c.ageDays).toBe(20);
    expect(c.confW).toBe(0.75);
    expect(c.freshness).toBe(0.5);
    expect(c.completeness).toBeCloseTo(0.9, 12);
  });
  it('completeness bounds', () => {
    const lo = dealComponents(mk({ depositInr: null, photoCount: 3, floorKnown: false, parkingKnown: false }));
    expect(lo.completeness).toBe(0.8);
  });
  it('freshness clamps at 0.5 and ageDays never negative', () => {
    expect(dealComponents(mk({ firstSeenAt: '2025-01-01T00:00:00.000Z' })).freshness).toBe(0.5);
    expect(dealComponents(mk({ firstSeenAt: '2026-03-11T00:00:00.000Z' })).ageDays).toBe(0);
  });
});

describe('reason', () => {
  it('golden', () => {
    const x = mk();
    expect(dealReason(x, dealComponents(x))).toBe(
      '23% below fair rent · saves ₹9.1K/mo · high confidence (52 comps) · listed 3 days ago · on 2 sources',
    );
  });
  it('age and source wording', () => {
    const t = mk({ firstSeenAt: '2026-03-10T00:00:00.000Z', sourceCount: 1 });
    expect(dealReason(t, dealComponents(t))).toContain('listed today · on 1 source');
    const o = mk({ firstSeenAt: '2026-03-09T00:00:00.000Z' });
    expect(dealReason(o, dealComponents(o))).toContain('listed 1 day ago');
  });
});

describe('evaluateDeal / rankDeals', () => {
  it('eligible verdict carries score and reason', () => {
    const v = evaluateDeal(mk());
    expect(v.eligible).toBe(true);
    expect(v.score).toBeCloseTo(0.2068181818, 9);
    expect(v.reason).toContain('below fair rent');
    expect(v.reason).toContain('comps');
  });
  it('ineligible verdict has no score', () => {
    const v = evaluateDeal(mk({ photoCount: 1 }));
    expect(v).toMatchObject({ eligible: false, score: null, reason: null, components: null });
    expect(v.failed).toEqual(['FEW_PHOTOS']);
  });
  it('ranks by score desc then id asc, eligible only', () => {
    const vs = [
      evaluateDeal(mk({ listingId: 'b' })),
      evaluateDeal(mk({ listingId: 'a' })),
      evaluateDeal(mk({ listingId: 'c', rentInr: 25000, rentMinInr: 25000, rentMaxInr: 25000 })),
      evaluateDeal(mk({ listingId: 'd', photoCount: 0 })),
    ];
    expect(rankDeals(vs).map((v) => v.listingId)).toEqual(['c', 'a', 'b']);
  });
});
