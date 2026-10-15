import {
  boolean, index, integer, numeric, pgTable, primaryKey, serial, smallint, smallserial, text,
  timestamp, unique,
} from 'drizzle-orm/pg-core';
import { aliasOrigin, localityZone, metroEdgeKind, metroLine, metroStatus } from './enums.js';
import { geographyPoint } from './custom.js';


export const localities = pgTable(
  'localities',
  {
    id: smallserial('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    zone: localityZone('zone').notNull(),
    centroid: geographyPoint('centroid').notNull(),
    radiusM: integer('radius_m').notNull(),
    approx: boolean('approx').notNull().default(true),
    base2bhkHint: integer('base_2bhk_hint'),
  },
  (t) => [unique('localities_slug_key').on(t.slug), index('localities_centroid_gist').using('gist', t.centroid)],
);

export const localityAliases = pgTable('locality_aliases', {
  aliasNorm: text('alias_norm').primaryKey(),
  localityId: smallint('locality_id')
    .notNull()
    .references(() => localities.id, { onDelete: 'cascade' }),
  origin: aliasOrigin('origin').notNull().default('curated'),
});

export const localityUnmatched = pgTable('locality_unmatched', {
  rawNorm: text('raw_norm').primaryKey(),
  sampleRaw: text('sample_raw').notNull(),
  count: integer('count').notNull().default(1),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export const metroStations = pgTable(
  'metro_stations',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    line: metroLine('line').notNull(),
    seq: integer('seq').notNull(),
    geom: geographyPoint('geom').notNull(),
    status: metroStatus('status').notNull().default('operational'),
    approx: boolean('approx').notNull().default(true),
  },
  (t) => [unique('metro_stations_line_seq_key').on(t.line, t.seq)],
);

export const metroEdges = pgTable(
  'metro_edges',
  {
    fromId: integer('from_id').notNull().references(() => metroStations.id, { onDelete: 'cascade' }),
    toId: integer('to_id').notNull().references(() => metroStations.id, { onDelete: 'cascade' }),
    minutes: numeric('minutes', { precision: 5, scale: 1 }).notNull(),
    kind: metroEdgeKind('kind').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId] })],
);

export const workPresets = pgTable('work_presets', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  geom: geographyPoint('geom').notNull(),
  approx: boolean('approx').notNull().default(true),
});

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  licenseKind: text('license_kind').notNull(),
  terms: text('terms').notNull(),
  attribution: text('attribution').notNull(),
  isSynthetic: boolean('is_synthetic').notNull().default(false),
  priority: smallint('priority').notNull().default(100),
});
