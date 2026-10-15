/**
 * Human-readable fair-rent explanations. Reads the structured `basis`, never trace text. Pure.
 * Inputs are structural so this module does not depend on the model types module.
 */
import { formatINRShort } from '../money';

export const NOT_ENOUGH_COMPS = 'Not enough comparable listings.';

export type ExplainZone =
  | 'central'
  | 'east'
  | 'south_east'
  | 'south'
  | 'west'
  | 'north'
  | 'north_east';

export interface ExplainNames {
  localityName: string;
  zone: ExplainZone;
}

export interface ExplainEstimate {
  expectedInr: number;
  confidence: 'high' | 'medium' | 'low';
  basis: {
    model: 'robust_median' | 'hedonic';
    level: string;
    n: number;
    context?: { l1MedianRentInr: number; l1N: number };
  };
}

export interface ExplainFlat {
  kind: 'flat';
  unitKind: 'rk' | 'studio' | 'bhk';
  bhk: number;
  furnishing: 'furnished' | 'semi' | 'unfurnished' | null;
  areaSqft: number | null;
}

export interface ExplainPg {
  kind: 'pg';
  sharing: 'single' | 'double' | 'triple' | 'quad' | null;
  food: boolean | null;
}

export type ExplainListing = ExplainFlat | ExplainPg;

const ZONE_LABEL: Record<ExplainZone, string> = {
  central: 'Central Bangalore',
  east: 'East Bangalore',
  south_east: 'South-East Bangalore',
  south: 'South Bangalore',
  west: 'West Bangalore',
  north: 'North Bangalore',
  north_east: 'North-East Bangalore',
};

const FURN_LABEL = {
  semi: 'semi-furnished',
  furnished: 'furnished',
  unfurnished: 'unfurnished',
} as const;

function groupIndian(n: number): string {
  const digits = String(Math.round(Math.abs(n)));
  const sign = n < 0 ? '-' : '';
  if (digits.length <= 3) return sign + digits;
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${rest},${digits.slice(-3)}`;
}

export function formatBhk(unitKind: 'rk' | 'studio' | 'bhk', bhk: number): string {
  if (unitKind === 'rk') return '1RK';
  if (unitKind === 'studio') return 'Studio';
  return `${bhk}BHK`;
}

export function formatCount(n: number, noun: 'listing' = 'listing'): string {
  return `${groupIndian(n)} ${noun}${n === 1 ? '' : 's'}`;
}

export function formatArea(sqft: number): string {
  return groupIndian(sqft);
}

/** Round |delta|*100 half away from zero. */
export function pctHalfAway(delta: number): number {
  return Math.round(Math.abs(delta) * 100 * (1 + Number.EPSILON));
}

function lead(rentInr: number, expectedInr: number, label: string): string {
  if (rentInr === expectedInr) return `At the ${label} median`;
  const dir = rentInr < expectedInr ? 'below' : 'above';
  return `${formatINRShort(Math.abs(rentInr - expectedInr))} ${dir} the ${label} median`;
}

function flatLabel(level: string, x: ExplainFlat, names: ExplainNames): string {
  const bhk = formatBhk(x.unitKind, x.bhk);
  switch (level) {
    case 'L1':
      return `${names.localityName} ${bhk}${x.furnishing ? ` ${FURN_LABEL[x.furnishing]}` : ''}`;
    case 'L2':
      return `${names.localityName} ${bhk}`;
    case 'L3':
      return `${ZONE_LABEL[names.zone]} ${bhk}`;
    default:
      return `Bangalore ${bhk}`;
  }
}

function pgLabel(level: string, x: ExplainPg, names: ExplainNames): string {
  const share = `${x.sharing ?? 'shared'}-sharing PG`;
  const food = x.food === null ? '' : x.food ? ' with food' : ' without food';
  switch (level) {
    case 'P1':
      return `${names.localityName} ${share}${food}`;
    case 'P2':
      return `${ZONE_LABEL[names.zone]} ${share}${food}`;
    default:
      return `Bangalore ${share}`;
  }
}

export function explainRobustMedian(
  e: ExplainEstimate,
  x: ExplainListing,
  rentInr: number,
  names: ExplainNames,
): string {
  const label =
    x.kind === 'pg' ? pgLabel(e.basis.level, x, names) : flatLabel(e.basis.level, x, names);
  let s = `${lead(rentInr, e.expectedInr, label)} (${formatINRShort(e.expectedInr)}, ${formatCount(e.basis.n)}).`;
  if (x.kind === 'flat' && x.areaSqft !== null) s += ` Adjusted for ${formatArea(x.areaSqft)} sq ft.`;
  return s;
}

export function explainHedonic(
  e: ExplainEstimate,
  x: ExplainFlat,
  rentInr: number,
  names: ExplainNames,
): string {
  const delta = (rentInr - e.expectedInr) / e.expectedInr;
  const pct = pctHalfAway(delta);
  const rel = pct === 0 ? 'in line with expected' : `${pct}% ${delta < 0 ? 'below' : 'above'}`;
  const area = x.areaSqft !== null ? `${formatArea(x.areaSqft)} sq ft ` : '';
  const furn = x.furnishing ? `${FURN_LABEL[x.furnishing]} ` : '';
  let s =
    `Expected ${formatINRShort(e.expectedInr)} for a ${area}${furn}${formatBhk(x.unitKind, x.bhk)}` +
    ` in ${names.localityName}; listed ${formatINRShort(rentInr)} (${rel}).`;
  const ctx = e.basis.context;
  if (x.furnishing && ctx && ctx.l1N >= 3) {
    s += ` Locality median ${formatINRShort(ctx.l1MedianRentInr)} across ${formatCount(ctx.l1N)}.`;
  }
  return s;
}

export function explain(
  e: ExplainEstimate,
  x: ExplainListing,
  rentInr: number,
  names: ExplainNames,
): string {
  if (e.confidence === 'low') return NOT_ENOUGH_COMPS;
  if (e.basis.model === 'hedonic' && x.kind === 'flat') return explainHedonic(e, x, rentInr, names);
  return explainRobustMedian(e, x, rentInr, names);
}
