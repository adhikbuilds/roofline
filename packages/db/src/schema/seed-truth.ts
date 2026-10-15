// Eval ground truth (seed_truth schema). Deliberately NOT re-exported from schema/index.ts or the
// package root: only ingest, eval and check-drift import it, via '@roofline/db/seed-truth'.
import { bigint, integer, jsonb, numeric, pgSchema, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { furnishing, unitKind } from './enums.js';
import { modelRuns } from './listings.js';
import { localities, sources } from './reference.js';

/** Eval ground truth. roofline_app has no grants here; only the admin role touches it. */
export const seedTruth = pgSchema('seed_truth');

export const stUnits = seedTruth.table('units', {
  unitId: uuid('unit_id').primaryKey(),
  localityId: smallint('locality_id').notNull().references(() => localities.id),
  unitKind: unitKind('unit_kind').notNull(),
  bhk: smallint('bhk'),
  areaSqft: integer('area_sqft'),
  furnishing: furnishing('furnishing'),
  trueRentInr: integer('true_rent_inr').notNull(),
});

export const stSourceRows = seedTruth.table(
  'source_rows',
  {
    sourceId: text('source_id').notNull().references(() => sources.id),
    sourceListingId: text('source_listing_id').notNull(),
    unitId: uuid('unit_id').notNull().references(() => stUnits.unitId),
    defect: text('defect'),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.sourceListingId] })],
);

export const stTrueRent = seedTruth.table(
  'true_rent',
  {
    unitId: uuid('unit_id').notNull().references(() => stUnits.unitId),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    trueExpectedRentInr: integer('true_expected_rent_inr').notNull(),
  },
  (t) => [primaryKey({ columns: [t.unitId, t.asOf] })],
);

export const stTrueDeals = seedTruth.table('true_deals', {
  unitId: uuid('unit_id').primaryKey().references(() => stUnits.unitId),
  kind: text('kind').notNull(),
  rentMultiplier: numeric('rent_multiplier', { precision: 4, scale: 2 }).notNull(),
});

/** Truth-derived model metrics (CV vs truth, deal-eval numbers). Kept out of model_runs.metrics, which the web role can read. */
export const stModelRunEval = seedTruth.table('model_run_eval', {
  modelRunId: bigint('model_run_id', { mode: 'number' }).primaryKey().references(() => modelRuns.id, { onDelete: 'cascade' }),
  metrics: jsonb('metrics').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
