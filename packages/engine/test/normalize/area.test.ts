import { describe, expect, it } from 'vitest';
import { parseArea } from '../../src/normalize/area';

describe('parseArea', () => {
  const ok: Array<[unknown, number]> = [
    ['1,250 sq.ft', 1250],
    ['1250 sqft', 1250],
    ['1250 Sq. Ft.', 1250],
    ['1250 square feet', 1250],
    ['1250', 1250],
    [1250, 1250],
    ['116 sqm', 116 * 10.7639],
    ['116 sq m', 116 * 10.7639],
    ['116 sq.m', 116 * 10.7639],
    ['116 square meters', 116 * 10.7639],
    ['139 sq yd', 139 * 9],
    ['139 sqyd', 139 * 9],
    ['139 sq. yards', 139 * 9],
    ['139 square yard', 139 * 9],
  ];
  it.each(ok)('parses %j', (raw, want) => {
    const r = parseArea(raw);
    expect(r.value).toBeCloseTo(want, 6);
    expect(r.flags).toEqual([]);
  });
  it('rounds nothing silently: sqm gives 1248.7', () => {
    expect(parseArea('116 sqm').value).toBeCloseTo(1248.6, 1);
  });
  it.each(['0', 0, '', '  ', 'N/A', 'abc', '0 sqft', '-100', -5, NaN, null, undefined, {}, '1.2.3 sqft'])(
    'missing %j',
    (raw) => {
      expect(parseArea(raw)).toEqual({ value: null, flags: ['AREA_MISSING'] });
    },
  );
});
