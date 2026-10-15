import {
  bigint, bigserial, boolean, char, index, integer, jsonb, pgTable, primaryKey, smallint, text,
  timestamp, unique, uuid, numeric,
} from 'drizzle-orm/pg-core';
import {
  furnishing, ingestRunStatus, parkingKind, pgGender, pgSharing, qualityStatus, unitKind,
} from './enums.js';
import { geographyPoint } from './custom.js';
import { localities, sources } from './reference.js';

export const ingestRuns = pgTable(
  'ingest_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: text('source_id').notNull().references(() => sources.id),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: ingestRunStatus('status').notNull().default('running'),
    engineVersion: text('engine_version').notNull(),
    stats: jsonb('stats').notNull().default({}),
  },
  (t) => [index('ingest_runs_source_as_of_idx').on(t.sourceId, t.asOf.desc())],
);

export const rawListings = pgTable(
  'raw_listings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: bigint('run_id', { mode: 'number' }).notNull().references(() => ingestRuns.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull().references(() => sources.id),
    sourceListingId: text('source_listing_id').notNull(),
    contentHash: char('content_hash', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('raw_listings_idem_key').on(t.sourceId, t.sourceListingId, t.contentHash),
    index('raw_listings_run_idx').on(t.runId),
  ],
);

export const sourceListings = pgTable(
  'source_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: text('source_id').notNull().references(() => sources.id),
    sourceListingId: text('source_listing_id').notNull(),
    listingId: uuid('listing_id'),
    unitKind: unitKind('unit_kind').notNull(),
    bhk: smallint('bhk'),
    rentInr: integer('rent_inr'),
    depositInr: integer('deposit_inr'),
    maintenanceInr: integer('maintenance_inr'),
    areaSqft: integer('area_sqft'),
    furnishing: furnishing('furnishing'),
    localityId: smallint('locality_id').references(() => localities.id),
    geom: geographyPoint('geom'),
    geohash6: char('geohash6', { length: 6 }),
    title: text('title'),
    titleTokens: text('title_tokens').array().notNull().default([]),
    description: text('description'),
    photoHashes: bigint('photo_hashes', { mode: 'bigint' }).array().notNull().default([]),
    photoSeeds: text('photo_seeds').array().notNull().default([]),
    pgSharing: pgSharing('pg_sharing'),
    pgFoodIncluded: boolean('pg_food_included'),
    pgGender: pgGender('pg_gender'),
    parking: parkingKind('parking'),
    facing: text('facing'),
    floor: smallint('floor'),
    totalFloors: smallint('total_floors'),
    tags: text('tags').array().notNull().default([]),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    isActive: boolean('is_active').notNull().default(true),
    qualityStatus: qualityStatus('quality_status').notNull(),
    qualityReasons: text('quality_reasons').array().notNull().default([]),
    qualityWarnings: text('quality_warnings').array().notNull().default([]),
    extractedBy: text('extracted_by'),
    isSynthetic: boolean('is_synthetic').notNull().default(false),
  },
  (t) => [
    unique('source_listings_source_key').on(t.sourceId, t.sourceListingId),
    index('source_listings_block_idx').on(t.geohash6, t.unitKind, t.bhk),
    index('source_listings_listing_idx').on(t.listingId),
    index('source_listings_geom_gist').using('gist', t.geom),
  ],
);

export const priceObservations = pgTable(
  'price_observations',
  {
    sourceListingId: uuid('source_listing_id').notNull().references(() => sourceListings.id, { onDelete: 'cascade' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    rentInr: integer('rent_inr').notNull(),
    depositInr: integer('deposit_inr'),
    runId: bigint('run_id', { mode: 'number' }).notNull().references(() => ingestRuns.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.sourceListingId, t.observedAt] })],
);
