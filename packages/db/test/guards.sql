-- Dedup guard checks (PLAN Phase 2). Every row must report violations = 0.
-- A member is a source row that is accepted AND active; inactive rows keep their last listing_id as history,
-- so every query filters on the member predicate.

-- 1. Rent spread: rent_max_inr <= 1.25 * rent_min_inr on every listing (checked in integers: 4*max <= 5*min).
SELECT 'rent_spread' AS check, count(*) AS violations
  FROM listings WHERE 4::bigint * rent_max_inr > 5::bigint * rent_min_inr;

-- 2. Geo span: no two members of one listing are more than 1000 m apart.
SELECT 'geo_span' AS check, count(*) AS violations FROM (
  SELECT DISTINCT a.listing_id
    FROM source_listings a
    JOIN source_listings b ON b.listing_id = a.listing_id AND a.id < b.id
   WHERE a.quality_status = 'accepted' AND a.is_active
     AND b.quality_status = 'accepted' AND b.is_active
     AND a.geom IS NOT NULL AND b.geom IS NOT NULL
     AND ST_Distance(a.geom, b.geom) > 1000
) v;

-- 3. Cluster size cap.
SELECT 'size' AS check, count(*) AS violations FROM listings WHERE member_count > 8;

-- 4. Listing columns are computed from members only.
SELECT 'member_count_matches' AS check, count(*) AS violations FROM listings l
  WHERE l.is_active AND l.member_count <> (
    SELECT count(*) FROM source_listings s WHERE s.listing_id = l.id AND s.quality_status = 'accepted' AND s.is_active);

-- 5. Every redirect points at a live listing (chains have length 1).
SELECT 'dangling_redirects' AS check, count(*) AS violations
  FROM listing_redirects r LEFT JOIN listings l ON l.id = r.new_id WHERE l.id IS NULL;

-- 6. An old id is never both a redirect source and a live listing.
SELECT 'redirect_of_live_listing' AS check, count(*) AS violations
  FROM listing_redirects r JOIN listings l ON l.id = r.old_id;

-- 7. Every active listing has an active, accepted canonical member that belongs to it.
SELECT 'canonical_is_member' AS check, count(*) AS violations FROM listings l
  WHERE l.is_active AND NOT EXISTS (
    SELECT 1 FROM source_listings s WHERE s.id = l.canonical_source_listing_id AND s.listing_id = l.id
       AND s.quality_status = 'accepted' AND s.is_active);
