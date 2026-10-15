import { describe, expect, it } from 'vitest';
import { formatINR, formatINRShort } from '../src/money';

describe('formatINR (full, Indian grouping)', () => {
  it.each([
    [125000, '₹1,25,000'],
    [0, '₹0'],
    [999, '₹999'],
    [1000, '₹1,000'],
    [12345, '₹12,345'],
    [100000, '₹1,00,000'],
    [10000000, '₹1,00,00,000'],
    [123456789, '₹12,34,56,789'],
  ])('%d -> %s', (n, out) => {
    expect(formatINR(n)).toBe(out);
  });

  it('rounds to whole rupees, half away from zero', () => {
    expect(formatINR(1234.4)).toBe('₹1,234');
    expect(formatINR(1234.5)).toBe('₹1,235');
    expect(formatINR(-1234.5)).toBe('-₹1,235');
  });

  it('renders negatives with a leading minus before the symbol', () => {
    expect(formatINR(-125000)).toBe('-₹1,25,000');
  });

  it('never yields negative zero', () => {
    expect(formatINR(-0.2)).toBe('₹0');
    expect(formatINR(-0)).toBe('₹0');
  });

  it('returns an em dash for null, undefined and non-finite values', () => {
    expect(formatINR(null)).toBe('—');
    expect(formatINR(undefined)).toBe('—');
    expect(formatINR(Number.NaN)).toBe('—');
    expect(formatINR(Infinity)).toBe('—');
    expect(formatINR(-Infinity)).toBe('—');
  });

  it('supports short mode through the options bag', () => {
    expect(formatINR(42000, { short: true })).toBe('₹42K');
  });
});

describe('formatINRShort (K / L / Cr)', () => {
  it.each([
    [42000, '₹42K'],
    [1000, '₹1K'],
    [42500, '₹42.5K'],
    [150000, '₹1.5L'],
    [100000, '₹1L'],
    [125000, '₹1.25L'],
    [10000000, '₹1Cr'],
    [12500000, '₹1.25Cr'],
    [250000000, '₹25Cr'],
  ])('%d -> %s', (n, out) => {
    expect(formatINRShort(n)).toBe(out);
  });

  it('shows amounts under 1000 in full rupees', () => {
    expect(formatINRShort(0)).toBe('₹0');
    expect(formatINRShort(950)).toBe('₹950');
    expect(formatINRShort(999.6)).toBe('₹1K');
  });

  it('promotes to the next unit when rounding hits the boundary', () => {
    expect(formatINRShort(99999)).toBe('₹1L');
    expect(formatINRShort(9999999)).toBe('₹1Cr');
    expect(formatINRShort(999999)).toBe('₹10L');
  });

  it('rounds K to one decimal and L/Cr to two, half away from zero', () => {
    expect(formatINRShort(42450)).toBe('₹42.5K');
    expect(formatINRShort(42440)).toBe('₹42.4K');
    expect(formatINRShort(123456)).toBe('₹1.23L');
    expect(formatINRShort(125500)).toBe('₹1.26L');
  });

  it('handles negatives', () => {
    expect(formatINRShort(-42000)).toBe('-₹42K');
    expect(formatINRShort(-150000)).toBe('-₹1.5L');
    expect(formatINRShort(-500)).toBe('-₹500');
  });

  it('returns an em dash for null, undefined and non-finite values', () => {
    expect(formatINRShort(null)).toBe('—');
    expect(formatINRShort(undefined)).toBe('—');
    expect(formatINRShort(Number.NaN)).toBe('—');
  });
});
