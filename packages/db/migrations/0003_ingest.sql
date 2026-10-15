-- Ingest: runs, raw payloads, normalized source listings, price observations, and the
-- seed_truth ground-truth tables. (PLAN section 5)

CREATE TYPE unit_kind AS ENUM ('rk', 'bhk', 'studio', 'pg_bed');
CREATE TYPE furnishing AS ENUM ('furnished', 'semi', 'unfurnished');
CREATE TYPE pg_sharing AS ENUM ('single', 'double', 'triple', 'quad');
CREATE TYPE pg_gender AS ENUM ('male', 'female', 'coed');
CREATE TYPE parking_kind AS ENUM ('bike', 'car', 'both', 'none');
CREATE TYPE quality_status AS ENUM ('accepted', 'rejected');
CREATE TYPE ingest_run_status AS ENUM ('running', 'ok', 'failed');

CREATE TABLE ingest_runs (
  id              bigserial PRIMARY KEY,
  source_id       text NOT NULL REFERENCES sources (id),
  as_of           timestamptz NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          ingest_run_status NOT NULL DEFAULT 'running',
  engine_version  text NOT NULL,
  stats           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ingest_runs_source_as_of_idx ON ingest_runs (source_id, as_of DESC);

CREATE TABLE raw_listings (
  id                 bigserial PRIMARY KEY,
  run_id             bigint NOT NULL REFERENCES ingest_runs (id) ON DELETE CASCADE,
  source_id          text NOT NULL REFERENCES sources (id),
  source_listing_id  text NOT NULL,
  content_hash       char(64) NOT NULL,
  payload            jsonb NOT NULL,
  fetched_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raw_listings_idem_key UNIQUE (source_id, source_listing_id, content_hash)
);
CREATE INDEX raw_listings_run_idx ON raw_listings (run_id);

CREATE TABLE source_listings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          text NOT NULL REFERENCES sources (id),
  source_listing_id  text NOT NULL,
  listing_id         uuid,
  unit_kind          unit_kind NOT NULL,
  bhk                smallint,
  rent_inr           integer,
  deposit_inr        integer,
  maintenance_inr    integer,
  area_sqft          integer,
  furnishing         furnishing,
  locality_id        smallint REFERENCES localities (id),
  geom               geography(Point, 4326),
  geohash6           char(6),
  title              text,
  title_tokens       text[] NOT NULL DEFAULT '{}',
  description        text,
  photo_hashes       bigint[] NOT NULL DEFAULT '{}',
  photo_seeds        text[] NOT NULL DEFAULT '{}',
  pg_sharing         pg_sharing,
  pg_food_included   boolean,
  pg_gender          pg_gender,
  parking            parking_kind,
  facing             text,
  floor              smallint,
  total_floors       smallint,
  tags               text[] NOT NULL DEFAULT '{}',
  posted_at          timestamptz,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  is_active          boolean NOT NULL DEFAULT true,
  quality_status     quality_status NOT NULL,
  quality_reasons    text[] NOT NULL DEFAULT '{}',
  quality_warnings   text[] NOT NULL DEFAULT '{}',
  extracted_by       text,
  is_synthetic       boolean NOT NULL DEFAULT false,
  CONSTRAINT source_listings_source_key UNIQUE (source_id, source_listing_id)
);
CREATE INDEX source_listings_block_idx ON source_listings (geohash6, unit_kind, bhk);
CREATE INDEX source_listings_listing_idx ON source_listings (listing_id);
CREATE INDEX source_listings_accepted_loc_bhk_idx ON source_listings (locality_id, bhk)
  WHERE quality_status = 'accepted';
CREATE INDEX source_listings_geom_gist ON source_listings USING gist (geom);
CREATE INDEX source_listings_reasons_gin ON source_listings USING gin (quality_reasons);

CREATE TABLE price_observations (
  source_listing_id  uuid NOT NULL REFERENCES source_listings (id) ON DELETE CASCADE,
  observed_at        timestamptz NOT NULL,
  rent_inr           integer NOT NULL,
  deposit_inr        integer,
  run_id             bigint NOT NULL REFERENCES ingest_runs (id) ON DELETE CASCADE,
  PRIMARY KEY (source_listing_id, observed_at)
);
CREATE INDEX price_observations_observed_idx ON price_observations (observed_at);

-- Ground truth for the synthetic seed (eval only). Admin role reads it; roofline_app never does.
CREATE TABLE seed_truth.units (
  unit_id         uuid PRIMARY KEY,
  locality_id     smallint NOT NULL REFERENCES public.localities (id),
  unit_kind       unit_kind NOT NULL,
  bhk             smallint,
  area_sqft       integer,
  furnishing      furnishing,
  true_rent_inr   integer NOT NULL
);

CREATE TABLE seed_truth.source_rows (
  source_id          text NOT NULL REFERENCES public.sources (id),
  source_listing_id  text NOT NULL,
  unit_id            uuid NOT NULL REFERENCES seed_truth.units (unit_id),
  defect             text,
  PRIMARY KEY (source_id, source_listing_id)
);
CREATE INDEX source_rows_defect_idx ON seed_truth.source_rows (defect);
CREATE INDEX source_rows_unit_idx ON seed_truth.source_rows (unit_id);

CREATE TABLE seed_truth.true_rent (
  unit_id                   uuid NOT NULL REFERENCES seed_truth.units (unit_id),
  as_of                     timestamptz NOT NULL,
  true_expected_rent_inr    integer NOT NULL,
  PRIMARY KEY (unit_id, as_of)
);

CREATE TABLE seed_truth.true_deals (
  unit_id          uuid PRIMARY KEY REFERENCES seed_truth.units (unit_id),
  kind             text NOT NULL CHECK (kind IN ('deal', 'too_good')),
  rent_multiplier  numeric(4, 2) NOT NULL
);

-- roofline_app: normalized listings and price history only. NO grants on raw_listings or seed_truth.
GRANT SELECT ON ingest_runs, source_listings, price_observations TO roofline_app;
REVOKE ALL ON raw_listings FROM roofline_app;
REVOKE ALL ON ALL TABLES IN SCHEMA seed_truth FROM PUBLIC, roofline_app;
