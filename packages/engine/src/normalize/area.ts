import { ok, type Parsed } from './types';

export const SQM_TO_SQFT = 10.7639;
export const SQYD_TO_SQFT = 9;

const AREA_RE = /^(\d+(?:\.\d+)?)\s*(.*)$/;
const SQFT_UNIT = /^(?:sq\.?\s*ft\.?|sqft|sft|square\s*(?:feet|foot)|ft2)?$/;
const SQM_UNIT = /^(?:sq\.?\s*m\.?|sqm|square\s*met(?:er|re)s?|m2)$/;
const SQYD_UNIT = /^(?:sq\.?\s*y(?:ar)?ds?\.?|sqyds?|square\s*yards?)$/;

/** Parse an area into square feet. Null with AREA_MISSING when absent, zero or unparseable. */
export function parseArea(raw: unknown): Parsed<number | null> {
  const missing = ok(null, ['AREA_MISSING']);
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? ok(raw) : missing;
  if (typeof raw !== 'string') return missing;
  const m = AREA_RE.exec(raw.normalize('NFKC').toLowerCase().replace(/,/g, '').trim());
  if (!m) return missing;
  const n = Number(m[1]);
  const unit = (m[2] ?? '').trim();
  let sqft: number;
  if (SQFT_UNIT.test(unit)) sqft = n;
  else if (SQM_UNIT.test(unit)) sqft = n * SQM_TO_SQFT;
  else if (SQYD_UNIT.test(unit)) sqft = n * SQYD_TO_SQFT;
  else return missing;
  return sqft > 0 ? ok(sqft) : missing;
}
