import { pgEnum } from 'drizzle-orm/pg-core';

// 0002_reference.sql
export const localityZone = pgEnum('locality_zone', ['central', 'east', 'south_east', 'south', 'west', 'north', 'north_east']);
export const aliasOrigin = pgEnum('alias_origin', ['curated', 'approved']);
export const metroLine = pgEnum('metro_line', ['purple', 'green', 'yellow', 'pink', 'blue']);
export const metroStatus = pgEnum('metro_status', ['operational', 'planned']);
export const metroEdgeKind = pgEnum('metro_edge_kind', ['ride', 'interchange']);

// 0003_ingest.sql
export const unitKind = pgEnum('unit_kind', ['rk', 'bhk', 'studio', 'pg_bed']);
export const furnishing = pgEnum('furnishing', ['furnished', 'semi', 'unfurnished']);
export const pgSharing = pgEnum('pg_sharing', ['single', 'double', 'triple', 'quad']);
export const pgGender = pgEnum('pg_gender', ['male', 'female', 'coed']);
export const parkingKind = pgEnum('parking_kind', ['bike', 'car', 'both', 'none']);
export const qualityStatus = pgEnum('quality_status', ['accepted', 'rejected']);
export const ingestRunStatus = pgEnum('ingest_run_status', ['running', 'ok', 'failed']);

// 0004_listings.sql
export const fairBadge = pgEnum('fair_badge', ['great_deal', 'good_price', 'fair', 'above_market', 'overpriced']);
export const fairConfidence = pgEnum('fair_confidence', ['high', 'medium', 'low']);
export const dedupDecision = pgEnum('dedup_decision', ['match', 'possible', 'guard_split']);
export const modelKind = pgEnum('model_kind', ['robust_median', 'hedonic']);
