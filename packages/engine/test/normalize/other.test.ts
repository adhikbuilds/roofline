import { describe, expect, it } from 'vitest';
import { parseTags, parseParking, parseFacing, parseFloor } from '../../src/normalize/other';

describe('parseTags', () => {
  it('detects tags in text and arrays', () => {
    expect(parseTags('Non-veg OK, corporation water, Borewell, power backup, lift, gated community').value.sort()).toEqual(
      ['borewell', 'corporation_water', 'gated', 'lift', 'non_veg_ok', 'power_backup'],
    );
    expect(parseTags(['Non Veg', 'Cauvery water', 'DG backup', 'Elevator', 'Gated']).value.sort()).toEqual(
      ['corporation_water', 'gated', 'lift', 'non_veg_ok', 'power_backup'],
    );
    expect(parseTags('bore well').value).toEqual(['borewell']);
    expect(parseTags('Vegetarian only').value).toEqual([]);
  });
  it('is empty for junk', () => {
    for (const x of [null, undefined, '', 12, {}, [1, null]]) expect(parseTags(x)).toEqual({ value: [], flags: [] });
  });
  it('dedupes', () => {
    expect(parseTags('lift, elevator, lift').value).toEqual(['lift']);
  });
});

describe('parseParking', () => {
  it.each([
    ['bike', 'bike'], ['2 wheeler', 'bike'], ['Two Wheeler', 'bike'], ['car', 'car'], ['4 wheeler', 'car'],
    ['four-wheeler', 'car'], ['both', 'both'], ['bike and car', 'both'], ['2 & 4 wheeler', 'both'],
    ['car + bike', 'both'], ['none', 'none'], ['no parking', 'none'], ['No', 'none'],
  ])('%j -> %s', (raw, want) => {
    expect(parseParking(raw)).toEqual({ value: want, flags: [] });
  });
  it.each([null, undefined, '', 'tbd', 5])('unknown %j', (raw) => {
    expect(parseParking(raw)).toEqual({ value: null, flags: [] });
  });
});

describe('parseFacing', () => {
  it.each([
    ['East', 'east'], ['north-east', 'north_east'], ['NE', 'north_east'], ['south west', 'south_west'],
    ['sw', 'south_west'], ['n', 'north'], ['West facing', 'west'], ['North West', 'north_west'], ['se', 'south_east'],
    ['S', 'south'], ['E', 'east'], ['w', 'west'], ['NW', 'north_west'],
  ])('%j -> %s', (raw, want) => {
    expect(parseFacing(raw)).toEqual({ value: want, flags: [] });
  });
  it.each([null, undefined, '', 'up', 5, 'northern lights'])('unknown %j', (raw) => {
    expect(parseFacing(raw).value).toBeNull();
  });
});

describe('parseFloor', () => {
  it.each([
    ['3rd floor of 5', 3, 5], ['3/5', 3, 5], ['Ground', 0, null], ['Ground floor out of 4', 0, 4],
    ['2', 2, null], [4, 4, null], ['5 of 12', 5, 12], ['Top floor', null, null], ['1st', 1, null],
    ['Basement', -1, null], ['G/4', 0, 4], ['2nd floor (total 6 floors)', 2, 6],
  ])('%j', (raw, floor, total) => {
    expect(parseFloor(raw)).toEqual({ value: { floor, totalFloors: total }, flags: [] });
  });
  it('rejects floor above total', () => {
    expect(parseFloor('9/5')).toEqual({ value: { floor: null, totalFloors: 5 }, flags: ['FLOOR_INVALID'] });
  });
  it.each([null, undefined, '', 'n/a', {}, -3, 200])('unknown %j', (raw) => {
    expect(parseFloor(raw).value).toEqual({ floor: null, totalFloors: null });
  });
});
