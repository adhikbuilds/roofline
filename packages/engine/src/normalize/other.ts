import { ok, asText, type Parsed } from './types';

export type Tag = 'non_veg_ok' | 'corporation_water' | 'borewell' | 'power_backup' | 'lift' | 'gated';
export type Parking = 'bike' | 'car' | 'both' | 'none';
export type Facing =
  | 'north' | 'south' | 'east' | 'west'
  | 'north_east' | 'north_west' | 'south_east' | 'south_west';

const TAG_PATTERNS: Array<[Tag, RegExp]> = [
  ['non_veg_ok', /non[\s-]?veg/],
  ['corporation_water', /corporation|cauvery|bwssb/],
  ['borewell', /bore[\s-]?well/],
  ['power_backup', /power\s*backup|dg\s*backup|generator|inverter|\bdg\b/],
  ['lift', /\blift\b|elevator/],
  ['gated', /gated/],
];

export function parseTags(raw: unknown): Parsed<Tag[]> {
  const parts = Array.isArray(raw) ? raw : [raw];
  const text = parts.filter((p): p is string => typeof p === 'string').join(', ').toLowerCase();
  return ok(TAG_PATTERNS.filter(([, re]) => re.test(text)).map(([tag]) => tag));
}

export function parseParking(raw: unknown): Parsed<Parking | null> {
  if (typeof raw !== 'string') return ok(null);
  const t = raw.toLowerCase().trim();
  if (/\bno\b|\bnone\b|\bnil\b/.test(t)) return ok('none');
  const bike = /bike|scooter|\b2\b|\btwo\b/.test(t);
  const car = /\bcar\b|\b4\b|\bfour\b/.test(t);
  if (/\bboth\b/.test(t) || (bike && car)) return ok('both');
  if (bike) return ok('bike');
  if (car) return ok('car');
  return ok(null);
}

const FACING: Record<string, Facing> = {
  n: 'north', s: 'south', e: 'east', w: 'west',
  north: 'north', south: 'south', east: 'east', west: 'west',
  ne: 'north_east', nw: 'north_west', se: 'south_east', sw: 'south_west',
  'north east': 'north_east', 'north west': 'north_west',
  'south east': 'south_east', 'south west': 'south_west',
};

export function parseFacing(raw: unknown): Parsed<Facing | null> {
  if (typeof raw !== 'string') return ok(null);
  const key = raw.toLowerCase().replace(/facing/g, ' ').replace(/[-_\s]+/g, ' ').trim();
  return ok(Object.hasOwn(FACING, key) ? (FACING[key] ?? null) : null);
}

export interface FloorInfo {
  floor: number | null;
  totalFloors: number | null;
}

const MAX_FLOOR = 150;
const validFloor = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_FLOOR;

/** Floor 0 is ground, -1 is basement. A floor above the total is dropped with FLOOR_INVALID. */
export function parseFloor(raw: unknown): Parsed<FloorInfo> {
  const empty: FloorInfo = { floor: null, totalFloors: null };
  if (typeof raw === 'number') return ok(validFloor(raw) ? { floor: raw, totalFloors: null } : empty);
  const t = asText(raw);
  if (t === null || t === '') return ok(empty);

  const tot = /(?:\/|\bof\b|\btotal\b)\s*(\d+)/.exec(t);
  const before = tot ? t.slice(0, tot.index) : t;
  let totalFloors: number | null = tot ? Number(tot[1]) : null;
  if (totalFloors !== null && !(totalFloors >= 1 && totalFloors <= MAX_FLOOR)) totalFloors = null;

  let floor: number | null = null;
  const digits = /(\d+)/.exec(before);
  if (/\bbasement\b/.test(before)) floor = -1;
  else if (/\bground\b|(?:^|\s)g(?:\s|$)/.test(before)) floor = 0;
  else if (digits) floor = Number(digits[1]);
  if (floor !== null && floor > MAX_FLOOR) floor = null;

  if (floor !== null && totalFloors !== null && floor > totalFloors) {
    return ok({ floor: null, totalFloors }, ['FLOOR_INVALID']);
  }
  return ok({ floor, totalFloors });
}
