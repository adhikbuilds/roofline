import { describe, it, expect } from 'vitest';
import {
  REASON_CODES,
  WARNING_CODES,
  QUALITY_BOUNDS,
  hardRules,
  buildBaseline,
  checkOutlier,
  assessRow,
  assessBatch,
  type QualityRow,
} from '../../src/quality';

const base: QualityRow = {
  kind: 'flat',
  bhk: 2,
  rentInr: 30000,
  areaSqft: 1100,
  localityId: 1,
  zone: 'east',
  pgSharing: null,
  lat: 12.97,
  lng: 77.6,
};
const row = (o: Partial<QualityRow> = {}): QualityRow => ({ ...base, ...o });

describe('constants', () => {
  it('enumerates stable codes', () => {
    expect(REASON_CODES.RENT_TOO_LOW).toBe('RENT_TOO_LOW');
    expect(Object.keys(REASON_CODES)).toEqual(Object.values(REASON_CODES));
    expect(Object.keys(WARNING_CODES)).toEqual(Object.values(WARNING_CODES));
    expect(QUALITY_BOUNDS.flatRentMin).toBe(1500);
  });
});

describe('hardRules', () => {
  it('accepts a clean row', () => {
    expect(hardRules(row())).toEqual({ reasons: [], warnings: [] });
  });
  it('rejects rent < 1500, accepts exactly 1500', () => {
    expect(hardRules(row({ rentInr: 1499, areaSqft: null })).reasons).toContain('RENT_TOO_LOW');
    expect(hardRules(row({ rentInr: 1500, areaSqft: null })).reasons).not.toContain('RENT_TOO_LOW');
    expect(hardRules(row({ rentInr: 1, areaSqft: null })).reasons).toContain('RENT_TOO_LOW');
  });
  it('rejects too high rent', () => {
    expect(hardRules(row({ rentInr: 1_000_001 })).reasons).toContain('RENT_TOO_HIGH');
    expect(hardRules(row({ rentInr: 1_000_000 })).reasons).not.toContain('RENT_TOO_HIGH');
  });
  it('rejects non-finite or non-positive rent', () => {
    expect(hardRules(row({ rentInr: NaN })).reasons).toContain('RENT_TOO_LOW');
    expect(hardRules(row({ rentInr: -5 })).reasons).toContain('RENT_TOO_LOW');
    expect(hardRules(row({ rentInr: Infinity })).reasons).toContain('RENT_TOO_HIGH');
  });
  it('uses PG bounds for PG rows', () => {
    const pg = { kind: 'pg' as const, bhk: null, areaSqft: null, pgSharing: 'double' };
    expect(hardRules(row({ ...pg, rentInr: 1999 })).reasons).toContain('RENT_TOO_LOW');
    expect(hardRules(row({ ...pg, rentInr: 2000 })).reasons).toEqual([]);
    expect(hardRules(row({ ...pg, rentInr: 60001 })).reasons).toContain('RENT_TOO_HIGH');
  });
  it('area range', () => {
    expect(hardRules(row({ areaSqft: 119 })).reasons).toContain('AREA_IMPLAUSIBLE');
    expect(hardRules(row({ areaSqft: 15001 })).reasons).toContain('AREA_IMPLAUSIBLE');
    expect(hardRules(row({ areaSqft: 0 })).reasons).toContain('AREA_IMPLAUSIBLE');
    expect(hardRules(row({ areaSqft: 99999 })).reasons).toContain('AREA_IMPLAUSIBLE');
    expect(hardRules(row({ areaSqft: NaN })).reasons).toContain('AREA_IMPLAUSIBLE');
    expect(hardRules(row({ areaSqft: 120, bhk: 0 })).reasons).not.toContain('AREA_IMPLAUSIBLE');
  });
  it('missing area is a warning only', () => {
    const r = hardRules(row({ areaSqft: null }));
    expect(r.reasons).toEqual([]);
    expect(r.warnings).toContain('AREA_MISSING');
  });
  it('psf bounds for flats with area', () => {
    expect(hardRules(row({ rentInr: 1500, areaSqft: 1100 })).reasons).toContain('PSF_IMPLAUSIBLE');
    expect(hardRules(row({ rentInr: 400000, areaSqft: 1100 })).reasons).toContain('PSF_IMPLAUSIBLE');
  });
  it('rejects missing locality and missing geo', () => {
    const r = hardRules(row({ localityId: null, lat: null, lng: null }));
    expect(r.reasons).toContain('LOCALITY_UNRESOLVED');
    expect(r.reasons).toContain('GEO_INVALID');
  });
  it('rejects missing locality with (0,0) or out-of-bbox geo', () => {
    expect(hardRules(row({ localityId: null, lat: 0, lng: 0 })).reasons).toContain('GEO_INVALID');
    expect(hardRules(row({ localityId: null, lat: 28.6, lng: 77.2 })).reasons).toContain('LOCALITY_UNRESOLVED');
    expect(hardRules(row({ localityId: null, lat: NaN, lng: 77.6 })).reasons).toContain('GEO_INVALID');
    expect(hardRules(row({ localityId: null, lat: 12.97, lng: null })).reasons).toContain('GEO_INVALID');
  });
  it('accepts empty locality with valid geo and warns LOCALITY_FROM_GEO', () => {
    const r = hardRules(row({ localityId: null }));
    expect(r.reasons).toEqual([]);
    expect(r.warnings).toContain('LOCALITY_FROM_GEO');
  });
  it('honours localityFromGeo flag', () => {
    expect(hardRules(row({ localityFromGeo: true })).warnings).toContain('LOCALITY_FROM_GEO');
  });
  it('bad geo with a resolved locality is not rejected', () => {
    expect(hardRules(row({ lat: 0, lng: 0 })).reasons).toEqual([]);
  });
  it('BHK/area inconsistency warnings', () => {
    expect(hardRules(row({ bhk: 4, areaSqft: 300, rentInr: 30000 })).warnings).toContain('BHK_AREA_MISMATCH');
    expect(hardRules(row({ bhk: 1, areaSqft: 3000, rentInr: 80000 })).warnings).toContain('BHK_AREA_MISMATCH');
    expect(hardRules(row({ bhk: 2, areaSqft: 1100 })).warnings).not.toContain('BHK_AREA_MISMATCH');
    expect(hardRules(row({ bhk: 9, areaSqft: 5000, rentInr: 80000 })).warnings).not.toContain('BHK_AREA_MISMATCH');
    expect(hardRules(row({ bhk: null })).warnings).not.toContain('BHK_AREA_MISMATCH');
  });
});

