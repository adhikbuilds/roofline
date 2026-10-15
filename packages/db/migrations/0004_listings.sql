-- Canonical listings, dedup, redirects, models and estimates. (PLAN section 5)

CREATE TYPE fair_badge AS ENUM ('great_deal', 'good_price', 'fair', 'above_market', 'overpriced');
CREATE TYPE fair_confidence AS ENUM ('high', 'medium', 'low');
CREATE TYPE dedup_decision AS ENUM ('match', 'possible', 'guard_split');
CREATE TYPE model_kind AS ENUM ('robust_median', 'hedonic');

CREATE TABLE listings (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_source_listing_id   uuid NOT NULL REFERENCES source_listings (id)
                                  DEFERRABLE INITIALLY DEFERRED,
  member_count                  smallint NOT NULL DEFAULT 1,
  source_count                  smallint NOT NULL DEFAULT 1,
  source_ids                    text[] NOT NULL DEFAULT '{}',
  rent_min_inr                  integer,
  rent_max_inr                  integer,
  unit_kind                     unit_kind NOT NULL,
  bhk                           smallint,
  rent_inr                      integer NOT NULL,
  deposit_inr                   integer,
  move_in_inr                   integer GENERATED ALWAYS AS (rent_inr + deposit_inr) STORED,
  area_sqft                     integer,
  furnishing                    furnishing,
  locality_id                   smallint NOT NULL REFERENCES localities (id),
  geom                          geography(Point, 4326),
  pg_sharing                    pg_sharing,
  pg_food_included              boolean,
  pg_gender                     pg_gender,
  photo_seeds                   text[] NOT NULL DEFAULT '{}',
  fair_rent_inr                 integer,
  fair_low_inr                  integer,
  fair_high_inr                 integer,
  fair_delta_pct                real,
  badge                         fair_badge,
  confidence                    fair_confidence,
  fair_explanation              text,
  is_deal                       boolean NOT NULL DEFAULT false,
  deal_score                    real,
  deal_reason                   text,
  first_seen_at                 timestamptz NOT NULL DEFAULT now(),
  last_price_change_at          timestamptz,
  is_active                     boolean NOT NULL DEFAULT true,
  search_tsv                    tsvector
);
CREATE INDEX listings_geom_gist ON listings USING gist (geom);
CREATE INDEX listings_active_kind_bhk_rent_idx ON listings (is_active, unit_kind, bhk, rent_inr);
CREATE INDEX listings_loc_bhk_furn_idx ON listings (locality_id, bhk, furnishing);
CREATE INDEX listings_deal_score_idx ON listings (deal_score DESC) WHERE is_deal;
CREATE INDEX listings_first_seen_idx ON listings (first_seen_at DESC, id);
CREATE INDEX listings_search_tsv_gin ON listings USING gin (search_tsv);

-- Cluster membership: source_listings.listing_id points at the canonical listing. Deferred so a
-- cluster and its members can be written in either order inside one transaction.
ALTER TABLE source_listings
  ADD CONSTRAINT source_listings_listing_fk FOREIGN KEY (listing_id) REFERENCES listings (id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE listing_redirects (
  old_id  uuid PRIMARY KEY,
  new_id  uuid NOT NULL,
  at      timestamptz NOT NULL DEFAULT now(),
  CHECK (old_id <> new_id)
);
CREATE INDEX listing_redirects_new_idx ON listing_redirects (new_id);

CREATE TABLE dedup_pairs (
  run_id    bigint NOT NULL REFERENCES ingest_runs (id) ON DELETE CASCADE,
  a_id      uuid NOT NULL,
  b_id      uuid NOT NULL,
  score     real NOT NULL,
  decision  dedup_decision NOT NULL,
  features  jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (a_id, b_id),
  CHECK (a_id < b_id)
);
CREATE INDEX dedup_pairs_decision_idx ON dedup_pairs (decision);

CREATE TABLE model_runs (
  id              bigserial PRIMARY KEY,
  kind            model_kind NOT NULL,
  engine_version  text NOT NULL,
  as_of           timestamptz NOT NULL,
  artifact        jsonb NOT NULL,
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active       boolean NOT NULL DEFAULT false
);
-- Exactly one active model at a time.
CREATE UNIQUE INDEX model_runs_one_active_idx ON model_runs ((true)) WHERE is_active;

CREATE TABLE fair_rent_estimates (
  listing_id    uuid NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  model_run_id  bigint NOT NULL REFERENCES model_runs (id) ON DELETE CASCADE,
  expected_inr  integer NOT NULL,
  low_inr       integer NOT NULL,
  high_inr      integer NOT NULL,
  delta_pct     real,
  badge         fair_badge,
  confidence    fair_confidence NOT NULL,
  basis         jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation   text,
  PRIMARY KEY (listing_id, model_run_id)
);

-- Public read surface. dedup_pairs stays admin-only; raw_listings and seed_truth are never granted.
GRANT SELECT ON listings, listing_redirects, model_runs, fair_rent_estimates TO roofline_app;
