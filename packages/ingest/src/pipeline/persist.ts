/** Persistence: source_listings, 1:1 placeholder listings, price observations, delisting. */
import { geohashEncode } from '@roofline/engine';
import { listingUuid, sourceListingUuid } from '../ids';
import type { Db } from './db';
import type { Draft } from './types';

const CHUNK = 500;

const UPSERT_SOURCE_LISTINGS = `
INSERT INTO source_listings (
  id, source_id, source_listing_id, listing_id, unit_kind, bhk, rent_inr, deposit_inr, maintenance_inr, area_sqft,
  furnishing, locality_id, geom, geohash6, title, title_tokens, description, photo_hashes, photo_seeds,
  pg_sharing, pg_food_included, pg_gender, parking, facing, floor, total_floors, tags, posted_at,
  first_seen_at, last_seen_at, is_active, quality_status, quality_reasons, quality_warnings, extracted_by, is_synthetic)
SELECT x.id, x.source_id, x.source_listing_id, x.listing_id, x.unit_kind::unit_kind, x.bhk, x.rent_inr, x.deposit_inr,
  x.maintenance_inr, x.area_sqft, x.furnishing::furnishing, x.locality_id,
  CASE WHEN x.lat IS NULL OR x.lng IS NULL THEN NULL
       ELSE ST_SetSRID(ST_MakePoint(x.lng, x.lat), 4326)::geography END,
  x.geohash6, x.title,
  ARRAY(SELECT jsonb_array_elements_text(x.title_tokens)), x.description,
  ARRAY(SELECT jsonb_array_elements_text(x.photo_hashes)::bigint),
  ARRAY(SELECT jsonb_array_elements_text(x.photo_seeds)),
  x.pg_sharing::pg_sharing, x.pg_food_included, x.pg_gender::pg_gender, x.parking::parking_kind, x.facing,
  x.floor, x.total_floors, ARRAY(SELECT jsonb_array_elements_text(x.tags)), x.posted_at,
  x.seen_at, x.seen_at, true, x.quality_status::quality_status,
  ARRAY(SELECT jsonb_array_elements_text(x.quality_reasons)),
  ARRAY(SELECT jsonb_array_elements_text(x.quality_warnings)), x.extracted_by, x.is_synthetic
FROM jsonb_to_recordset($1::jsonb) AS x(
  id uuid, source_id text, source_listing_id text, listing_id uuid, unit_kind text, bhk int, rent_inr int,
  deposit_inr int, maintenance_inr int, area_sqft int, furnishing text, locality_id int, lat float8, lng float8,
  geohash6 text, title text, title_tokens jsonb, description text, photo_hashes jsonb, photo_seeds jsonb,
  pg_sharing text, pg_food_included boolean, pg_gender text, parking text, facing text, floor int, total_floors int,
  tags jsonb, posted_at timestamptz, seen_at timestamptz, quality_status text, quality_reasons jsonb,
  quality_warnings jsonb, extracted_by text, is_synthetic boolean)
ON CONFLICT (source_id, source_listing_id) DO UPDATE SET
  listing_id = EXCLUDED.listing_id, unit_kind = EXCLUDED.unit_kind, bhk = EXCLUDED.bhk, rent_inr = EXCLUDED.rent_inr,
  deposit_inr = EXCLUDED.deposit_inr, maintenance_inr = EXCLUDED.maintenance_inr, area_sqft = EXCLUDED.area_sqft,
  furnishing = EXCLUDED.furnishing, locality_id = EXCLUDED.locality_id, geom = EXCLUDED.geom,
  geohash6 = EXCLUDED.geohash6, title = EXCLUDED.title, title_tokens = EXCLUDED.title_tokens,
  description = EXCLUDED.description, photo_hashes = EXCLUDED.photo_hashes, photo_seeds = EXCLUDED.photo_seeds,
  pg_sharing = EXCLUDED.pg_sharing, pg_food_included = EXCLUDED.pg_food_included, pg_gender = EXCLUDED.pg_gender,
  parking = EXCLUDED.parking, facing = EXCLUDED.facing, floor = EXCLUDED.floor, total_floors = EXCLUDED.total_floors,
  tags = EXCLUDED.tags, posted_at = EXCLUDED.posted_at, last_seen_at = EXCLUDED.last_seen_at, is_active = true,
  quality_status = EXCLUDED.quality_status, quality_reasons = EXCLUDED.quality_reasons,
  quality_warnings = EXCLUDED.quality_warnings, extracted_by = EXCLUDED.extracted_by`;

const UPSERT_LISTINGS = `
INSERT INTO listings (
  id, canonical_source_listing_id, member_count, source_count, source_ids, rent_min_inr, rent_max_inr, unit_kind, bhk,
  rent_inr, deposit_inr, area_sqft, furnishing, locality_id, geom, pg_sharing, pg_food_included, pg_gender,
  photo_seeds, first_seen_at, is_active)
SELECT sl.listing_id, sl.id, 1, 1, ARRAY[sl.source_id], sl.rent_inr, sl.rent_inr, sl.unit_kind, sl.bhk,
  sl.rent_inr, sl.deposit_inr, sl.area_sqft, sl.furnishing, sl.locality_id, sl.geom, sl.pg_sharing,
  sl.pg_food_included, sl.pg_gender, sl.photo_seeds, sl.first_seen_at, true
FROM source_listings sl
WHERE sl.id = ANY($1::uuid[]) AND sl.quality_status = 'accepted' AND sl.listing_id IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  last_price_change_at = CASE WHEN listings.rent_inr <> EXCLUDED.rent_inr THEN $2::timestamptz
                              ELSE listings.last_price_change_at END,
  rent_min_inr = EXCLUDED.rent_min_inr, rent_max_inr = EXCLUDED.rent_max_inr, rent_inr = EXCLUDED.rent_inr,
  deposit_inr = EXCLUDED.deposit_inr, area_sqft = EXCLUDED.area_sqft, furnishing = EXCLUDED.furnishing,
  locality_id = EXCLUDED.locality_id, geom = EXCLUDED.geom, pg_sharing = EXCLUDED.pg_sharing,
  pg_food_included = EXCLUDED.pg_food_included, pg_gender = EXCLUDED.pg_gender, photo_seeds = EXCLUDED.photo_seeds,
  is_active = true`;

