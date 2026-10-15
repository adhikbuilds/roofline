import { ok, type Parsed } from './types';

export type UnitKind = 'rk' | 'bhk' | 'studio' | 'pg_bed';
export interface UnitInfo {
  unitKind: UnitKind;
  /** 0 for RK, studio and PG beds. */
  bhk: number;
}

const MAX_BHK = 9;

function fromText(text: string, allowBareDigit: boolean): UnitInfo | null {
  const t = text.normalize('NFKC').toLowerCase().trim();
  if (/\b1\s*rk\b|\brk\b/.test(t)) return { unitKind: 'rk', bhk: 0 };
  const b = /(\d+)\s*\+?\s*bhk/.exec(t);
  if (b) {
    const n = Number(b[1]);
    return n >= 1 && n <= MAX_BHK ? { unitKind: 'bhk', bhk: n } : null;
  }
  if (/studio/.test(t)) return { unitKind: 'studio', bhk: 0 };
  if (/\bpg\b|paying guest/.test(t)) return { unitKind: 'pg_bed', bhk: 0 };
  if (allowBareDigit && /^\d$/.test(t)) {
    const n = Number(t);
    return n >= 1 ? { unitKind: 'bhk', bhk: n } : null;
  }
  return null;
}

/** Field first, then title. A field/title disagreement adds BHK_TITLE_MISMATCH and the field wins. */
export function parseUnitKind(field: unknown, title: unknown): Parsed<UnitInfo | null> {
  const f =
    typeof field === 'string' ? fromText(field, true) : typeof field === 'number' ? fromText(String(field), true) : null;
  const t = typeof title === 'string' ? fromText(title, false) : null;
  if (f) {
    const mismatch = t !== null && (t.unitKind !== f.unitKind || t.bhk !== f.bhk);
    return ok(f, mismatch ? ['BHK_TITLE_MISMATCH'] : []);
  }
  if (t) return ok(t);
  return ok(null, ['UNIT_KIND_MISSING']);
}
