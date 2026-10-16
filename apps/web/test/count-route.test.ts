import { beforeEach, describe, expect, it, vi } from 'vitest';

const countListings = vi.fn();
vi.mock('../lib/queries', () => ({ countListings: (f: unknown) => countListings(f) }));

import { GET } from '../app/api/v1/listings/count/route';
import { parseCountParams } from '../lib/count-params';
import { resetCountState } from '../lib/count-service';

const call = (qs: string, ip = '10.0.0.1') =>
  GET(new Request(`http://x.test/api/v1/listings/count${qs}`, { headers: { 'x-real-ip': ip } }));

beforeEach(() => {
  countListings.mockReset();
  resetCountState();
});

describe('GET /api/v1/listings/count', () => {
  it('returns the count with no filters', async () => {
    countListings.mockResolvedValue(5202);
    const r = await call('');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ count: 5202 });
    expect(countListings).toHaveBeenCalledWith({ locality: null, bhk: null, bhkOrMore: false, minRent: null, maxRent: null, kind: null });
  });
  it('passes validated filters through', async () => {
    countListings.mockResolvedValue(7);
    await call('?loc=indiranagar&bhk=2&min=10000&max=40000&kind=flat');
    expect(countListings).toHaveBeenCalledWith({ locality: 'indiranagar', bhk: 2, bhkOrMore: false, minRent: 10000, maxRent: 40000, kind: 'flat' });
  });
  it('treats 4+ (plain or url-decoded) as 4 or more, and rk as rk', () => {
    for (const v of ['4plus', '4+', '4 ']) {
      const p = parseCountParams(new URLSearchParams({ bhk: v }));
      expect(p).toMatchObject({ ok: true, filters: { bhk: 4, bhkOrMore: true } });
    }
    expect(parseCountParams(new URLSearchParams({ bhk: 'rk' }))).toMatchObject({ ok: true, filters: { bhk: 'rk' } });
  });
  it('ignores empty params', async () => {
    countListings.mockResolvedValue(1);
    expect((await call('?loc=&bhk=&min=')).status).toBe(200);
  });
  it.each([
    ['?loc=Indiranagar'],
    ['?loc=a%27%3B%20DROP%20TABLE%20listings'],
    ['?bhk=9'],
    ['?bhk=two'],
    ['?min=-5'],
    ['?min=1.5'],
    ['?max=abc'],
    ['?min=999999999'],
    ['?kind=villa'],
    ['?min=50000&max=1000'],
  ])('rejects %s with 400 and never queries', async (qs) => {
    const r = await call(qs);
    expect(r.status).toBe(400);
    expect(typeof (await r.json()).error).toBe('string');
    expect(countListings).not.toHaveBeenCalled();
  });
  it('503s when the database cannot be read, instead of reporting zero', async () => {
    countListings.mockResolvedValue(null);
    expect((await call('')).status).toBe(503);
  });
  it('caches identical filters for a minute', async () => {
    countListings.mockResolvedValue(42);
    await call('?bhk=2');
    await call('?bhk=2');
    expect(countListings).toHaveBeenCalledTimes(1);
  });
  it('rate limits one client without affecting another', async () => {
    resetCountState(2);
    countListings.mockResolvedValue(1);
    expect((await call('', '1.1.1.1')).status).toBe(200);
    expect((await call('', '1.1.1.1')).status).toBe(200);
    const limited = await call('', '1.1.1.1');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await call('', '2.2.2.2')).status).toBe(200);
  });
});
