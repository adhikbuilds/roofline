import { ok, type Parsed } from './types';

const MULTIPLIER: Record<string, number> = {
  k: 1_000,
  l: 100_000,
  lac: 100_000,
  lacs: 100_000,
  lakh: 100_000,
  lakhs: 100_000,
  cr: 10_000_000,
  crore: 10_000_000,
  crores: 10_000_000,
};

const MONEY_RE = /^(\d+(?:\.\d+)?)\s*(k|l|lacs?|lakhs?|cr|crores?)?$/;
const MONTHS_RE = /^(\d+(?:\.\d+)?)\s*(?:months?|mths?|mos?|m)(?:\s+rent)?$/;
const UNPARSEABLE = 'MONEY_UNPARSEABLE';

/** Parse a rupee amount such as "₹42K", "1,25,000", "42000/-", "1.5 Lac". Null when unparseable or not positive. */
export function parseMoney(raw: unknown): Parsed<number | null> {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? ok(raw) : ok(null, [UNPARSEABLE]);
  }
  if (typeof raw !== 'string') return ok(null, [UNPARSEABLE]);
  const cleaned = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/₹|\brs\.?|\binr\b/g, ' ')
    .replace(/\/-/g, ' ')
    .replace(/\/?\s*(?:per\s+month|a\s+month|month|mo)\b/g, ' ')
    .replace(/\bpm\b/g, ' ')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = MONEY_RE.exec(cleaned);
  if (!m) return ok(null, [UNPARSEABLE]);
  const value = Number(m[1]) * (m[2] ? (MULTIPLIER[m[2]] ?? 1) : 1);
  return value > 0 && Number.isFinite(value) ? ok(value) : ok(null, [UNPARSEABLE]);
}

export function parseRent(raw: unknown): Parsed<number | null> {
  const r = parseMoney(raw);
  return r.value === null ? ok(null, ['RENT_MISSING']) : r;
}

/** Deposit as rupees or as months of rent ("2 months"). Months need a known rent. */
export function parseDeposit(raw: unknown, rent?: number | null): Parsed<number | null> {
  const missing = ok(null, ['DEPOSIT_MISSING']);
  if (typeof raw === 'string') {
    const months = MONTHS_RE.exec(raw.normalize('NFKC').trim().toLowerCase());
    if (months) {
      const n = Number(months[1]);
      if (rent == null || !(rent > 0) || !(n > 0)) return missing;
      return ok(n * rent);
    }
  }
  const r = parseMoney(raw);
  return r.value === null ? missing : r;
}

export interface RepairContext {
  band: { p10: number; p90: number } | null;
  median: number | null;
}

const inBand = (v: number, band: { p10: number; p90: number }) => v >= band.p10 && v <= band.p90;

/** Repair thousands-unit and annual-rent mistakes using the locality x BHK band. Repairs are warnings. */
export function repairRent(rent: number | null, ctx: RepairContext | null): Parsed<number | null> {
  if (rent === null || !ctx || !ctx.band) return ok(rent);
  if (rent < 200 && inBand(rent * 1000, ctx.band)) return ok(rent * 1000, ['RENT_UNIT_REPAIRED']);
  if (ctx.median !== null && rent > 12 * ctx.median && inBand(rent / 12, ctx.band)) {
    return ok(rent / 12, ['RENT_ANNUAL_REPAIRED']);
  }
  return ok(rent);
}
