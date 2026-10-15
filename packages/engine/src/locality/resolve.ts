import { jaroWinkler } from './jaro-winkler';
import { isStopLocality, normLocality } from './norm';

export interface LocalityEntry {
  id: string;
  name: string;
  aliases: readonly string[];
}

export interface LocalityIndex {
  exact: ReadonlyMap<string, string>;
  candidates: ReadonlyArray<{ key: string; id: string }>;
}

export type ResolveMethod = 'exact' | 'fuzzy' | 'ambiguous' | 'none';
export interface LocalityResolution {
  id: string | null;
  method: ResolveMethod;
  flags: string[];
}

export interface ResolveOptions {
  /** Minimum Jaro-Winkler similarity. Default 0.92. */
  threshold?: number;
  /** Minimum lead over the best other locality. Default 0.03. */
  margin?: number;
}

/** Build the lookup structures from names and aliases. No I/O; the caller supplies the alias map. First entry wins on duplicate keys. */
export function buildLocalityIndex(entries: readonly LocalityEntry[]): LocalityIndex {
  const exact = new Map<string, string>();
  const candidates: Array<{ key: string; id: string }> = [];
  for (const e of entries) {
    for (const text of [e.name, ...e.aliases]) {
      if (isStopLocality(text)) continue;
      const key = normLocality(text);
      if (exact.has(key)) continue;
      exact.set(key, e.id);
      candidates.push({ key, id: e.id });
    }
  }
  return { exact, candidates };
}

const NONE: LocalityResolution = { id: null, method: 'none', flags: [] };

export function resolveLocality(raw: unknown, index: LocalityIndex, opts: ResolveOptions = {}): LocalityResolution {
  const threshold = opts.threshold ?? 0.92;
  const margin = opts.margin ?? 0.03;
  if (isStopLocality(raw)) return { ...NONE };
  const key = normLocality(raw);
  const hit = index.exact.get(key);
  if (hit !== undefined) return { id: hit, method: 'exact', flags: [] };

  const bestById = new Map<string, number>();
  for (const c of index.candidates) {
    const score = jaroWinkler(key, c.key);
    if (score > (bestById.get(c.id) ?? -1)) bestById.set(c.id, score);
  }
  const ranked = [...bestById.entries()].sort((x, y) => y[1] - x[1]);
  const top = ranked[0];
  if (!top || top[1] < threshold) return { ...NONE };
  const runnerUp = ranked[1]?.[1] ?? 0;
  if (top[1] - runnerUp < margin - 1e-12) return { id: null, method: 'ambiguous', flags: [] };
  return { id: top[0], method: 'fuzzy', flags: ['LOCALITY_FUZZY'] };
}
