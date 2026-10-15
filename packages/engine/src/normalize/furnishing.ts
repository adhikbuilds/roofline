import { ok, asText, type Parsed } from './types';

export type Furnishing = 'furnished' | 'semi' | 'unfurnished';

const MAP: Record<string, Furnishing> = {
  full: 'furnished',
  fully: 'furnished',
  ff: 'furnished',
  furnished: 'furnished',
  'fully furnished': 'furnished',
  'full furnished': 'furnished',
  semi: 'semi',
  sf: 'semi',
  'semi furnished': 'semi',
  un: 'unfurnished',
  uf: 'unfurnished',
  unfurnished: 'unfurnished',
  'un furnished': 'unfurnished',
  bare: 'unfurnished',
  none: 'unfurnished',
};

/** Anything outside the accepted vocabulary (for example "11901") becomes null with FURNISHING_INVALID. */
export function parseFurnishing(raw: unknown): Parsed<Furnishing | null> {
  const t = asText(raw);
  const key = t === null ? '' : t.replace(/[-_\s]+/g, ' ').trim();
  const value = Object.hasOwn(MAP, key) ? (MAP[key] ?? null) : null;
  return value ? ok(value) : ok(null, ['FURNISHING_INVALID']);
}
