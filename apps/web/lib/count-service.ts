import { countListings, type CountFilters } from './queries';
import { createLimiter } from './rate-limit';

/** The search console debounces at 200ms, so 120 a minute is far above a real visitor's pace. */
let limiter = createLimiter(120, 60_000);

/** Counts move only when ingest runs, so identical filters share one result for a minute (per instance, bounded). */
const CACHE_MS = 60_000;
const CACHE_MAX = 2_000;
const cache = new Map<string, { n: number; at: number }>();

export function takeCountBudget(key: string) {
  return limiter.take(key);
}

export async function cachedCount(f: CountFilters): Promise<number | null> {
  const key = JSON.stringify([f.locality ?? null, f.bhk ?? null, f.bhkOrMore ?? false, f.minRent ?? null, f.maxRent ?? null, f.kind ?? null]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.n;
  const n = await countListings(f);
  if (n !== null) {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, { n, at: Date.now() });
  }
  return n;
}

/** Tests only: forget cached counts and spent budgets. */
export function resetCountState(limit = 120) {
  cache.clear();
  limiter = createLimiter(limit, 60_000);
}
