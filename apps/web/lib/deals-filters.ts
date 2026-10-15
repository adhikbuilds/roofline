import { z } from 'zod';

/** Locality slugs are lowercase kebab-case. */
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60);
const bhk = z.string().regex(/^[1-6]$/).transform(Number);

export type DealFilters = { locality: string | null; bhk: number | null };
type Raw = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Bad values are ignored, not errors: the page then shows the unfiltered feed. */
export function parseDealFilters(raw: Raw): DealFilters {
  const l = slug.safeParse(first(raw.locality));
  const b = bhk.safeParse(first(raw.bhk));
  return { locality: l.success ? l.data : null, bhk: b.success ? b.data : null };
}
