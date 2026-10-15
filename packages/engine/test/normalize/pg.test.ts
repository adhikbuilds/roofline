import { describe, expect, it } from 'vitest';
import { parseSharing, parseFood, parseGender } from '../../src/normalize/pg';

describe('parseSharing', () => {
  it.each([
    ['single', 'single'], ['1 sharing', 'single'], ['private room', 'single'], ['Single occupancy', 'single'],
    ['2 sharing', 'double'], ['double', 'double'], ['twin', 'double'], ['Twin Sharing', 'double'],
    ['3 sharing', 'triple'], ['triple', 'triple'],
    ['4 sharing', 'quad'], ['quad', 'quad'], ['quadruple', 'quad'], ['4-sharing', 'quad'],
    [2, 'double'],
  ])('%j -> %s', (raw, want) => {
    expect(parseSharing(raw)).toEqual({ value: want, flags: [] });
  });
  it.each(['dorm', '', null, undefined, '7 sharing', {}, 9])('unknown %j', (raw) => {
    expect(parseSharing(raw)).toEqual({ value: null, flags: [] });
  });
});

describe('parseFood', () => {
  it.each([
    [true, true], [false, false], ['yes', true], ['Y', true], ['included', true], ['meals included', true],
    ['with food', true], ['3 meals', true], ['no', false], ['n', false], ['without food', false],
    ['not included', false], ['no food', false], ['excluded', false],
  ])('%j -> %s', (raw, want) => {
    expect(parseFood(raw)).toEqual({ value: want, flags: [] });
  });
  it.each([null, undefined, '', 'maybe', {}, 3])('unknown %j', (raw) => {
    expect(parseFood(raw)).toEqual({ value: null, flags: [] });
  });
});

describe('parseGender', () => {
  it.each([
    ['gents', 'male'], ['boys', 'male'], ['male', 'male'], ['Men', 'male'], ["Gents PG", 'male'],
    ['ladies', 'female'], ['girls', 'female'], ['female', 'female'], ['Women', 'female'],
    ['unisex', 'coed'], ['co-living', 'coed'], ['coed', 'coed'], ['co-ed', 'coed'], ['Boys & Girls', 'coed'],
    ['any', 'coed'],
  ])('%j -> %s', (raw, want) => {
    expect(parseGender(raw)).toEqual({ value: want, flags: [] });
  });
  it.each([null, undefined, '', 'xyz', {}, 5])('unknown %j', (raw) => {
    expect(parseGender(raw)).toEqual({ value: null, flags: [] });
  });
});
