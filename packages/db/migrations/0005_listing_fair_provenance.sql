-- Provenance for the denormalised fair-rent columns: which model run and engine version produced them.
-- ON DELETE SET NULL so pruning an old model run never blocks and never touches listings.

ALTER TABLE listings
  ADD COLUMN fair_model_run_id bigint REFERENCES model_runs (id) ON DELETE SET NULL,
  ADD COLUMN fair_engine_version text;
