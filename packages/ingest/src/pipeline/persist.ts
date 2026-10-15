/** Persistence: source_listings, price observations on change, delisting. Listings are built by stage 5 (dedup.ts). */
import { geohashEncode } from '@roofline/engine';
import { sourceListingUuid } from '../ids';
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
  unit_kind = EXCLUDED.unit_kind, bhk = EXCLUDED.bhk, rent_inr = EXCLUDED.rent_inr,
  deposit_inr = EXCLUDED.deposit_inr, maintenance_inr = EXCLUDED.maintenance_inr, area_sqft = EXCLUDED.area_sqft,
  furnishing = EXCLUDED.furnishing, locality_id = EXCLUDED.locality_id, geom = EXCLUDED.geom,
  geohash6 = EXCLUDED.geohash6, title = EXCLUDED.title, title_tokens = EXCLUDED.title_tokens,
  description = EXCLUDED.description, photo_hashes = EXCLUDED.photo_hashes, photo_seeds = EXCLUDED.photo_seeds,
  pg_sharing = EXCLUDED.pg_sharing, pg_food_included = EXCLUDED.pg_food_included, pg_gender = EXCLUDED.pg_gender,
  parking = EXCLUDED.parking, facing = EXCLUDED.facing, floor = EXCLUDED.floor, total_floors = EXCLUDED.total_floors,
  tags = EXCLUDED.tags, posted_at = EXCLUDED.posted_at, last_seen_at = EXCLUDED.last_seen_at, is_active = true,
  quality_status = EXCLUDED.quality_status, quality_reasons = EXCLUDED.quality_reasons,
  quality_warnings = EXCLUDED.quality_warnings, extracted_by = EXCLUDED.extracted_by`;

/** Price observation only on first sighting or when (rent, deposit) differs from the latest one. */
const INSERT_OBSERVATIONS = `
INSERT INTO price_observations (source_listing_id, observed_at, rent_inr, deposit_inr, run_id)
SELECT x.id, $2::timestamptz, x.rent, x.deposit, x.run_id
  FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, rent int, deposit int, run_id bigint)
  LEFT JOIN LATERAL (SELECT p.rent_inr, p.deposit_inr FROM price_observations p
                      WHERE p.source_listing_id = x.id ORDER BY p.observed_at DESC LIMIT 1) last ON true
 WHERE last.rent_inr IS NULL OR (last.rent_inr, last.deposit_inr) IS DISTINCT FROM (x.rent, x.deposit)
ON CONFLICT (source_listing_id, observed_at) DO NOTHING
RETURNING run_id`;

function toRecord(d: Draft): Record<string, unknown> {
  return {
    id: sourceListingUuid(d.sourceId, d.sourceListingId),
    source_id: d.sourceId,
    source_listing_id: d.sourceListingId,
    listing_id: null, // prior membership is owned by stage 5 and never written here
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
  /** Accepted drafts written, per run. */
  listingsUpserted: Map<number, number>;
  /** Observations actually inserted, per run. */
  priceObservations: Map<number, number>;
}

/** Upsert every processed draft and record price observations on change. Listings come from stage 5. */
export async function persistDrafts(db: Db, drafts: Draft[], asOf: Date): Promise<PersistResult> {
  const listingsUpserted = new Map<number, number>();
  const priceObservations = new Map<number, number>();
  for (let i = 0; i < drafts.length; i += CHUNK) {
    const part = drafts.slice(i, i + CHUNK);
    await db.query(UPSERT_SOURCE_LISTINGS, [JSON.stringify(part.map(toRecord))]);
    const accepted = part.filter((d) => d.status === 'accepted');
    if (accepted.length > 0) {
      const res = await db.query<{ run_id: string }>(INSERT_OBSERVATIONS, [
        JSON.stringify(accepted.map((d) => ({ id: sourceListingUuid(d.sourceId, d.sourceListingId), rent: d.rentInr, deposit: d.depositInr, run_id: d.runId }))),
        asOf.toISOString(),
      ]);
      for (const r of res.rows) priceObservations.set(Number(r.run_id), (priceObservations.get(Number(r.run_id)) ?? 0) + 1);
    }
    for (const d of accepted) listingsUpserted.set(d.runId, (listingsUpserted.get(d.runId) ?? 0) + 1);
  }
  return { listingsUpserted, priceObservations };
}

/** Rows seen again unchanged: bump last_seen_at and reactivate. Returns the ids that were reactivated. */
export async function touchSeen(db: Db, sourceId: string, ids: string[], asOf: Date): Promise<string[]> {
  const reactivated: string[] = [];
  for (let i = 0; i < ids.length; i += 2000) {
    const res = await db.query<{ id: string; was_active: boolean }>(
      `UPDATE source_listings sl SET last_seen_at = $3::timestamptz, is_active = true
         FROM (SELECT id, is_active AS was_active FROM source_listings
                WHERE source_id = $1 AND source_listing_id = ANY($2::text[])) old
        WHERE sl.id = old.id
        RETURNING sl.id, old.was_active`,
      [sourceId, ids.slice(i, i + 2000), asOf.toISOString()],
    );
    for (const r of res.rows) if (!r.was_active) reactivated.push(r.id);
  }
  return reactivated;
}

/** Rows this source no longer returns are delisted (kept, inactive). Returns their ids; stage 5 handles listings. */
export async function delistMissing(db: Db, sourceId: string, seenIds: string[]): Promise<string[]> {
  const res = await db.query<{ id: string }>(
    `UPDATE source_listings SET is_active = false
      WHERE source_id = $1 AND is_active AND NOT (source_listing_id = ANY($2::text[]))
      RETURNING id`,
    [sourceId, seenIds],
  );
  return res.rows.map((r) => r.id);
}
