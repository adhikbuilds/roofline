import { z } from 'zod';
import type { CountFilters } from './queries';

const rent = z.string().regex(/^\d{1,8}$/, 'whole rupees').transform(Number);

/**
 * Query params for GET /api/v1/listings/count (and the same filter vocabulary as /homes):
 *  loc  locality slug          bhk  rk | 1..6 | 4plus (also "4+")
 *  min / max  monthly rent in rupees      kind  flat | pg
 * Absent params mean "no filter". Anything malformed is a 400, never silently ignored.
 */
const schema = z
  .object({
    loc: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60).optional(),
    bhk: z.string().regex(/^(rk|[1-6]|[1-6]plus|[1-6]\+|[1-6] )$/).optional(),
    min: rent.optional(),
    max: rent.optional(),
    kind: z.enum(['flat', 'pg']).optional(),
  })
  .refine((v) => v.min == null || v.max == null || v.min <= v.max, { message: 'min must not exceed max', path: ['min'] });

export type CountParseResult = { ok: true; filters: CountFilters } | { ok: false; error: string };

export function parseCountParams(sp: URLSearchParams): CountParseResult {
  const raw: Record<string, string> = {};
  for (const k of ['loc', 'bhk', 'min', 'max', 'kind']) {
    const v = sp.get(k);
    // "?bhk=" is the same as not sending it; a form with an empty field should not 400.
    if (v !== null && v !== '') raw[k] = v;
  }
  const p = schema.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    return { ok: false, error: `${i?.path.join('.') || 'query'}: ${i?.message ?? 'invalid'}` };
  }
  const v = p.data;
  let bhk: CountFilters['bhk'] = null;
  let bhkOrMore = false;
  if (v.bhk === 'rk') bhk = 'rk';
  else if (v.bhk) {
    bhk = Number(v.bhk[0]);
    bhkOrMore = v.bhk.length > 1; // "4plus", "4+" and "4 " (a "+" decoded from a URL) all mean 4 or more
  }
  return {
    ok: true,
    filters: { locality: v.loc ?? null, bhk, bhkOrMore, minRent: v.min ?? null, maxRent: v.max ?? null, kind: v.kind ?? null },
  };
}
