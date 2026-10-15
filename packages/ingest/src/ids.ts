import { createHash } from 'node:crypto';

/** Deterministic v5-style UUID from a namespace and key (sha1). Same input, same id, on every machine. */
export function uuidFor(namespace: string, key: string): string {
  const h = createHash('sha1').update(`${namespace}\u0000${key}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Stable JSON: object keys sorted, so a content hash does not depend on key insertion order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export const sourceListingUuid = (sourceId: string, sourceListingId: string): string =>
  uuidFor('source_listing', `${sourceId}:${sourceListingId}`);
export const listingUuid = (sourceId: string, sourceListingId: string): string =>
  uuidFor('listing', `${sourceId}:${sourceListingId}`);
