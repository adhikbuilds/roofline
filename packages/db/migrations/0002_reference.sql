-- Reference data: localities, aliases, metro, work presets, sources. (PLAN section 5)

CREATE TYPE locality_zone AS ENUM
  ('central', 'east', 'south_east', 'south', 'west', 'north', 'north_east');
CREATE TYPE alias_origin AS ENUM ('curated', 'approved');
CREATE TYPE metro_line AS ENUM ('purple', 'green', 'yellow', 'pink', 'blue');
CREATE TYPE metro_status AS ENUM ('operational', 'planned');
CREATE TYPE metro_edge_kind AS ENUM ('ride', 'interchange');

CREATE TABLE localities (
  id              smallserial PRIMARY KEY,
  slug            text NOT NULL,
  name            text NOT NULL,
  zone            locality_zone NOT NULL,
  centroid        geography(Point, 4326) NOT NULL,
  radius_m        integer NOT NULL CHECK (radius_m > 0),
  approx          boolean NOT NULL DEFAULT true,
  base_2bhk_hint  integer,
  CONSTRAINT localities_slug_key UNIQUE (slug)
);
CREATE INDEX localities_centroid_gist ON localities USING gist (centroid);
CREATE INDEX localities_name_trgm ON localities USING gin (name gin_trgm_ops);

CREATE TABLE locality_aliases (
  alias_norm   text PRIMARY KEY,
  locality_id  smallint NOT NULL REFERENCES localities (id) ON DELETE CASCADE,
  origin       alias_origin NOT NULL DEFAULT 'curated'
);
CREATE INDEX locality_aliases_locality_idx ON locality_aliases (locality_id);

CREATE TABLE locality_unmatched (
  raw_norm       text PRIMARY KEY,
  sample_raw     text NOT NULL,
  count          integer NOT NULL DEFAULT 1,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE metro_stations (
  id      serial PRIMARY KEY,
  name    text NOT NULL,
  line    metro_line NOT NULL,
  seq     integer NOT NULL,
  geom    geography(Point, 4326) NOT NULL,
  status  metro_status NOT NULL DEFAULT 'operational',
  approx  boolean NOT NULL DEFAULT true,
  CONSTRAINT metro_stations_line_seq_key UNIQUE (line, seq)
);
CREATE INDEX metro_stations_geom_gist ON metro_stations USING gist (geom);

CREATE TABLE metro_edges (
  from_id  integer NOT NULL REFERENCES metro_stations (id) ON DELETE CASCADE,
  to_id    integer NOT NULL REFERENCES metro_stations (id) ON DELETE CASCADE,
  minutes  numeric(5, 1) NOT NULL CHECK (minutes > 0),
  kind     metro_edge_kind NOT NULL,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE work_presets (
  slug    text PRIMARY KEY,
  name    text NOT NULL,
  geom    geography(Point, 4326) NOT NULL,
  approx  boolean NOT NULL DEFAULT true
);
CREATE INDEX work_presets_geom_gist ON work_presets USING gist (geom);

CREATE TABLE sources (
  id            text PRIMARY KEY,
  display_name  text NOT NULL,
  license_kind  text NOT NULL,
  terms         text NOT NULL,
  attribution   text NOT NULL,
  is_synthetic  boolean NOT NULL DEFAULT false,
  priority      smallint NOT NULL DEFAULT 100
);

-- roofline_app reads reference data only; writes happen through the admin role.
GRANT USAGE ON SCHEMA public TO roofline_app;
GRANT SELECT ON localities, locality_aliases, locality_unmatched, metro_stations, metro_edges,
  work_presets, sources TO roofline_app;
