CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Unprivileged role the app assumes per transaction (SET LOCAL ROLE roofline_app). Roles are
-- cluster-wide, so creation must tolerate another database having made it already.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'roofline_app') THEN
    CREATE ROLE roofline_app NOLOGIN;
  END IF;
END
$$;

-- Ground truth for the synthetic seed. roofline_app must never read it: no USAGE, no grants.
CREATE SCHEMA IF NOT EXISTS seed_truth;
REVOKE ALL ON SCHEMA seed_truth FROM PUBLIC;
REVOKE ALL ON SCHEMA seed_truth FROM roofline_app;
