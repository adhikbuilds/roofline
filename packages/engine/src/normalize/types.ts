/** Every normalize parser returns this shape and never throws. */
export interface Parsed<T> {
  value: T;
  flags: string[];
}

export function ok<T>(value: T, flags: string[] = []): Parsed<T> {
  return { value, flags };
}

/** Lowercased, trimmed string form of a string or finite number; null for anything else. */
export function asText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim().toLowerCase();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}
