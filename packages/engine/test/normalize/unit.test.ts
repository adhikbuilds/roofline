import { describe, expect, it } from 'vitest';
import { parseUnitKind } from '../../src/normalize/unit';

describe('parseUnitKind', () => {
  const fieldCases: Array<[unknown, string, number]> = [
    ['1RK', 'rk', 0],
    ['1 RK', 'rk', 0],
    ['2 BHK', 'bhk', 2],
    ['3bhk+study', 'bhk', 3],
    ['3BHK', 'bhk', 3],
    ['1 BHK', 'bhk', 1],
    ['4+ BHK', 'bhk', 4],
    ['studio', 'studio', 0],
    ['Studio Apartment', 'studio', 0],
    ['pg', 'pg_bed', 0],
    ['PG bed', 'pg_bed', 0],
    ['paying guest', 'pg_bed', 0],
    ['2', 'bhk', 2],
    [3, 'bhk', 3],
  ];
  it.each(fieldCases)('field %j', (field, kind, bhk) => {
    expect(parseUnitKind(field, null)).toEqual({ value: { unitKind: kind, bhk }, flags: [] });
  });

  it('falls back to the title', () => {
    expect(parseUnitKind(null, 'Spacious 3 BHK flat for rent')).toEqual({
      value: { unitKind: 'bhk', bhk: 3 },
      flags: [],
    });
    expect(parseUnitKind('', 'Cosy 1RK near metro').value).toEqual({ unitKind: 'rk', bhk: 0 });
    expect(parseUnitKind('', '2bhk').value).toEqual({ unitKind: 'bhk', bhk: 2 });
    expect(parseUnitKind(undefined, 'Studio flat').value).toEqual({ unitKind: 'studio', bhk: 0 });
  });

  it('flags a mismatch and the field wins', () => {
    expect(parseUnitKind('2 BHK', '3 BHK in HSR')).toEqual({
      value: { unitKind: 'bhk', bhk: 2 },
      flags: ['BHK_TITLE_MISMATCH'],
    });
    expect(parseUnitKind('1RK', '2 bhk flat').flags).toEqual(['BHK_TITLE_MISMATCH']);
  });

  it('no mismatch when title agrees or has no unit', () => {
    expect(parseUnitKind('2 BHK', 'Nice 2bhk').flags).toEqual([]);
    expect(parseUnitKind('2 BHK', 'Lovely home near park').flags).toEqual([]);
  });

  it('returns null when nothing parses', () => {
    expect(parseUnitKind(null, null)).toEqual({ value: null, flags: ['UNIT_KIND_MISSING'] });
    expect(parseUnitKind('villa', 'big house')).toEqual({ value: null, flags: ['UNIT_KIND_MISSING'] });
    expect(parseUnitKind({}, 42)).toEqual({ value: null, flags: ['UNIT_KIND_MISSING'] });
  });

  it('rejects absurd bhk counts', () => {
    expect(parseUnitKind('15 BHK', null).value).toBeNull();
  });
});
