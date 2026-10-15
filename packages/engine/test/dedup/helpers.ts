import type { DedupRecord } from '../../src/dedup/types';

const EARTH_R_M = 6371008.8;

/** Point d metres from p along bearing theta (radians), spherical earth. */
export function destination(
  p: { lat: number; lng: number },
  thetaRad: number,
  dM: number,
): { lat: number; lng: number } {
  const dLat = (dM * Math.cos(thetaRad)) / EARTH_R_M;
  const dLng = (dM * Math.sin(thetaRad)) / (EARTH_R_M * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + (dLat * 180) / Math.PI, lng: p.lng + (dLng * 180) / Math.PI };
}

let n = 0;
export function rec(over: Partial<DedupRecord> = {}): DedupRecord {
  n++;
  const hex = n.toString(16).padStart(12, '0');
  return {
    id: `00000000-0000-4000-8000-${hex}`,
    sourceId: 'src-a',
    sourceListingId: `L${n}`,
    sourcePriority: 1,
    unitKind: 'bhk',
    bhk: 2,
    rentInr: 30000,
    depositInr: null,
    maintenanceInr: null,
    areaSqft: 1100,
    furnishing: 'semi',
    localityId: 1,
    geo: { lat: 12.9352, lng: 77.6245 },
    titleTokens: ['2', 'koramangala'],
    photoHashes: [0n],
    floor: null,
    pgSharing: null,
    pgGender: null,
    firstSeenAt: 0,
    lastSeenAt: 0,
    ...over,
  };
}

/** Hash at exactly h bits Hamming distance from 0n. */
export const hashAt = (h: number): bigint => (1n << BigInt(h)) - 1n;