// deterministic spread around 30000 with area ~1100
function cell(n: number, localityId: number, zone: string, bhk = 2, centre = 30000): QualityRow[] {
  return Array.from({ length: n }, (_, i) => {
    const f = 1 + ((i % 9) - 4) * 0.02;
    return row({ localityId, zone, bhk, rentInr: Math.round(centre * f), areaSqft: 1100 });
  });
}

describe('outliers', () => {
  it('MAD: rejects extreme low and high, keeps normal and genuine deal', () => {
    const b = buildBaseline(cell(30, 1, 'east'));
    expect(checkOutlier(b, row()).rejected).toBe(false);
    const lo = checkOutlier(b, row({ rentInr: 9000 }));
    expect(lo).toMatchObject({ rejected: true, code: 'RENT_OUTLIER_MAD', level: 'locality' });
    expect(lo.z!).toBeLessThan(-4);
    const hi = checkOutlier(b, row({ rentInr: 120000 }));
    expect(hi).toMatchObject({ rejected: true, code: 'RENT_OUTLIER_MAD' });
    expect(hi.z!).toBeGreaterThan(3.5);
    // 35% below market survives thanks to the 0.10 floor
    expect(checkOutlier(b, row({ rentInr: 19500 })).rejected).toBe(false);
  });
  it('asymmetric thresholds', () => {
    const b = buildBaseline(cell(30, 1, 'east'));
    // floor 0.10 => z = 0.6745*d/0.10, d=ln ratio. +3.5 => d=0.519 (x1.68); -4 => d=0.593 (x0.553)
    expect(checkOutlier(b, row({ rentInr: Math.round(30000 * 1.7) })).rejected).toBe(true);
    expect(checkOutlier(b, row({ rentInr: Math.round(30000 * 1.6) })).rejected).toBe(false);
    expect(checkOutlier(b, row({ rentInr: Math.round(30000 * 0.57) })).rejected).toBe(false);
    expect(checkOutlier(b, row({ rentInr: Math.round(30000 * 0.5) })).rejected).toBe(true);
  });
  it('area adjusts: big flat with proportionally high rent is not an outlier', () => {
    const b = buildBaseline(cell(30, 1, 'east'));
    // ln(2200/1100)=0.693 * 0.35 => rent x1.27
    expect(checkOutlier(b, row({ rentInr: 38000, areaSqft: 2200 })).rejected).toBe(false);
  });
  it('missing area is scored on raw log rent', () => {
    const b = buildBaseline(cell(30, 1, 'east'));
    expect(checkOutlier(b, row({ areaSqft: null, rentInr: 9000 })).rejected).toBe(true);
    expect(checkOutlier(b, row({ areaSqft: null })).rejected).toBe(false);
  });
  it('falls back to zone when locality n < 8', () => {
    const rows = [...cell(5, 1, 'east'), ...cell(30, 2, 'east')];
    const b = buildBaseline(rows);
    const r = checkOutlier(b, row({ rentInr: 9000 }));
    expect(r).toMatchObject({ level: 'zone', code: 'RENT_OUTLIER_MAD', rejected: true });
  });
  it('falls back to city IQR fences when locality and zone are small', () => {
    const rows = [...cell(5, 1, 'east'), ...cell(30, 3, 'west')];
    const b = buildBaseline(rows);
    const r = checkOutlier(b, row({ rentInr: 500000 }));
    expect(r).toMatchObject({ level: 'city', code: 'RENT_OUTLIER_IQR', rejected: true });
    expect(checkOutlier(b, row({ rentInr: 32000 }))).toMatchObject({ level: 'city', rejected: false });
    expect(checkOutlier(b, row({ rentInr: 2000 })).rejected).toBe(true);
  });
  it('IQR fallback on cells with unknown zone', () => {
    const b = buildBaseline(cell(20, 3, 'west'));
    const r = checkOutlier(b, row({ zone: null, localityId: null, rentInr: 500000 }));
    expect(r).toMatchObject({ level: 'city', code: 'RENT_OUTLIER_IQR', rejected: true });
  });
  it('no verdict when even the city group is too small', () => {
    const b = buildBaseline(cell(3, 1, 'east'));
    expect(checkOutlier(b, row({ rentInr: 900000 }))).toEqual({ rejected: false, level: 'none', n: 3 });
    expect(checkOutlier(buildBaseline([]), row())).toEqual({ rejected: false, level: 'none', n: 0 });
  });
  it('flat BHK groups are separate and PG groups use sharing', () => {
    const pgRows = Array.from({ length: 20 }, (_, i) =>
      row({ kind: 'pg', bhk: null, areaSqft: null, pgSharing: 'double', rentInr: 8000 + (i % 5) * 100 }),
    );
    const b = buildBaseline([...cell(30, 1, 'east', 3, 60000), ...pgRows]);
    expect(checkOutlier(b, row({ bhk: 3, rentInr: 60000 })).rejected).toBe(false);
    expect(checkOutlier(b, row({ bhk: 2, rentInr: 60000 })).n).toBeLessThan(8);
    const pgCheck = checkOutlier(b, row({ kind: 'pg', bhk: null, areaSqft: null, pgSharing: 'double', rentInr: 40000 }));
    expect(pgCheck).toMatchObject({ rejected: true, level: 'locality' });
    expect(checkOutlier(b, row({ kind: 'pg', bhk: null, areaSqft: null, pgSharing: 'double', rentInr: 8200 })).rejected).toBe(false);
  });
  it('baseline ignores unusable samples', () => {
    const junk = [row({ rentInr: NaN }), row({ rentInr: -1 }), row({ areaSqft: 0 })];
    const b = buildBaseline([...junk, ...cell(10, 1, 'east')]);
    expect(checkOutlier(b, row()).n).toBe(11); // area 0 sample kept via raw-rent path
  });
  it('tight cell: MAD of zero uses the floor and does not reject small deviations', () => {
    const flat = Array.from({ length: 12 }, () => row({ rentInr: 30000 }));
    const b = buildBaseline(flat);
    expect(checkOutlier(b, row({ rentInr: 27000 })).rejected).toBe(false);
  });
  it('custom epsilon is honoured', () => {
    const b = buildBaseline(cell(30, 1, 'east'), { epsilon: 0 });
    expect(checkOutlier(b, row({ rentInr: 38000, areaSqft: 2200 })).z).toBeGreaterThan(0);
  });
});

