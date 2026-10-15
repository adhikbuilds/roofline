import { describe, expect, it } from 'vitest';
import { NOT_ENOUGH_COMPS } from '@roofline/engine';
import type { Prediction } from '@roofline/engine';
import {
  chooseWindowStart,
  estimateRow,
  looMdape,
  planListing,
  toDealInput,
  toFitListing,
  type FitRecord,
  type DbListingRow,
} from '../src/pipeline/fairrent-core';

const base: DbListingRow = {
  id: 'a0000000-0000-4000-8000-000000000001',
  unit_kind: 'bhk',
  bhk: 2,
  rent_inr: 37_800,
  deposit_inr: 100_000,
  area_sqft: 1100,
  furnishing: 'semi',
  locality_id: 7,
  locality_name: 'Koramangala',
  zone: 'central',
  pg_sharing: null,
  pg_food_included: null,
  photo_seeds: ['a', 'b', 'c', 'd', 'e'],
  source_count: 2,
  rent_min_inr: 37_000,
  rent_max_inr: 37_800,
  first_seen_at: '2026-09-01T00:00:00.000Z',
  c_parking: 'car',
  c_tags: ['Gated', 'Lift'],
  c_floor: 3,
  c_total_floors: 10,
  c_quality_status: 'accepted',
  m_last_seen_at: '2026-10-08T00:00:00.000Z',
  m_warnings: [],
};

function pred(over: Partial<Prediction> = {}, basis: Partial<Prediction['basis']> = {}): Prediction {
  return {
    expectedInr: 42_000,
    lowInr: 38_000,
    highInr: 46_000,
    confidence: 'high',
    basis: {
      model: 'robust_median', level: 'L1', n: 46, nEff: 46, madLog: 0.08, epsilon: 0.35, areaAdjusted: true,
      loo: true, downgrades: [], modelRunId: '5', engineVersion: '0.3.0', ...basis,
    },
    trace: { steps: [] } as unknown as Prediction['trace'],
    ...over,
  };
}

describe('toFitListing', () => {
  it('maps a flat with canonical-member extras', () => {
    expect(toFitListing(base)).toEqual({
      kind: 'flat', id: base.id, localityId: 7, zone: 'central', unitKind: 'bhk', bhk: 2, furnishing: 'semi', areaSqft: 1100,
      rentInr: 37_800, parking: 'car', tags: ['Gated', 'Lift'], floor: 3, totalFloors: 10,
    });
  });
  it('maps rk and studio to bhk 0', () => {
    expect(toFitListing({ ...base, unit_kind: 'rk', bhk: null })).toMatchObject({ kind: 'flat', unitKind: 'rk', bhk: 0 });
    expect(toFitListing({ ...base, unit_kind: 'studio', bhk: 1 })).toMatchObject({ unitKind: 'studio', bhk: 0 });
  });
  it('maps a PG bed', () => {
    expect(toFitListing({ ...base, unit_kind: 'pg_bed', bhk: null, pg_sharing: 'double', pg_food_included: true })).toEqual({
      kind: 'pg', id: base.id, localityId: 7, zone: 'central', sharing: 'double', food: true, rentInr: 37_800,
    });
  });
  it('drops a BHK flat with no bhk count', () => {
    expect(toFitListing({ ...base, bhk: null })).toBeNull();
  });
});

describe('estimateRow / planListing', () => {
  it('derives delta from integers, stores the float32 delta and the badge', () => {
    const row = estimateRow(base.id, pred(), 33_600, { localityName: 'Koramangala', zone: 'central' }, {
      kind: 'flat', unitKind: 'bhk', bhk: 2, furnishing: 'semi', areaSqft: 1100,
    });
    expect(row.delta).toBe(-0.2);
    expect(row.deltaStored).toBe(Math.fround(-0.2));
    expect(row.badge).toBe('great_deal');
    expect(row.explanation).toContain('below the Koramangala 2BHK semi-furnished median');
  });
  it('a low-confidence estimate has no badge and the refusal sentence', () => {
    const row = estimateRow(base.id, pred({ confidence: 'low' }), 37_800, { localityName: 'K', zone: 'central' }, {
      kind: 'flat', unitKind: 'bhk', bhk: 2, furnishing: 'semi', areaSqft: 1100,
    });
    expect(row.badge).toBeNull();
    expect(row.explanation).toBe(NOT_ENOUGH_COMPS);
  });
  it('listing plan: low or missing estimate nulls the numbers and keeps the sentence', () => {
    const low = estimateRow(base.id, pred({ confidence: 'low' }), 37_800, { localityName: 'K', zone: 'central' }, {
      kind: 'flat', unitKind: 'bhk', bhk: 2, furnishing: 'semi', areaSqft: 1100,
    });
    for (const e of [low, undefined]) {
      expect(planListing(e)).toEqual({
        fair_rent_inr: null, fair_low_inr: null, fair_high_inr: null, fair_delta_pct: null, badge: null,
        confidence: 'low', fair_explanation: NOT_ENOUGH_COMPS,
      });
    }
  });
  it('listing plan: a confident estimate carries the stored delta, never the double', () => {
    const e = estimateRow(base.id, pred(), 30_000, { localityName: 'K', zone: 'central' }, {
      kind: 'flat', unitKind: 'bhk', bhk: 2, furnishing: 'semi', areaSqft: 1100,
    });
    const p = planListing(e);
    expect(p.fair_delta_pct).toBe(Math.fround(-12_000 / 42_000));
    expect(p).toMatchObject({ fair_rent_inr: 42_000, fair_low_inr: 38_000, fair_high_inr: 46_000, confidence: 'high', badge: 'great_deal' });
    expect(p.fair_explanation).not.toBeNull();
  });
});

