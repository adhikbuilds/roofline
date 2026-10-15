import { describe, expect, it } from 'vitest';
import { normLocality, isStopLocality, buildLocalityIndex, resolveLocality } from '../../src/locality';

describe('normLocality', () => {
  it.each([
    ['Koramangala', 'koramangala'],
    ['  Koramangala  ', 'koramangala'],
    ['HSR Layout, Bangalore', 'hsr layout'],
    ['HSR Layout, Bengaluru', 'hsr layout'],
    ['HSR Layout Bangalore', 'hsr layout'],
    ['HSR Layout - Bengaluru', 'hsr layout'],
    ['BTM Layout 2nd Stage', 'btm layout'],
    ['BTM Layout, 1st Stage', 'btm layout'],
    ['Koramangala 4th Block', 'koramangala'],
    ['Jayanagar 3rd Cross', 'jayanagar'],
    ['Indiranagar 100 Feet 1st Main', 'indiranagar 100 feet'],
    ['JP Nagar Phase 2', 'jp nagar'],
    ['JP Nagar Phase 1/2', 'jp nagar'],
    ['HSR Sector 2', 'hsr'],
    ['HSR Layout Sector 7, Bangalore', 'hsr layout'],
    ['St. Mark\'s Road', 'st mark s road'],
    ['Whitefield!!!', 'whitefield'],
    ['ＨＳＲ　Layout', 'hsr layout'],
    ['Café   Road', 'café road'],
    ['Marathahalli (Near ORR)', 'marathahalli near orr'],
    ['Electronic City Phase 1', 'electronic city'],
  ])('%j -> %j', (raw, want) => {
    expect(normLocality(raw)).toBe(want);
  });
  it.each([null, undefined, 5, {}, '', '   ', '---'])('empty for %j', (raw) => {
    expect(normLocality(raw)).toBe('');
  });
});

describe('isStopLocality / stop-list', () => {
  it.each([
    'From', 'from', 'Bangalore', 'Bengaluru', 'Near', 'near metro', 'Near Metro', 'Prime Location', 'N/A', 'n/a', 'NA',
    '-', 'Other', 'India', 'Karnataka', '', '   ', null, undefined, 'Bangalore, Karnataka', 'Phase 1',
  ])('stops %j', (raw) => {
    expect(isStopLocality(raw)).toBe(true);
  });
  it.each(['Indiranagar', 'Near Indiranagar Metro', 'Bangalore East', 'Fromm'])('keeps %j', (raw) => {
    expect(isStopLocality(raw)).toBe(false);
  });
});

const index = buildLocalityIndex([
  { id: 'koramangala', name: 'Koramangala', aliases: ['Kormangala', 'Koramangala 4th Block', 'KRM'] },
  { id: 'hsr', name: 'HSR Layout', aliases: ['HSR'] },
  { id: 'btm', name: 'BTM Layout', aliases: ['BTM'] },
  { id: 'whitefield', name: 'Whitefield', aliases: [] },
  { id: 'jayanagar', name: 'Jayanagar', aliases: [] },
  { id: 'jpnagar', name: 'JP Nagar', aliases: [] },
]);

describe('resolveLocality', () => {
  it.each(['From', 'Bangalore', 'Bengaluru', 'Near', '', null, undefined, 'n/a', 'Other'])(
    'stop text %j yields null with no flags',
    (raw) => {
      expect(resolveLocality(raw, index)).toEqual({ id: null, method: 'none', flags: [] });
    },
  );

  it('resolves exact name', () => {
    expect(resolveLocality('Whitefield, Bangalore', index)).toEqual({ id: 'whitefield', method: 'exact', flags: [] });
  });
  it('resolves exact alias (case/punctuation insensitive)', () => {
    expect(resolveLocality('KRM', index)).toEqual({ id: 'koramangala', method: 'exact', flags: [] });
    expect(resolveLocality('hsr', index)).toEqual({ id: 'hsr', method: 'exact', flags: [] });
    expect(resolveLocality('HSR Layout Sector 2', index)).toEqual({ id: 'hsr', method: 'exact', flags: [] });
  });
  it('fuzzy matches a typo and flags it', () => {
    expect(resolveLocality('Whitefeld', index)).toEqual({ id: 'whitefield', method: 'fuzzy', flags: ['LOCALITY_FUZZY'] });
    expect(resolveLocality('Jayanagr', index)).toEqual({ id: 'jayanagar', method: 'fuzzy', flags: ['LOCALITY_FUZZY'] });
  });
  it('rejects below-threshold text', () => {
    expect(resolveLocality('Hebbal', index)).toEqual({ id: null, method: 'none', flags: [] });
  });
  it('is ambiguous when runner-up (different locality) is within margin', () => {
    const idx = buildLocalityIndex([
      { id: 'a', name: 'Rajajinagar', aliases: [] },
      { id: 'b', name: 'Rajajinagara', aliases: [] },
    ]);
    const r = resolveLocality('Rajajinagarr', idx);
    expect(r.id).toBeNull();
    expect(r.method).toBe('ambiguous');
    expect(r.flags).toEqual([]);
  });
  it('a same-locality alias is not a runner-up', () => {
    const idx = buildLocalityIndex([{ id: 'a', name: 'Rajajinagar', aliases: ['Rajajinagara'] }]);
    expect(resolveLocality('Rajajinagarr', idx)).toEqual({ id: 'a', method: 'fuzzy', flags: ['LOCALITY_FUZZY'] });
  });
  it('honours custom threshold and margin', () => {
    expect(resolveLocality('Whitefeld', index, { threshold: 0.999 }).id).toBeNull();
    const idx = buildLocalityIndex([
      { id: 'a', name: 'Rajajinagar', aliases: [] },
      { id: 'b', name: 'Rajajinagara', aliases: [] },
    ]);
    expect(resolveLocality('Rajajinagarr', idx, { margin: 0 }).id).not.toBeNull();
  });
  it('empty index resolves nothing', () => {
    expect(resolveLocality('Whitefield', buildLocalityIndex([]))).toEqual({ id: null, method: 'none', flags: [] });
  });
  it('ignores alias entries that normalise to stop words or empty', () => {
    const idx = buildLocalityIndex([{ id: 'x', name: 'Xville', aliases: ['Bangalore', '', '-'] }]);
    expect(resolveLocality('Bangalore', idx).id).toBeNull();
    expect(resolveLocality('Xville', idx).id).toBe('x');
  });
  it('first locality wins on duplicate keys', () => {
    const idx = buildLocalityIndex([
      { id: 'first', name: 'Dup', aliases: [] },
      { id: 'second', name: 'Dup', aliases: [] },
    ]);
    expect(resolveLocality('dup', idx).id).toBe('first');
  });
  it('handles large indexes quickly', () => {
    const entries = Array.from({ length: 2000 }, (_, i) => ({ id: `id${i}`, name: `Place${i}x`, aliases: [] }));
    const big = buildLocalityIndex(entries);
    expect(resolveLocality('Place77x', big).id).toBe('id77');
  });
});
