import { ok, asText, type Parsed } from './types';

export type Sharing = 'single' | 'double' | 'triple' | 'quad';
export type Gender = 'male' | 'female' | 'coed';

export function parseSharing(raw: unknown): Parsed<Sharing | null> {
  const t = asText(raw);
  if (t === null) return ok(null);
  if (/quad|\b4\b|four/.test(t)) return ok('quad');
  if (/triple|\b3\b|three/.test(t)) return ok('triple');
  if (/double|twin|\b2\b|two/.test(t)) return ok('double');
  if (/single|private|\b1\b|\bone\b/.test(t)) return ok('single');
  return ok(null);
}

export function parseFood(raw: unknown): Parsed<boolean | null> {
  if (typeof raw === 'boolean') return ok(raw);
  if (typeof raw !== 'string') return ok(null);
  const t = raw.trim().toLowerCase();
  if (/\b(?:no|not|without|excluded|n)\b/.test(t)) return ok(false);
  if (/^(?:y|yes)$|includ|with food|meal|\bfood\b/.test(t)) return ok(true);
  return ok(null);
}

export function parseGender(raw: unknown): Parsed<Gender | null> {
  if (typeof raw !== 'string') return ok(null);
  const t = raw.normalize('NFKC').toLowerCase();
  if (/unisex|co[\s-]?(?:ed|living)|\bboth\b|\bany\b|\b(?:boys?|girls?|gents?|ladies)\s*(?:&|and)\s*(?:boys?|girls?|gents?|ladies)\b/.test(t)) {
    return ok('coed');
  }
  if (/\b(?:ladies|lady|girls?|female|women|woman)\b/.test(t)) return ok('female');
  if (/\b(?:gents?|boys?|male|men|man)\b/.test(t)) return ok('male');
  return ok(null);
}
