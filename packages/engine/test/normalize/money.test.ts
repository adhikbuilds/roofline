import { describe, expect, it } from 'vitest';
import { parseMoney, parseRent, parseDeposit, repairRent } from '../../src/normalize/money';

describe('parseMoney / parseRent', () => {
  const ok: Array<[unknown, number]> = [
    ['₹42K', 42000],
    ['42,000', 42000],
    ['42000/-', 42000],
    ['1.2L', 120000],
    ['1.5 Lac', 150000],
    ['1.5 lakhs', 150000],
    ['1,25,000', 125000],
    ['45K', 45000],
    ['45k', 45000],
    ['₹1', 1],
    ['Rs. 18,500 per month', 18500],
    ['INR 30000', 30000],
    ['25000 pm', 25000],
    ['1 Cr', 10000000],
    ['  ₹ 9,999/- ', 9999],
    [42000, 42000],
    [0.5, 0.5],
  ];
  it.each(ok)('parses %j -> %d', (raw, value) => {
    expect(parseMoney(raw)).toEqual({ value, flags: [] });
    expect(parseRent(raw).value).toBe(value);
  });

  const nulls: unknown[] = ['N/A', 'n/a', '', '   ', 'Negotiable', 'abc', '₹', 'K', '0', 0, -5, '-12000',
    NaN, Infinity, null, undefined, {}, [], true, '1.2.3', '12 34 56'];
  it.each(nulls)('returns null for %j', (raw) => {
    const r = parseMoney(raw);
    expect(r.value).toBeNull();
    expect(r.flags).toEqual(['MONEY_UNPARSEABLE']);
  });

  it('rent missing flag', () => {
    expect(parseRent('N/A')).toEqual({ value: null, flags: ['RENT_MISSING'] });
  });
});

describe('parseDeposit', () => {
  it('parses rupee amounts', () => {
    expect(parseDeposit('1,00,000', 25000)).toEqual({ value: 100000, flags: [] });
    expect(parseDeposit('2L')).toEqual({ value: 200000, flags: [] });
  });
  it.each([
    ['2 months', 25000, 50000],
    ['3 Month rent', 20000, 60000],
    ['1 month', 30000, 30000],
    ['2.5 months', 20000, 50000],
    ['10 mths', 10000, 100000],
    ['2m', 10000, 20000],
  ])('months %s', (raw, rent, want) => {
    expect(parseDeposit(raw, rent)).toEqual({ value: want, flags: [] });
  });
  it('months without rent is missing', () => {
    expect(parseDeposit('2 months', null)).toEqual({ value: null, flags: ['DEPOSIT_MISSING'] });
    expect(parseDeposit('2 months')).toEqual({ value: null, flags: ['DEPOSIT_MISSING'] });
  });
  it.each(['N/A', '', 'None', 'nil', 'zero', 'Negotiable', null, undefined, '0'])('missing %j', (raw) => {
    expect(parseDeposit(raw as unknown, 20000)).toEqual({ value: null, flags: ['DEPOSIT_MISSING'] });
  });
});

describe('repairRent', () => {
  const band = { p10: 30000, p90: 60000 };
  it('repairs a thousands-unit rent', () => {
    expect(repairRent(42, { band, median: 45000 })).toEqual({ value: 42000, flags: ['RENT_UNIT_REPAIRED'] });
  });
  it('does not repair when x1000 falls outside band', () => {
    expect(repairRent(5, { band, median: 45000 })).toEqual({ value: 5, flags: [] });
  });
  it('does not repair at 200 or above', () => {
    expect(repairRent(200, { band: { p10: 100, p90: 300000 }, median: 45000 })).toEqual({ value: 200, flags: [] });
  });
  it('repairs an annual rent', () => {
    expect(repairRent(600000, { band, median: 45000 })).toEqual({ value: 50000, flags: ['RENT_ANNUAL_REPAIRED'] });
  });
  it('does not repair annual when /12 is outside band', () => {
    expect(repairRent(900000, { band, median: 45000 })).toEqual({ value: 900000, flags: [] });
  });
  it('requires strictly more than 12x median', () => {
    expect(repairRent(540000, { band, median: 45000 })).toEqual({ value: 540000, flags: [] });
    expect(repairRent(540001, { band, median: 45000 }).flags).toEqual(['RENT_ANNUAL_REPAIRED']);
  });
  it('passes through null and missing context', () => {
    expect(repairRent(null, { band, median: 1 })).toEqual({ value: null, flags: [] });
    expect(repairRent(42, null)).toEqual({ value: 42, flags: [] });
    expect(repairRent(42, { band: null, median: null })).toEqual({ value: 42, flags: [] });
    expect(repairRent(540000, { band, median: null })).toEqual({ value: 540000, flags: [] });
  });
  it('leaves normal rents alone', () => {
    expect(repairRent(45000, { band, median: 45000 })).toEqual({ value: 45000, flags: [] });
  });
});