describe('assessRow / assessBatch', () => {
  it('hard reject short-circuits outlier stage', () => {
    const b = buildBaseline(cell(30, 1, 'east'));
    const a = assessRow(row({ rentInr: 1000, areaSqft: null }), b);
    expect(a.status).toBe('rejected');
    expect(a.reasons).toEqual(['RENT_TOO_LOW']);
  });
  it('outlier reject carries the code', () => {
    const b = buildBaseline(cell(30, 1, 'east'));
    const a = assessRow(row({ rentInr: 9000 }), b);
    expect(a).toMatchObject({ status: 'rejected', reasons: ['RENT_OUTLIER_MAD'] });
  });
  it('accepted keeps warnings', () => {
    const b = buildBaseline(cell(30, 1, 'east'));
    const a = assessRow(row({ localityId: null }), b);
    expect(a.status).toBe('accepted');
    expect(a.warnings).toContain('LOCALITY_FROM_GEO');
    expect(assessRow(row(), undefined).status).toBe('accepted');
  });
  it('batch: bad batch cannot shift its own baseline; prior set anchors it', () => {
    const prior = cell(30, 1, 'east');
    const batch = [row(), ...Array.from({ length: 5 }, () => row({ rentInr: 200000, areaSqft: 3000, bhk: 2 })), row({ rentInr: 100 })];
    const out = assessBatch(batch, prior);
    expect(out[0]!.status).toBe('accepted');
    expect(out.slice(1, 6).every((o) => o.status === 'rejected')).toBe(true);
    expect(out[6]!.reasons).toContain('RENT_TOO_LOW');
  });
  it('batch: hard-rejected rows never enter the baseline', () => {
    const batch = [...cell(10, 1, 'east'), ...Array.from({ length: 50 }, () => row({ rentInr: 100 }))];
    const out = assessBatch(batch);
    expect(out.slice(0, 10).every((o) => o.status === 'accepted')).toBe(true);
  });
  it('empty batch', () => {
    expect(assessBatch([])).toEqual([]);
  });
});