describe('toDealInput', () => {
  const rec = (over: Partial<DbListingRow> = {}): FitRecord => ({ listing: toFitListing({ ...base, ...over })!, row: { ...base, ...over } });
  it('carries cluster aggregates and completeness flags', () => {
    const e = estimateRow(base.id, pred(), 30_000, { localityName: 'K', zone: 'central' }, {
      kind: 'flat', unitKind: 'bhk', bhk: 2, furnishing: 'semi', areaSqft: 1100,
    });
    const d = toDealInput(rec(), e, '2026-10-15T00:00:00.000Z');
    expect(d).toMatchObject({
      listingId: base.id, asOf: '2026-10-15T00:00:00.000Z', rentInr: 37_800, expectedInr: 42_000, deltaStored: e.deltaStored,
      confidence: 'high', nEff: 46, qualityStatus: 'accepted', warnings: [], photoCount: 5, areaSqft: 1100, depositInr: 100_000,
      floorKnown: true, parkingKnown: true, firstSeenAt: base.first_seen_at, lastSeenAt: base.m_last_seen_at,
      sourceCount: 2, rentMinInr: 37_000, rentMaxInr: 37_800,
    });
  });
  it('flags unknown floor and parking, and a missing estimate', () => {
    const d = toDealInput(rec({ c_floor: null, c_parking: null }), undefined, '2026-10-15T00:00:00.000Z');
    expect(d).toMatchObject({ floorKnown: false, parkingKnown: false, expectedInr: null, delta: null, deltaStored: null, confidence: 'low' });
  });
  it('treats a non-accepted canonical as rejected and falls back to rent when min/max are null', () => {
    const d = toDealInput(rec({ c_quality_status: 'rejected', rent_min_inr: null, rent_max_inr: null }), undefined, '2026-10-15T00:00:00.000Z');
    expect(d.qualityStatus).toBe('rejected');
    expect([d.rentMinInr, d.rentMaxInr]).toEqual([37_800, 37_800]);
  });
});

describe('looMdape', () => {
  it('is the median absolute percentage error, null when empty', () => {
    expect(looMdape([])).toBeNull();
    expect(looMdape([{ expected: 110, rent: 100 }, { expected: 100, rent: 100 }, { expected: 150, rent: 100 }])).toBeCloseTo(0.1, 12);
  });
});

describe('chooseWindowStart', () => {
  it('is null without a window and asOf minus N days with one', () => {
    expect(chooseWindowStart(new Date('2026-10-15T00:00:00Z'), undefined)).toBeNull();
    expect(chooseWindowStart(new Date('2026-10-15T00:00:00Z'), 91)?.toISOString()).toBe('2026-07-16T00:00:00.000Z');
  });
});

describe('splitTruthMetrics', () => {
  it('moves every key containing Truth (at any depth) out of the public metrics', async () => {
    const { splitTruthMetrics } = await import('../src/pipeline/fairrent');
    const { publicMetrics, truthMetrics } = splitTruthMetrics({
      cv: { folds: 5, mdapeObs: 0.07, mdapeTruth: 0.05, coverageTruth: 0.7, nested: { deepTruthX: 1, keep: 2 } },
      selection: { active: true },
    });
    expect(JSON.stringify(publicMetrics)).not.toMatch(/truth/i);
    expect(publicMetrics).toEqual({ cv: { folds: 5, mdapeObs: 0.07, nested: { keep: 2 } }, selection: { active: true } });
    expect(truthMetrics).toEqual({ cv: { mdapeTruth: 0.05, coverageTruth: 0.7, nested: { deepTruthX: 1 } } });
  });
});
