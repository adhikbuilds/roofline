import { describe, expect, it } from 'vitest';
import { parseFurnishing } from '../../src/normalize/furnishing';

describe('parseFurnishing', () => {
  const table: Array<[unknown, 'furnished' | 'semi' | 'unfurnished']> = [
    ['full', 'furnished'], ['fully', 'furnished'], ['ff', 'furnished'], ['furnished', 'furnished'],
    ['Fully Furnished', 'furnished'], ['FULLY-FURNISHED', 'furnished'],
    ['semi', 'semi'], ['sf', 'semi'], ['semi-furnished', 'semi'], ['Semi Furnished', 'semi'],
    ['un', 'unfurnished'], ['uf', 'unfurnished'], ['unfurnished', 'unfurnished'],
    ['bare', 'unfurnished'], ['none', 'unfurnished'], ['Un-Furnished', 'unfurnished'],
    ['  Semi  ', 'semi'],
  ];
  it.each(table)('%j -> %s', (raw, want) => {
    expect(parseFurnishing(raw)).toEqual({ value: want, flags: [] });
  });
  it.each(['11901', 11901, 'xyz', 'banana', '12', {}, true])('invalid %j', (raw) => {
    expect(parseFurnishing(raw)).toEqual({ value: null, flags: ['FURNISHING_INVALID'] });
  });
  it.each([null, undefined, '', '   '])('absent %j is invalid', (raw) => {
    expect(parseFurnishing(raw)).toEqual({ value: null, flags: ['FURNISHING_INVALID'] });
  });
});
