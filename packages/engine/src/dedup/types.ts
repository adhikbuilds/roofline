import type { LatLng } from '../geo';
import type { Furnishing, Sharing, Gender } from '../normalize';

export type DedupUnitKind = 'rk' | 'bhk' | 'studio' | 'pg_bed';

/** One member row (accepted AND active). Pure data; ingest builds it from source_listings. */
export interface DedupRecord {
  readonly id: string; // source_listings.id, lowercase uuid
  readonly sourceId: string;
  readonly sourceListingId: string;
  readonly sourcePriority: number; // sources.priority, lower preferred
  readonly unitKind: DedupUnitKind;
  readonly bhk: number | null;
  readonly rentInr: number;
  readonly depositInr: number | null;
  readonly maintenanceInr: number | null;
  readonly areaSqft: number | null;
  readonly furnishing: Furnishing | null;
  readonly localityId: number;
  readonly geo: LatLng | null;
  readonly titleTokens: readonly string[];
  readonly photoHashes: readonly bigint[]; // unsigned 64-bit (BigInt.asUintN(64, ...))
  readonly floor: number | null;
  readonly pgSharing: Sharing | null;
  readonly pgGender: Gender | null;
  readonly firstSeenAt: number; // epoch ms
  readonly lastSeenAt: number; // epoch ms
}
