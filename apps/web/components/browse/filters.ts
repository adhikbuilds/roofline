/**
 * The /homes filter vocabulary. It matches GET /api/v1/listings/count so the landing console can link straight in:
 *   loc      locality slug                       bhk      comma list of rk | 1 | 2 | 3 | 4plus
 *   min,max  monthly rent in rupees              kind     flat | pg
 *   furn     comma list of furnished|semi|unfurnished
 *   verdict  comma list of great_deal|good_price|fair|above_market|overpriced
 *   sort     best | new | rent_up | rent_down
 * Unlike the count API, bad values are dropped silently: a stale link must still show a page.
 */
import { z } from 'zod';

export const BHK_KEYS = ['rk', '1', '2', '3', '4plus'] as const;
export type BhkKey = (typeof BHK_KEYS)[number];
export const FURNISHING_KEYS = ['furnished', 'semi', 'unfurnished'] as const;
export type FurnishingKey = (typeof FURNISHING_KEYS)[number];
export const VERDICT_KEYS = ['great_deal', 'good_price', 'fair', 'above_market', 'overpriced'] as const;
export type VerdictKey = (typeof VERDICT_KEYS)[number];
export const SORT_KEYS = ['best', 'new', 'rent_up', 'rent_down'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type HomesFilters = {
  loc: string | null;
  bhk: BhkKey[];
  min: number | null;
  max: number | null;
  kind: 'flat' | 'pg' | null;
  furn: FurnishingKey[];
  verdict: VerdictKey[];
  sort: SortKey;
};

export const DEFAULT_SORT: SortKey = 'best';
export const EMPTY_FILTERS: HomesFilters = { loc: null, bhk: [], min: null, max: null, kind: null, furn: [], verdict: [], sort: DEFAULT_SORT };

export const SORT_LABEL: Record<SortKey, string> = {
  best: 'Best value',
  new: 'Newest',
  rent_up: 'Rent: low to high',
  rent_down: 'Rent: high to low',
};

export const BHK_LABEL: Record<BhkKey, string> = { rk: '1 RK', '1': '1 BHK', '2': '2 BHK', '3': '3 BHK', '4plus': '4+ BHK' };
export const FURNISHING_LABEL: Record<FurnishingKey, string> = { furnished: 'Furnished', semi: 'Semi-furnished', unfurnished: 'Unfurnished' };

/** Budget presets: rupees per month. `max: null` is open-ended. */
export const BUDGETS = [
  { id: 'u15', label: 'Under ₹15K', min: null, max: 15000 },
  { id: '15-30', label: '₹15K to ₹30K', min: 15000, max: 30000 },
  { id: '30-60', label: '₹30K to ₹60K', min: 30000, max: 60000 },
  { id: '60p', label: '₹60K and above', min: 60000, max: null },
] as const;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60);
const rupees = z.string().regex(/^\d{1,8}$/).transform(Number);

const BHK_ALIASES: Record<string, BhkKey> = { rk: 'rk', '1': '1', '2': '2', '3': '3', '4': '4plus', '5': '4plus', '6': '4plus', '4plus': '4plus', '4+': '4plus', '4 ': '4plus' };

type Raw = URLSearchParams | Record<string, string | string[] | undefined>;

function get(raw: Raw, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

function list<T extends string>(v: string | undefined, allowed: readonly T[]): T[] {
  if (!v) return [];
  const out: T[] = [];
  for (const part of v.split(',')) {
    const p = part.trim() as T;
    if ((allowed as readonly string[]).includes(p) && !out.includes(p)) out.push(p);
  }
  return allowed.filter((a) => out.includes(a));
}

/** "4+" arrives from a URL as "4 " (the plus decodes to a space), so only trim the commas, not the value. */
function bhkList(v: string | undefined): BhkKey[] {
  if (!v) return [];
  const out = new Set<BhkKey>();
  for (const part of v.split(',')) {
    const k = BHK_ALIASES[part] ?? BHK_ALIASES[part.trim()];
    if (k) out.add(k);
  }
  return BHK_KEYS.filter((k) => out.has(k));
}

export function parseHomesFilters(raw: Raw): HomesFilters {
  const loc = slug.safeParse(get(raw, 'loc'));
  const min = rupees.safeParse(get(raw, 'min'));
  const max = rupees.safeParse(get(raw, 'max'));
  const kind = get(raw, 'kind');
  const sort = get(raw, 'sort');
  let minV = min.success ? min.data : null;
  let maxV = max.success ? max.data : null;
  if (minV != null && maxV != null && minV > maxV) [minV, maxV] = [null, null];
  return {
    loc: loc.success ? loc.data : null,
    bhk: bhkList(get(raw, 'bhk')),
    min: minV,
    max: maxV,
    kind: kind === 'flat' || kind === 'pg' ? kind : null,
    furn: list(get(raw, 'furn'), FURNISHING_KEYS),
    verdict: list(get(raw, 'verdict'), VERDICT_KEYS),
    sort: (SORT_KEYS as readonly string[]).includes(sort ?? '') ? (sort as SortKey) : DEFAULT_SORT,
  };
}

/** Canonical query string: stable order, defaults omitted. Two equal filter sets always produce the same string. */
export function filtersToQuery(f: HomesFilters): string {
  const q = new URLSearchParams();
  if (f.loc) q.set('loc', f.loc);
  if (f.bhk.length) q.set('bhk', f.bhk.join(','));
  if (f.min != null) q.set('min', String(f.min));
  if (f.max != null) q.set('max', String(f.max));
  if (f.kind) q.set('kind', f.kind);
  if (f.furn.length) q.set('furn', f.furn.join(','));
  if (f.verdict.length) q.set('verdict', f.verdict.join(','));
  if (f.sort !== DEFAULT_SORT) q.set('sort', f.sort);
  return q.toString();
}

export function homesHref(f: HomesFilters): string {
  const qs = filtersToQuery(f);
  return qs ? `/homes?${qs}` : '/homes';
}

export function toggle<T>(arr: readonly T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function activeBudget(f: Pick<HomesFilters, 'min' | 'max'>): (typeof BUDGETS)[number]['id'] | null {
  return BUDGETS.find((b) => b.min === f.min && b.max === f.max)?.id ?? null;
}

export function isFiltered(f: HomesFilters): boolean {
  return f.loc != null || f.bhk.length > 0 || f.min != null || f.max != null || f.kind != null || f.furn.length > 0 || f.verdict.length > 0;
}

export function customBudgetLabel(f: Pick<HomesFilters, 'min' | 'max'>): string | null {
  if (f.min == null && f.max == null) return null;
  const k = (n: number) => (n >= 1000 ? `₹${+(n / 1000).toFixed(1)}K` : `₹${n}`);
  if (f.min != null && f.max != null) return `${k(f.min)} to ${k(f.max)}`;
  return f.max != null ? `Under ${k(f.max)}` : `${k(f.min!)} and above`;
}

/* ---- keyset cursor ---- */

const cursorSchema = z.object({ k: z.string().min(1).max(40).regex(/^[0-9a-zA-Z:+\-. ]+$/), id: z.string().uuid() });
export type HomesCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(c: HomesCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

/** Anything that is not a well-formed cursor is null, which reads as "first page". */
export function decodeCursor(raw: string | null | undefined): HomesCursor | null {
  if (!raw || raw.length > 200) return null;
  try {
    const p = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}
