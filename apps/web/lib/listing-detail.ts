/** Pure helpers for /listing/[id]: id parsing, loop-safe redirect resolution and the price-history chart geometry. */
import { z } from 'zod';

export const MAX_REDIRECT_HOPS = 3;

const uuid = z.string().uuid();

/** Returns the lowercased uuid, or null for anything else (the route turns null into a 404). */
export function parseListingId(raw: string): string | null {
  const r = uuid.safeParse(raw);
  return r.success ? r.data.toLowerCase() : null;
}

export type Resolution = { kind: 'found'; id: string } | { kind: 'redirect'; id: string } | { kind: 'missing' };

/**
 * Resolve an id to a live listing. If it is not live, follow listing_redirects for at most
 * MAX_REDIRECT_HOPS hops, stopping on loops. Both lookups are injected so this stays DB-free.
 */
export async function resolveRedirect(
  id: string,
  nextId: (id: string) => Promise<string | null>,
  isLive: (id: string) => Promise<boolean>,
): Promise<Resolution> {
  if (await isLive(id)) return { kind: 'found', id };
  const seen = new Set([id]);
  let current = id;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const next = await nextId(current);
    if (!next || seen.has(next)) return { kind: 'missing' };
    if (await isLive(next)) return { kind: 'redirect', id: next };
    seen.add(next);
    current = next;
  }
  return { kind: 'missing' };
}

export type HistoryPoint = { at: string; rentInr: number };
export type StepChart = {
  points: Array<{ x: number; y: number; at: string; rentInr: number }>;
  path: string;
  minInr: number;
  maxInr: number;
};

const PAD = 14;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Step chart geometry: the rent holds until the next observation, then jumps (horizontal first, then vertical). */
export function buildStepChart(history: HistoryPoint[], width: number, height: number): StepChart | null {
  if (history.length === 0) return null;
  const times = history.map((h) => Date.parse(h.at));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const minInr = Math.min(...history.map((h) => h.rentInr));
  const maxInr = Math.max(...history.map((h) => h.rentInr));
  // Scale the y-axis to at least +/-15% around the midpoint so a small change reads as small
  // (a 7% cut must not fill the whole chart height).
  const mid = (minInr + maxInr) / 2;
  const half = Math.max((maxInr - minInr) / 2, mid * 0.15);
  const lo = mid - half;
  const hi = mid + half;
  const innerW = width - 2 * PAD;
  const innerH = height - 2 * PAD;
  const points = history.map((h, i) => ({
    x: r1(t1 === t0 ? (history.length === 1 ? width / 2 : PAD + (innerW * i) / (history.length - 1)) : PAD + (innerW * (times[i]! - t0)) / (t1 - t0)),
    y: r1(hi === lo ? height / 2 : PAD + innerH * (1 - (h.rentInr - lo) / (hi - lo))),
    at: h.at,
    rentInr: h.rentInr,
  }));
  const first = points[0]!;
  let path = `M${first.x} ${first.y}`;
  for (const p of points.slice(1)) path += ` H${p.x} V${p.y}`;
  return { points, path, minInr, maxInr };
}
