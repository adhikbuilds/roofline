/**
 * Pure helpers for the landing page: search-console params, the SVG map projection, sparkline paths and the
 * "Try it" wording. No I/O. The numbers they place come from the database; nothing here estimates a rent.
 */
import { badgeFor, deltaOf, formatINR } from '@roofline/engine';
import type { BadgeName } from './fairness';

// ---- search console -------------------------------------------------------------------------------------------------

export const BUDGET_MIN = 5000;
export const BUDGET_MAX = 150000;

export const BHK_SEGMENTS = [
  { value: 'any', label: 'Any' },
  { value: 'rk', label: '1RK' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4plus', label: '4+' },
] as const;
export type BhkSegment = (typeof BHK_SEGMENTS)[number]['value'];

export type ConsoleState = { loc: string | null; bhk: BhkSegment; budget: [number, number] };

/**
 * Query string shared by /api/v1/listings/count and /homes. A slider thumb resting on its end stop means "no limit",
 * so that bound is left out (otherwise listings beyond the stop would silently drop out of the count).
 */
export function consoleParams(s: ConsoleState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.loc) p.set('loc', s.loc);
  if (s.bhk !== 'any') p.set('bhk', s.bhk);
  if (s.budget[0] > BUDGET_MIN) p.set('min', String(s.budget[0]));
  if (s.budget[1] < BUDGET_MAX) p.set('max', String(s.budget[1]));
  return p;
}

export const homesHref = (s: ConsoleState) => {
  const q = consoleParams(s).toString();
  return q ? `/homes?${q}` : '/homes';
};

export function budgetLabel(v: number): string {
  const short = (n: number) => formatINR(n, { short: true });
  return v >= BUDGET_MAX ? `${short(BUDGET_MAX)}+` : short(v);
}

// ---- map ------------------------------------------------------------------------------------------------------------

export type MapPoint = { slug: string; name: string; lat: number; lng: number; listings: number; median2bhkRent: number | null };
export type ProjectedPoint = MapPoint & { x: number; y: number; r: number };

/**
 * Equirectangular projection with a cos(latitude) correction on longitude, fitted into a width x height box with
 * padding. Returns the dots (radius grows with the square root of listings, so area tracks count) and the outline path.
 */
export function projectMap(
  points: MapPoint[],
  outline: Array<[number, number]>,
  width: number,
  height: number,
  pad = 28,
): { dots: ProjectedPoint[]; outlinePath: string } {
  const all: Array<[number, number]> = [...outline, ...points.map((p): [number, number] => [p.lng, p.lat])];
  if (all.length === 0) return { dots: [], outlinePath: '' };
  const lat0 = all.reduce((s, p) => s + p[1], 0) / all.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p[0] * k);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((width - 2 * pad) / (maxX - minX || 1), (height - 2 * pad) / (maxY - minY || 1));
  const offX = (width - (maxX - minX) * scale) / 2;
  const offY = (height - (maxY - minY) * scale) / 2;
  const px = (lng: number) => round1(offX + (lng * k - minX) * scale);
  const py = (lat: number) => round1(offY + (maxY - lat) * scale);
  const maxL = Math.max(1, ...points.map((p) => p.listings));
  const dots = points.map((p) => ({ ...p, x: px(p.lng), y: py(p.lat), r: round1(3.5 + 8.5 * Math.sqrt(p.listings / maxL)) }));
  const outlinePath = outline.length ? `M${outline.map((p) => `${px(p[0])} ${py(p[1])}`).join('L')}Z` : '';
  return { dots, outlinePath };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- sparkline ------------------------------------------------------------------------------------------------------

export type Spark = { line: string; area: string; last: [number, number] | null; changePct: number | null };

/** Scales the series to its own range, at least 10% of the mean wide (no axis is drawn). Gaps (null) are skipped. */
export function sparkPaths(weeks: Array<number | null>, width: number, height: number, pad = 3): Spark {
  const pts = weeks.flatMap((v, i) => (v == null ? [] : [{ i, v }]));
  if (pts.length < 2) return { line: '', area: '', last: null, changePct: null };
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  // A floor on the span (10% of the mean) keeps a 1% wobble from being drawn as a cliff.
  const mean = pts.reduce((a, p) => a + p.v, 0) / pts.length;
  const span = Math.max(hi - lo, mean * 0.1);
  const mid = (hi + lo) / 2;
  const x = (i: number) => round1(pad + (i / Math.max(1, weeks.length - 1)) * (width - 2 * pad));
  const y = (v: number) => round1(pad + (0.5 - (v - mid) / span) * (height - 2 * pad));
  const coords = pts.map((p) => [x(p.i), y(p.v)] as const);
  const line = `M${coords.map((c) => `${c[0]} ${c[1]}`).join('L')}`;
  const last = coords[coords.length - 1]!;
  const area = `${line}L${last[0]} ${height}L${coords[0]![0]} ${height}Z`;
  const first = pts[0]!.v;
  return { line, area, last: [last[0], last[1]], changePct: first > 0 ? ((pts[pts.length - 1]!.v - first) / first) * 100 : null };
}

// ---- "Is this rent fair? Try it" ------------------------------------------------------------------------------------

export type TryItVerdict = { badge: BadgeName | null; deltaPct: number; sentence: string };

/**
 * Presentation only: re-bins the dragged rent against the STORED fair estimate with the engine's own badge edges.
 * It is not a fair-rent model; the estimate and interval were computed at ingest.
 */
export function tryItVerdict(
  rentInr: number,
  fairInr: number,
  confidence: 'high' | 'medium' | 'low',
  where: string,
): TryItVerdict {
  const delta = deltaOf(rentInr, fairInr);
  const diff = rentInr - fairInr;
  const sentence =
    diff === 0
      ? `Exactly the fair rent for ${where}.`
      : `${formatINR(Math.abs(diff))} ${diff < 0 ? 'below' : 'above'} the fair rent for ${where}.`;
  return { badge: badgeFor(delta, confidence), deltaPct: Math.round(delta * 100), sentence };
}