function toRecord(d: Draft): Record<string, unknown> {
  const accepted = d.status === 'accepted';
  return {
    id: sourceListingUuid(d.sourceId, d.sourceListingId),
    source_id: d.sourceId,
    source_listing_id: d.sourceListingId,
    listing_id: accepted ? listingUuid(d.sourceId, d.sourceListingId) : null,
    // Unit kind is NOT NULL in the schema: an unparseable kind is stored as a BHK of unknown size and rejected.
    unit_kind: d.unitKind ?? 'bhk',
    bhk: d.bhk,
    rent_inr: d.rentInr,
    deposit_inr: d.depositInr,
    maintenance_inr: d.maintenanceInr,
    area_sqft: d.areaSqft,
    furnishing: d.furnishing,
    locality_id: d.localityId,
    lat: d.lat,
    lng: d.lng,
    geohash6: d.lat !== null && d.lng !== null ? geohashEncode(d.lat, d.lng, 6) : null,
    title: d.title,
    title_tokens: d.titleTokens,
    description: d.description,
    photo_hashes: d.photoHashes,
    photo_seeds: d.photoSeeds,
    pg_sharing: d.pgSharing,
    pg_food_included: d.pgFood,
    pg_gender: d.pgGender,
    parking: d.parking,
    facing: d.facing,
    floor: d.floor,
    total_floors: d.totalFloors,
    tags: d.tags,
    posted_at: d.postedAt,
    seen_at: d.asOf.toISOString(),
    quality_status: d.status,
    quality_reasons: d.reasons,
    quality_warnings: d.warnings,
    extracted_by: d.extractedBy,
    is_synthetic: d.isSynthetic,
  };
}

export interface PersistResult {
  listingsUpserted: Map<number, number>;
  priceObservations: Map<number, number>;
}

/** Upsert every processed draft; accepted ones also become 1:1 placeholder listings (dedup is Phase 2). */
export async function persistDrafts(db: Db, drafts: Draft[], asOf: Date): Promise<PersistResult> {
  const listingsUpserted = new Map<number, number>();
  const priceObservations = new Map<number, number>();
  for (let i = 0; i < drafts.length; i += CHUNK) {
    const part = drafts.slice(i, i + CHUNK);
    await db.query(UPSERT_SOURCE_LISTINGS, [JSON.stringify(part.map(toRecord))]);
    const accepted = part.filter((d) => d.status === 'accepted');
    const rejectedIds = part.filter((d) => d.status === 'rejected').map((d) => listingUuid(d.sourceId, d.sourceListingId));
    if (accepted.length > 0) {
      await db.query(UPSERT_LISTINGS, [accepted.map((d) => sourceListingUuid(d.sourceId, d.sourceListingId)), asOf.toISOString()]);
      await db.query(
        `INSERT INTO price_observations (source_listing_id, observed_at, rent_inr, deposit_inr, run_id)
         SELECT x.id, $2::timestamptz, x.rent, x.deposit, x.run_id
           FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, rent int, deposit int, run_id bigint)
         ON CONFLICT (source_listing_id, observed_at) DO NOTHING`,
        [
          JSON.stringify(accepted.map((d) => ({ id: sourceListingUuid(d.sourceId, d.sourceListingId), rent: d.rentInr, deposit: d.depositInr, run_id: d.runId }))),
          asOf.toISOString(),
        ],
      );
    }
    if (rejectedIds.length > 0) await db.query('UPDATE listings SET is_active = false WHERE id = ANY($1::uuid[])', [rejectedIds]);
    for (const d of accepted) {
      listingsUpserted.set(d.runId, (listingsUpserted.get(d.runId) ?? 0) + 1);
      priceObservations.set(d.runId, (priceObservations.get(d.runId) ?? 0) + 1);
    }
  }
  return { listingsUpserted, priceObservations };
}

/** Rows seen again unchanged: bump last_seen_at and reactivate. */
export async function touchSeen(db: Db, sourceId: string, ids: string[], asOf: Date): Promise<void> {
  for (let i = 0; i < ids.length; i += 2000) {
    await db.query(
      `UPDATE source_listings SET last_seen_at = $3::timestamptz, is_active = true
        WHERE source_id = $1 AND source_listing_id = ANY($2::text[])`,
      [sourceId, ids.slice(i, i + 2000), asOf.toISOString()],
    );
  }
}

/** Rows this source no longer returns are delisted (kept, inactive); returns how many. */
export async function delistMissing(db: Db, sourceId: string, seenIds: string[]): Promise<number> {
  const res = await db.query<{ id: string }>(
    `UPDATE source_listings SET is_active = false
      WHERE source_id = $1 AND is_active AND NOT (source_listing_id = ANY($2::text[]))
      RETURNING id`,
    [sourceId, seenIds],
  );
  if (res.rows.length > 0) {
    await db.query('UPDATE listings SET is_active = false WHERE canonical_source_listing_id = ANY($1::uuid[])', [res.rows.map((r) => r.id)]);
  }
  return res.rows.length;
}
