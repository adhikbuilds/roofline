import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, real, smallint, text, timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  dedupDecision, fairBadge, fairConfidence, furnishing, modelKind, pgGender, pgSharing, unitKind,
} from './enums.js';
import { geographyPoint, tsvector } from './custom.js';
import { localities } from './reference.js';
import { ingestRuns, sourceListings } from './ingest.js';

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    canonicalSourceListingId: uuid('canonical_source_listing_id').notNull().references(() => sourceListings.id),
    memberCount: smallint('member_count').notNull().default(1),
    sourceCount: smallint('source_count').notNull().default(1),
    sourceIds: text('source_ids').array().notNull().default([]),
    rentMinInr: integer('rent_min_inr'),
    rentMaxInr: integer('rent_max_inr'),
    unitKind: unitKind('unit_kind').notNull(),
    bhk: smallint('bhk'),
    rentInr: integer('rent_inr').notNull(),
    depositInr: integer('deposit_inr'),
    moveInInr: integer('move_in_inr').generatedAlwaysAs(sql`rent_inr + deposit_inr`),
    areaSqft: integer('area_sqft'),
    furnishing: furnishing('furnishing'),
    localityId: smallint('locality_id').notNull().references(() => localities.id),
    geom: geographyPoint('geom'),
    pgSharing: pgSharing('pg_sharing'),
    pgFoodIncluded: boolean('pg_food_included'),
    pgGender: pgGender('pg_gender'),
    photoSeeds: text('photo_seeds').array().notNull().default([]),
    fairRentInr: integer('fair_rent_inr'),
    fairLowInr: integer('fair_low_inr'),
    fairHighInr: integer('fair_high_inr'),
    fairDeltaPct: real('fair_delta_pct'),
    badge: fairBadge('badge'),
    confidence: fairConfidence('confidence'),
    fairExplanation: text('fair_explanation'),
    fairModelRunId: bigint('fair_model_run_id', { mode: 'number' }).references(() => modelRuns.id, { onDelete: 'set null' }),
    fairEngineVersion: text('fair_engine_version'),
    isDeal: boolean('is_deal').notNull().default(false),
    dealScore: real('deal_score'),
    dealReason: text('deal_reason'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastPriceChangeAt: timestamp('last_price_change_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    searchTsv: tsvector('search_tsv'),
  },
  (t) => [
    index('listings_geom_gist').using('gist', t.geom),
    index('listings_active_kind_bhk_rent_idx').on(t.isActive, t.unitKind, t.bhk, t.rentInr),
    index('listings_loc_bhk_furn_idx').on(t.localityId, t.bhk, t.furnishing),
  ],
);

export const listingRedirects = pgTable('listing_redirects', {
  oldId: uuid('old_id').primaryKey(),
  newId: uuid('new_id').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const dedupPairs = pgTable(
  'dedup_pairs',
  {
    runId: bigint('run_id', { mode: 'number' }).notNull().references(() => ingestRuns.id, { onDelete: 'cascade' }),
    aId: uuid('a_id').notNull(),
    bId: uuid('b_id').notNull(),
    score: real('score').notNull(),
    decision: dedupDecision('decision').notNull(),
    features: jsonb('features').notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.aId, t.bId] }), index('dedup_pairs_decision_idx').on(t.decision)],
);

export const modelRuns = pgTable('model_runs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  kind: modelKind('kind').notNull(),
  engineVersion: text('engine_version').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  artifact: jsonb('artifact').notNull(),
  metrics: jsonb('metrics').notNull().default({}),
  isActive: boolean('is_active').notNull().default(false),
});

export const fairRentEstimates = pgTable(
  'fair_rent_estimates',
  {
    listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    modelRunId: bigint('model_run_id', { mode: 'number' }).notNull().references(() => modelRuns.id, { onDelete: 'cascade' }),
    expectedInr: integer('expected_inr').notNull(),
    lowInr: integer('low_inr').notNull(),
    highInr: integer('high_inr').notNull(),
    deltaPct: real('delta_pct'),
    badge: fairBadge('badge'),
    confidence: fairConfidence('confidence').notNull(),
    basis: jsonb('basis').notNull().default({}),
    explanation: text('explanation'),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.modelRunId] })],
);
