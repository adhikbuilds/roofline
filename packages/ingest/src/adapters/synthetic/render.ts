import type { RawListing } from '../../adapter';
import type { Rng } from './rng';

/** Everything needed to render one source row's payload. Pure data, so price changes re-render cheaply. */
export interface RowSpec {
  sourceListingId: string;
  freeTextOnly: boolean;
  postedAt: string;
  title: string;
  prose: string;
  kind: 'flat' | 'pg';
  bhk: number;
  rentInr: number;
  rentStyle: number;
  rentTextOverride?: string;
  deposit: { months: number } | { abs: number } | null;
  maintenance: number | null;
  areaSqft: number | null;
  areaStyle: number;
  areaTextOverride?: string;
  furnishingKey: 'furnished' | 'semi' | 'unfurnished' | null;
  furnishingText?: string;
  furnishingTextOverride?: string;
  localityText: string;
  lat: number | null;
  lng: number | null;
  floor: number | null;
  totalFloors: number | null;
  facingText: string | null;
  parkingText: string | null;
  tags: string[];
  photos: { seed: string; dhash: string }[];
  pg?: { sharingText: string; foodText: string; genderText: string };
  bhkText: string;
}

/** 1,25,000 style grouping. */
export function indianGroup(n: number): string {
  const s = String(Math.round(n));
  if (s.length <= 3) return s;
  const head = s.slice(0, -3).replace(/\B(?=(\d\d)+(?!\d))/g, ',');
  return `${head},${s.slice(-3)}`;
}

export function formatRent(rent: number, style: number): string {
  switch (style) {
    case 0: return `₹${indianGroup(rent)}`;
    case 1: return String(rent);
    case 2: return rent >= 100_000 ? `${trim(rent / 100_000)}L` : `${trim(rent / 1000)}K`;
    case 3: return `${indianGroup(rent)}/-`;
    default: return `Rs. ${indianGroup(rent)}`;
  }
}
const trim = (x: number): string => String(Number(x.toFixed(2)));

export function formatArea(sqft: number, style: number): string {
  switch (style) {
    case 0: return `${indianGroup(sqft)} sq.ft`;
    case 1: return `${sqft} sqft`;
    case 2: return `${Math.round(sqft / 10.7639)} sqm`;
    case 3: return `${Math.round(sqft / 9)} sq yd`;
    default: return `${sqft} sft`;
  }
}

const FURN_TEXT: Record<'furnished' | 'semi' | 'unfurnished', string[]> = {
  furnished: ['Fully Furnished', 'Furnished', 'Full', 'FF'],
  semi: ['Semi-Furnished', 'Semi', 'SF', 'Semi Furnished'],
  unfurnished: ['Unfurnished', 'UF', 'Un-furnished', 'Bare'],
};
export const pickFurnishingText = (rng: Rng, k: 'furnished' | 'semi' | 'unfurnished'): string => rng.pick(FURN_TEXT[k]);

export const bhkLabel = (bhk: number, style: number): string =>
  bhk === 0 ? (style === 0 ? '1 RK' : 'RK') : style === 0 ? `${bhk} BHK` : style === 1 ? `${bhk}BHK` : String(bhk);

function depositText(d: RowSpec['deposit']): string | undefined {
  if (!d) return undefined;
  if ('months' in d) return d.months === 1 ? '1 month' : `${d.months} months`;
  return `₹${indianGroup(d.abs)}`;
}

/** `Key: value; Key: value.` segments, parsed back by pipeline/extract.ts. */
function kv(pairs: Array<[string, string | undefined | null]>): string {
  return pairs.filter((p): p is [string, string] => p[1] != null && p[1] !== '').map(([k, v]) => `${k}: ${v}`).join('; ');
}

export function render(spec: RowSpec): RawListing {
  const rentText = spec.rentTextOverride ?? formatRent(spec.rentInr, spec.rentStyle);
  const dep = depositText(spec.deposit);
  const maint = spec.maintenance != null ? `₹${indianGroup(spec.maintenance)}` : undefined;
  const area =
    spec.areaTextOverride ?? (spec.areaSqft != null ? formatArea(spec.areaSqft, spec.areaStyle) : undefined);
  const furn = spec.furnishingTextOverride ?? spec.furnishingText;
  const floor = spec.floor != null && spec.totalFloors != null ? `${spec.floor}/${spec.totalFloors}` : undefined;
  const out: RawListing = {
    sourceListingId: spec.sourceListingId,
    postedAt: spec.postedAt,
    title: spec.title,
  };
  if (spec.freeTextOnly) {
    out.description = `${spec.prose} ${kv([
      ['Rent', `${formatRent(spec.rentInr, 0)} per month`],
      ['Deposit', dep],
      ['Maintenance', maint],
      ['Area', area],
      ['Furnishing', furn],
      ['BHK', spec.bhkText],
      ['Locality', spec.localityText],
      ['Floor', floor],
      ['Facing', spec.facingText],
      ['Parking', spec.parkingText],
    ])}.`;
  } else {
    out.description = `${spec.prose} ${kv([['Floor', floor], ['Facing', spec.facingText], ['Parking', spec.parkingText]])}.`;
    out.rentText = rentText;
    if (dep) out.depositText = dep;
    if (maint) out.maintenanceText = maint;
    if (area) out.areaText = area;
    out.bhkText = spec.bhkText;
    if (furn) out.furnishingText = furn;
    out.localityText = spec.localityText;
    if (spec.pg) out.pg = { ...spec.pg };
  }
  if (spec.lat != null && spec.lng != null) {
    out.lat = spec.lat;
    out.lng = spec.lng;
  }
  out.tags = [...spec.tags];
  out.photos = spec.photos.map((p) => ({ seed: p.seed, dhash: p.dhash }));
  return out;
}
