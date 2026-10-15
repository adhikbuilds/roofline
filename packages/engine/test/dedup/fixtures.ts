import type { DedupRecord } from '../../src/dedup/types';

export function rec(id: string, over: Partial<DedupRecord> = {}): DedupRecord {
  return {
    id,
    sourceId: 'src-a',
    sourceListingId: `L-${id}`,
    sourcePriority: 1,
    unitKind: 'bhk',
    bhk: 2,
    rentInr: 30000,
    depositInr: null,
    maintenanceInr: null,
    areaSqft: null,
    furnishing: null,
    localityId: 1,
    geo: { lat: 12.93, lng: 77.62 },
    titleTokens: [],
    photoHashes: [],
    floor: null,
    pgSharing: null,
    pgGender: null,
    firstSeenAt: 1_000,
    lastSeenAt: 2_000,
    ...over,
  };
}

/** Point `meters` east of the base point (Bangalore lat ~12.93). */
export function eastOf(meters: number): { lat: number; lng: number } {
  const dLng = meters / (111_194.9 * Math.cos((12.93 * Math.PI) / 180));
  return { lat: 12.93, lng: 77.62 + dLng };
}
