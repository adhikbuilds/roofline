import type { LocalityIndex } from '@roofline/engine';
import type { RawListing } from '../adapter';
import type { DedupStats } from './dedup';

export interface LocalityInfo {
  id: number;
  slug: string;
  name: string;
  zone: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export interface RefData {
  localities: LocalityInfo[];
  byId: Map<number, LocalityInfo>;
  index: LocalityIndex;
}

export type LocalityMethod = 'exact' | 'fuzzy' | 'geo' | 'conflict_geo' | 'conflict_text' | 'unresolved';

/** One raw row moving through stages 2-4. Stage 2 fills the parsed fields, 3 the locality, 4 the verdict. */
export interface Draft {
  runId: number;
  sourceId: string;
  isSynthetic: boolean;
  asOf: Date;
  raw: RawListing;
  sourceListingId: string;
  firstSeen: boolean;

  // stage 2: normalize
  unitKind: 'rk' | 'bhk' | 'studio' | 'pg_bed' | null;
  bhk: number | null;
  kind: 'flat' | 'pg';
  rentParsed: number | null;
  depositText: string | undefined;
  maintenanceInr: number | null;
  areaSqft: number | null;
  furnishing: 'furnished' | 'semi' | 'unfurnished' | null;
  pgSharing: string | null;
  pgFood: boolean | null;
  pgGender: string | null;
  parking: string | null;
  facing: string | null;
  floor: number | null;
  totalFloors: number | null;
  tags: string[];
  title: string | null;
  titleTokens: string[];
  description: string | null;
  photoHashes: string[];
  photoSeeds: string[];
  postedAt: string | null;
  lat: number | null;
  lng: number | null;
  geoValid: boolean;
  extractedBy: 'rules' | null;
  localityText: string;
  flags: Set<string>;

  // stage 3: locality
  localityId: number | null;
  localityMethod: LocalityMethod;
  localityFromGeo: boolean;

  // stage 4: repair + quality
  rentInr: number | null;
  depositInr: number | null;
  status: 'accepted' | 'rejected';
  reasons: string[];
  warnings: string[];
}

export interface RunStats {
  fetched: number;
  unchanged: number;
  raw_stored: number;
  processed: number;
  accepted: number;
  rejected: number;
  reasons: Record<string, number>;
  warnings: Record<string, number>;
  locality: Record<string, number>;
  repaired: { unit: number; annual: number };
  extracted_by_rules: number;
  delisted: number;
  listings_upserted: number;
  price_observations: number;
  batch_size: number;
  /** Alias of raw_stored: raw payloads inserted this run. */
  raw_inserted: number;
  /** Listings rows written by stage 5 (set on the invocation's lowest run id, 0 elsewhere). */
  listings_changed: number;
  /** Stage 5 stats on the invocation's lowest run id; other runs point at it. */
  dedup?: DedupStats | { see_run: number };
}

export interface RunResult {
  sourceId: string;
  runId: number;
  stats: RunStats;
}
