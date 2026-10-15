import { describe, expect, it } from 'vitest';
import { parseDealFilters } from '../lib/deals-filters';

describe('parseDealFilters', () => {
  it('accepts a good slug and bhk', () => {
    expect(parseDealFilters({ locality: 'koramangala', bhk: '2' })).toEqual({ locality: 'koramangala', bhk: 2 });
  });
  it('ignores bad values independently', () => {
    expect(parseDealFilters({ locality: "x' OR 1=1 --", bhk: '2' })).toEqual({ locality: null, bhk: 2 });
    expect(parseDealFilters({ locality: 'hsr-layout', bhk: 'abc' })).toEqual({ locality: 'hsr-layout', bhk: null });
  });
  it.each(['0', '-1', '7', '1.5', '', ' 2', '2e0', '99999999999'])('rejects bhk %j', (v) => {
    expect(parseDealFilters({ bhk: v }).bhk).toBeNull();
  });
  it('rejects uppercase, long and empty slugs', () => {
    expect(parseDealFilters({ locality: 'Koramangala' }).locality).toBeNull();
    expect(parseDealFilters({ locality: 'a'.repeat(80) }).locality).toBeNull();
    expect(parseDealFilters({ locality: '' }).locality).toBeNull();
  });
  it('uses the first of repeated params and tolerates undefined', () => {
    expect(parseDealFilters({ bhk: ['3', '1'] }).bhk).toBe(3);
    expect(parseDealFilters({})).toEqual({ locality: null, bhk: null });
  });
});
