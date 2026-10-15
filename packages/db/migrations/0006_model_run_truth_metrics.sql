-- Truth-derived model metrics live in seed_truth, never in model_runs.metrics (roofline_app can SELECT model_runs).
-- One row per model run; admin-only, like the rest of seed_truth.
CREATE TABLE seed_truth.model_run_eval (
  model_run_id  bigint PRIMARY KEY REFERENCES public.model_runs (id) ON DELETE CASCADE,
  metrics       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON seed_truth.model_run_eval FROM PUBLIC, roofline_app;

-- Move anything already written by an earlier stage 6 (the cv truth fields) and strip it from the public column.
INSERT INTO seed_truth.model_run_eval (model_run_id, metrics)
SELECT id, jsonb_build_object('cv', jsonb_strip_nulls(jsonb_build_object(
         'mdapeTruth', metrics #> '{cv,mdapeTruth}', 'coverageTruth', metrics #> '{cv,coverageTruth}')))
  FROM public.model_runs
 WHERE metrics #> '{cv}' ?| ARRAY['mdapeTruth', 'coverageTruth'];

UPDATE public.model_runs
   SET metrics = jsonb_set(metrics, '{cv}', (metrics -> 'cv') - 'mdapeTruth' - 'coverageTruth')
 WHERE metrics #> '{cv}' ?| ARRAY['mdapeTruth', 'coverageTruth'];
