import { describe, expect, it } from 'vitest';
import {
  activeBudget, customBudgetLabel, decodeCursor, encodeCursor, filtersToQuery, homesHref, parseHomesFilters, toggle,
} from '@/components/browse/filters';

const q = (s: string) => parseHomesFilters(new URLSearchParams(s));

describe('parseHomesFilters', () => {
  it('returns defaults for no params', () => {
    expect(q('')).toEqual({ loc: null, bhk: [], min: null, max: null, kind: null, furn: [], verdict: [], sort: 'best' });
  });
  it('drops unknown keys and garbage values', () => {
    const f = q("bogus=1&bhk=abc,9&min=-5&max=1e3&loc=X'%20OR%201=1--&kind=castle&furn=lava&verdict=meh&sort=random");
    expect(f).toEqual({ loc: null, bhk: [], min: null, max: null, kind: null, furn: [], verdict: [], sort: 'best' });
  });
  it('parses the landing console vocabulary', () => {
    const f = q('loc=koramangala&bhk=2,3&min=15000&max=30000&kind=flat');
    expect(f).toMatchObject({ loc: 'koramangala', bhk: ['2', '3'], min: 15000, max: 30000, kind: 'flat' });
  });
  it('reads 4+ whether the plus decoded to a space or not', () => {
    expect(q('bhk=4plus').bhk).toEqual(['4plus']);
    expect(q('bhk=4+').bhk).toEqual(['4plus']);
    expect(new URLSearchParams('bhk=4+').get('bhk')).toBe('4 ');
    expect(q('bhk=4+').bhk).toEqual(['4plus']);
    expect(q('bhk=5').bhk).toEqual(['4plus']);
  });
  it('de-duplicates and orders multi values canonically', () => {
    expect(q('bhk=3,1,3,rk').bhk).toEqual(['rk', '1', '3']);
    expect(q('verdict=fair,great_deal,fair').verdict).toEqual(['great_deal', 'fair']);
  });
  it('ignores a reversed budget', () => {
    expect(q('min=50000&max=10000')).toMatchObject({ min: null, max: null });
  });
  it('accepts a plain record as well (Next searchParams)', () => {
    expect(parseHomesFilters({ bhk: ['2', '3'], sort: 'new' })).toMatchObject({ bhk: ['2'], sort: 'new' });
  });
});

describe('filtersToQuery', () => {
  it('omits defaults and is stable', () => {
    expect(filtersToQuery(q(''))).toBe('');
    expect(homesHref(q(''))).toBe('/homes');
    expect(filtersToQuery(q('sort=new&bhk=3,2&loc=hsr-layout'))).toBe('loc=hsr-layout&bhk=2%2C3&sort=new');
  });
  it('round-trips', () => {
    const f = q('loc=indiranagar&bhk=1,4plus&min=15000&max=30000&kind=pg&furn=semi&verdict=good_price,fair&sort=rent_down');
    expect(parseHomesFilters(new URLSearchParams(filtersToQuery(f)))).toEqual(f);
  });
});

describe('helpers', () => {
  it('toggle adds and removes', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('recognises budget presets and labels custom ranges', () => {
    expect(activeBudget({ min: 15000, max: 30000 })).toBe('15-30');
    expect(activeBudget({ min: 60000, max: null })).toBe('60p');
    expect(activeBudget({ min: 1, max: 2 })).toBeNull();
    expect(customBudgetLabel({ min: 12000, max: 45000 })).toBe('₹12K to ₹45K');
    expect(customBudgetLabel({ min: null, max: null })).toBeNull();
  });
});

describe('cursor', () => {
  const c = { k: '2026-10-16 10:00:00.123456+00', id: '3f2b8c1e-8a47-4d9e-9a35-0d6a2b7c9e11' };
  it('round-trips', () => expect(decodeCursor(encodeCursor(c))).toEqual(c));
  it('treats garbage as no cursor', () => {
    for (const bad of [null, undefined, '', 'not-base64!!', Buffer.from('{"k":"1"}').toString('base64url'),
      Buffer.from(JSON.stringify({ k: "1'; DROP", id: c.id })).toString('base64url'), 'x'.repeat(500)]) {
      expect(decodeCursor(bad as string)).toBeNull();
    }
  });
});
