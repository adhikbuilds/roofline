-- A fair-rent estimate must say where it came from: any listing with a fair_rent_inr carries both the model run
-- and the engine version that produced it, and the two provenance columns are set or cleared together
-- (a low-confidence refusal keeps its provenance with no fair rent; the "no estimate" state has neither).
-- Existing rows that predate provenance are reset to the no-estimate state first so the constraints can be added.

UPDATE listings
   SET fair_rent_inr = NULL, fair_low_inr = NULL, fair_high_inr = NULL, fair_delta_pct = NULL, badge = NULL,
       confidence = NULL, fair_explanation = NULL, fair_model_run_id = NULL, fair_engine_version = NULL,
       is_deal = false, deal_score = NULL, deal_reason = NULL
 WHERE (fair_rent_inr IS NOT NULL AND (fair_model_run_id IS NULL OR fair_engine_version IS NULL))
    OR ((fair_model_run_id IS NULL) <> (fair_engine_version IS NULL));

ALTER TABLE listings
  ADD CONSTRAINT listings_fair_requires_provenance
    CHECK (fair_rent_inr IS NULL OR (fair_model_run_id IS NOT NULL AND fair_engine_version IS NOT NULL)),
  ADD CONSTRAINT listings_fair_provenance_paired
    CHECK ((fair_model_run_id IS NULL) = (fair_engine_version IS NULL));
