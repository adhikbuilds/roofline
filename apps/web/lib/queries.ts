/**
 * Server-side reads for the web app. Every query is parameterized and runs in a read-only transaction as
 * the unprivileged roofline_app role (withReadOnly), never as the owner.
 * Any failure (database down, tables not migrated or empty) degrades to an empty state instead of a 500.
 */

import { resolveRedirect, type HistoryPoint, type Resolution } from './listing-detail';
import { PLATE_SEED } from './plate';
import { toFairInfo, type FairInfo } from './fairness';
import type { DealFilters } from './deals-filters';
import { encodeCursor, type HomesCursor, type HomesFilters, type SortKey } from '@/components/browse/filters'; // browse

export const PAGE_SIZE = 40;

export type Ledger = { listings: number; sources: number; merged: number; rejected: number };
export type ListingRow = {
  id: string;
  rentInr: number;
  depositInr: number | null;
  moveInInr: number | null;
  bhk: number | null;
  unitKind: string;
  areaSqft: number | null;
  sourceCount: number;
  localityName: string;
  fair: FairInfo | null;
};
export type ListingPage = { rows: ListingRow[]; page: number; hasNext: boolean };
export type LocalityRow = { slug: string; name: string; zone: string; listings: number; median2bhkRent: number | null };

type FairCols = {
  fair_rent_inr: number | null; fair_low_inr: number | null; fair_high_inr: number | null; fair_delta_pct: number | null;
  badge: string | null; confidence: string | null; fair_explanation: string | null;
  fair_model_run_id: number | string | null; fair_engine_version: string | null;
};
const FAIR_SELECT =
  'l.fair_rent_inr, l.fair_low_inr, l.fair_high_inr, l.fair_delta_pct, l.badge::text AS badge, l.confidence::text AS confidence, l.fair_explanation, l.fair_model_run_id, l.fair_engine_version';

const EMPTY_LEDGER: Ledger = { listings: 0, sources: 0, merged: 0, rejected: 0 };

/** Parse a ?page= value: anything that is not a positive integer becomes page 1. */
export function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d{1,6}$/.test(v)) return 1;
  const n = Number(v);
  return n >= 1 ? n : 1;
}

async function query<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const { withReadOnly } = await import('@roofline/db');
  return withReadOnly(async (client) => (await client.query<T>(text, params)).rows);
}

/** Null means the counts could not be read (database down). The header must not show zeros as if they were real. */
export async function getLedger(): Promise<Ledger | null> {
  try {
    const [r] = await query<{ listings: string; sources: string; merged: string; rejected: string }>(
      `SELECT (SELECT count(*) FROM listings WHERE is_active) AS listings,
              (SELECT count(DISTINCT source_id) FROM source_listings) AS sources,
              (SELECT coalesce(sum(member_count - 1), 0) FROM listings WHERE is_active) AS merged,
              (SELECT count(*) FROM source_listings WHERE quality_status = 'rejected') AS rejected`,
    );
    if (!r) return EMPTY_LEDGER;
    const listings = Number(r.listings);
    return {
      listings,
      sources: Number(r.sources),
      merged: Number(r.merged),
      rejected: Number(r.rejected),
    };
  } catch {
    return null;
  }
}

export async function getListings(page: number): Promise<ListingPage> {
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  try {
    const rows = await query<{
      id: string; rent_inr: number; deposit_inr: number | null; move_in_inr: number | null; bhk: number | null;
      unit_kind: string; area_sqft: number | null; source_count: number; locality_name: string;
    } & FairCols>(
      `SELECT l.id, l.rent_inr, l.deposit_inr, l.move_in_inr, l.bhk, l.unit_kind, l.area_sqft, l.source_count,
              loc.name AS locality_name, ${FAIR_SELECT}
         FROM listings l JOIN localities loc ON loc.id = l.locality_id
        WHERE l.is_active
        ORDER BY l.first_seen_at DESC, l.id
        LIMIT $1 OFFSET $2`,
      [PAGE_SIZE + 1, (safePage - 1) * PAGE_SIZE],
    );
    return {
      page: safePage,
      hasNext: rows.length > PAGE_SIZE,
      rows: rows.slice(0, PAGE_SIZE).map((r) => ({
        id: r.id,
        rentInr: r.rent_inr,
        depositInr: r.deposit_inr,
        moveInInr: r.move_in_inr ?? (r.deposit_inr == null ? null : r.rent_inr + r.deposit_inr),
        bhk: r.bhk,
        unitKind: r.unit_kind,
        areaSqft: r.area_sqft,
        sourceCount: r.source_count,
        localityName: r.locality_name,
        fair: toFairInfo(r),
      })),
    };
  } catch {
    return { rows: [], page: safePage, hasNext: false };
  }
}

export async function getLocalities(): Promise<LocalityRow[]> {
  try {
    const rows = await query<{ slug: string; name: string; zone: string; listings: string; median: string | null }>(
      `SELECT loc.slug, loc.name, loc.zone::text AS zone,
              count(l.id) AS listings,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY l.rent_inr) FILTER (WHERE l.unit_kind = 'bhk' AND l.bhk = 2) AS median
         FROM localities loc
         LEFT JOIN listings l ON l.locality_id = loc.id AND l.is_active
        GROUP BY loc.id
        ORDER BY loc.name`,
    );
    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      zone: r.zone,
      listings: Number(r.listings),
      median2bhkRent: r.median == null ? null : Math.round(Number(r.median)),
    }));
  } catch {
    return [];
  }
}

export type ListingSource = { sourceId: string; sourceName: string; rentInr: number | null; depositInr: number | null };
export type ListingDetail = {
  id: string;
  rentInr: number;
  depositInr: number | null;
  moveInInr: number | null;
  unitKind: string;
  bhk: number | null;
  areaSqft: number | null;
  furnishing: string | null;
  localityName: string;
  sourceCount: number;
  plateSeeds: string[];
  sources: ListingSource[];
  history: HistoryPoint[];
  fair: FairInfo | null;
};

/** Is this id a live listing, an old id that redirects to one (max 3 hops), or unknown? Failures read as unknown. */
export async function resolveListing(id: string): Promise<Resolution> {
  try {
    return await resolveRedirect(
      id,
      async (old) => (await query<{ new_id: string }>('SELECT new_id FROM listing_redirects WHERE old_id = $1', [old]))[0]?.new_id ?? null,
      async (cand) => (await query('SELECT 1 FROM listings WHERE id = $1 AND is_active', [cand])).length > 0,
    );
  } catch {
    return { kind: 'missing' };
  }
}

export async function getListingDetail(id: string): Promise<ListingDetail | null> {
  try {
    const [l] = await query<{
      id: string; rent_inr: number; deposit_inr: number | null; move_in_inr: number | null; unit_kind: string;
      bhk: number | null; area_sqft: number | null; furnishing: string | null; source_count: number;
      photo_seeds: string[]; locality_name: string; canonical: string;
    } & FairCols>(
      `SELECT l.id, l.rent_inr, l.deposit_inr, l.move_in_inr, l.unit_kind, l.bhk, l.area_sqft, l.furnishing::text AS furnishing,
              l.source_count, l.photo_seeds, loc.name AS locality_name, l.canonical_source_listing_id AS canonical, ${FAIR_SELECT}
         FROM listings l JOIN localities loc ON loc.id = l.locality_id
        WHERE l.id = $1 AND l.is_active`,
      [id],
    );
    if (!l) return null;
    const [sources, history] = await Promise.all([
      query<{ source_id: string; display_name: string; rent_inr: number | null; deposit_inr: number | null }>(
        `SELECT s.source_id, src.display_name, s.rent_inr, s.deposit_inr
           FROM source_listings s JOIN sources src ON src.id = s.source_id
          WHERE s.listing_id = $1
          ORDER BY src.priority, src.display_name, s.id`,
        [id],
      ),
      query<{ observed_at: Date; rent_inr: number }>(
        `SELECT observed_at, rent_inr FROM price_observations WHERE source_listing_id = $1 ORDER BY observed_at`,
        [l.canonical],
      ),
    ]);
    return {
      id: l.id,
      rentInr: l.rent_inr,
      depositInr: l.deposit_inr,
      moveInInr: l.move_in_inr ?? (l.deposit_inr == null ? null : l.rent_inr + l.deposit_inr),
      unitKind: l.unit_kind,
      bhk: l.bhk,
      areaSqft: l.area_sqft,
      furnishing: l.furnishing,
      localityName: l.locality_name,
      sourceCount: l.source_count,
      plateSeeds: l.photo_seeds.filter((x) => PLATE_SEED.test(x)),
      sources: sources.map((r) => ({ sourceId: r.source_id, sourceName: r.display_name, rentInr: r.rent_inr, depositInr: r.deposit_inr })),
      history: history.map((h) => ({ at: new Date(h.observed_at).toISOString(), rentInr: h.rent_inr })),
      fair: toFairInfo(l),
    };
  } catch {
    return null;
  }
}

export type DealRow = {
  id: string;
  rentInr: number;
  bhk: number | null;
  unitKind: string;
  areaSqft: number | null;
  localityName: string;
  score: number;
  reason: string;
  fair: FairInfo;
};
export type DealLocality = { slug: string; name: string };

export const DEALS_LIMIT = 60;

/** Ranked by the stored deal score. Filters are already validated; they still go in as parameters. */
export async function getDeals(f: DealFilters): Promise<DealRow[]> {
  try {
    const rows = await query<{
      id: string; rent_inr: number; bhk: number | null; unit_kind: string; area_sqft: number | null;
      locality_name: string; deal_score: number; deal_reason: string;
    } & FairCols>(
      `SELECT l.id, l.rent_inr, l.bhk, l.unit_kind, l.area_sqft, loc.name AS locality_name, l.deal_score, l.deal_reason, ${FAIR_SELECT}
         FROM listings l JOIN localities loc ON loc.id = l.locality_id
        WHERE l.is_active AND l.is_deal AND l.deal_reason IS NOT NULL
          AND ($1::text IS NULL OR loc.slug = $1)
          AND ($2::int IS NULL OR (l.unit_kind = 'bhk' AND l.bhk = $2))
        ORDER BY l.deal_score DESC NULLS LAST, l.id
        LIMIT $3`,
      [f.locality, f.bhk, DEALS_LIMIT],
    );
    return rows.flatMap((r) => {
      const fair = toFairInfo(r);
      return fair
        ? [{ id: r.id, rentInr: r.rent_inr, bhk: r.bhk, unitKind: r.unit_kind, areaSqft: r.area_sqft, localityName: r.locality_name, score: r.deal_score, reason: r.deal_reason, fair }]
        : [];
    });
  } catch {
    return [];
  }
}

/** Localities that currently have at least one deal; the filter offers only these. */
export async function getDealLocalities(): Promise<DealLocality[]> {
  try {
    return await query<DealLocality>(
      `SELECT loc.slug, loc.name FROM localities loc
        WHERE EXISTS (SELECT 1 FROM listings l WHERE l.locality_id = loc.id AND l.is_active AND l.is_deal)
        ORDER BY loc.name`,
    );
  } catch {
    return [];
  }
}

export type CountFilters = {
  locality: string | null;
  /** 0 means 1 RK; 4 with bhkMin true means "4 or more". */
  bhk: number | 'rk' | null;
  bhkOrMore?: boolean;
  minRent: number | null;
  maxRent: number | null;
  kind: 'flat' | 'pg' | null;
};

/** Live "Search N homes" count. Null means the database could not be read. All filters are bound parameters. */
export async function countListings(f: CountFilters): Promise<number | null> {
  try {
    const rows = await query<{ n: string }>(
      `SELECT count(*) AS n
         FROM listings l JOIN localities loc ON loc.id = l.locality_id
        WHERE l.is_active
          AND ($1::text IS NULL OR loc.slug = $1)
          AND ($2::text IS NULL
               OR ($2 = 'rk' AND l.unit_kind = 'rk')
               OR ($2 <> 'rk' AND l.unit_kind = 'bhk' AND (($3::boolean AND l.bhk >= $2::int) OR (NOT $3::boolean AND l.bhk = $2::int))))
          AND ($4::int IS NULL OR l.rent_inr >= $4)
          AND ($5::int IS NULL OR l.rent_inr <= $5)
          AND ($6::text IS NULL
               OR ($6 = 'pg' AND l.unit_kind = 'pg_bed')
               OR ($6 = 'flat' AND l.unit_kind <> 'pg_bed'))`,
      [f.locality, f.bhk == null ? null : String(f.bhk), f.bhkOrMore ?? false, f.minRent, f.maxRent, f.kind],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return null;
  }
}

// detail: similar listings for /listing/[id]
export type SimilarListings = { localitySlug: string | null; localityName: string | null; rows: ListingRow[] };

/** Up to `limit` other live listings in the same locality with the same BHK / unit kind, nearest rent first. */
export async function getSimilarListings(id: string, limit = 8): Promise<SimilarListings> {
  try {
    const rows = await query<{
      id: string; rent_inr: number; deposit_inr: number | null; move_in_inr: number | null; bhk: number | null;
      unit_kind: string; area_sqft: number | null; source_count: number; locality_name: string; locality_slug: string;
    } & FairCols>(
      `SELECT l.id, l.rent_inr, l.deposit_inr, l.move_in_inr, l.bhk, l.unit_kind, l.area_sqft, l.source_count,
              loc.name AS locality_name, loc.slug AS locality_slug, ${FAIR_SELECT}
         FROM listings s
         JOIN listings l ON l.locality_id = s.locality_id AND l.unit_kind = s.unit_kind
                        AND l.bhk IS NOT DISTINCT FROM s.bhk AND l.id <> s.id AND l.is_active
         JOIN localities loc ON loc.id = l.locality_id
        WHERE s.id = $1
        ORDER BY abs(l.rent_inr - s.rent_inr), l.id
        LIMIT $2`,
      [id, Math.max(1, Math.min(limit, 24))],
    );
    return {
      localitySlug: rows[0]?.locality_slug ?? null,
      localityName: rows[0]?.locality_name ?? null,
      rows: rows.map((r) => ({
        id: r.id,
        rentInr: r.rent_inr,
        depositInr: r.deposit_inr,
        moveInInr: r.move_in_inr ?? (r.deposit_inr == null ? null : r.rent_inr + r.deposit_inr),
        bhk: r.bhk,
        unitKind: r.unit_kind,
        areaSqft: r.area_sqft,
        sourceCount: r.source_count,
        localityName: r.locality_name,
        fair: toFairInfo(r),
      })),
    };
  } catch {
    return { localitySlug: null, localityName: null, rows: [] };
  }
}

// browse: /homes keyset-paginated feed (owned by the browse agent; keep edits inside this block)

export const HOMES_PAGE_SIZE = 24;

/** Sort expressions are constants here, never built from input. `type` is the cast used to bind the cursor value. */
const HOMES_SORT: Record<SortKey, { key: string; type: string; dir: 'ASC' | 'DESC' }> = {
  // Listings without a verdict sort last; the huge sentinel keeps the key non-null so the keyset comparison is total.
  best: { key: `(CASE WHEN l.badge IS NULL OR l.fair_delta_pct IS NULL THEN 1000000000 ELSE l.fair_delta_pct::numeric END)`, type: 'numeric', dir: 'ASC' },
  new: { key: 'l.first_seen_at', type: 'timestamptz', dir: 'DESC' },
  rent_up: { key: 'l.rent_inr', type: 'int', dir: 'ASC' },
  rent_down: { key: 'l.rent_inr', type: 'int', dir: 'DESC' },
};

function homesWhere(f: HomesFilters, params: unknown[]): string {
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const w = ['l.is_active'];
  if (f.loc) w.push(`loc.slug = ${p(f.loc)}`);
  if (f.min != null) w.push(`l.rent_inr >= ${p(f.min)}::int`);
  if (f.max != null) w.push(`l.rent_inr <= ${p(f.max)}::int`);
  if (f.kind === 'pg') w.push(`l.unit_kind = 'pg_bed'`);
  if (f.kind === 'flat') w.push(`l.unit_kind <> 'pg_bed'`);
  if (f.furn.length) w.push(`l.furnishing::text = ANY(${p(f.furn)}::text[])`);
  if (f.verdict.length) w.push(`l.badge::text = ANY(${p(f.verdict)}::text[])`);
  if (f.bhk.length) {
    const exact = f.bhk.filter((b) => b === '1' || b === '2' || b === '3').map(Number);
    const parts: string[] = [];
    if (exact.length) parts.push(`(l.unit_kind = 'bhk' AND l.bhk = ANY(${p(exact)}::int[]))`);
    if (f.bhk.includes('rk')) parts.push(`l.unit_kind = 'rk'`);
    if (f.bhk.includes('4plus')) parts.push(`(l.unit_kind = 'bhk' AND l.bhk >= 4)`);
    w.push(`(${parts.join(' OR ')})`);
  }
  return w.join(' AND ');
}

export type HomesPage = { rows: ListingRow[]; nextCursor: string | null };

export async function getHomesPage(f: HomesFilters, cursor: HomesCursor | null = null): Promise<HomesPage> {
  try {
    const params: unknown[] = [];
    let where = homesWhere(f, params);
    const s = HOMES_SORT[f.sort];
    if (cursor) {
      params.push(cursor.k, cursor.id);
      const k = `$${params.length - 1}::${s.type}`;
      const id = `$${params.length}::uuid`;
      where += ` AND (${s.key} ${s.dir === 'ASC' ? '>' : '<'} ${k} OR (${s.key} = ${k} AND l.id > ${id}))`;
    }
    params.push(HOMES_PAGE_SIZE + 1);
    const rows = await query<{
      id: string; rent_inr: number; deposit_inr: number | null; move_in_inr: number | null; bhk: number | null;
      unit_kind: string; area_sqft: number | null; source_count: number; locality_name: string; sort_key: string;
    } & FairCols>(
      `SELECT l.id, l.rent_inr, l.deposit_inr, l.move_in_inr, l.bhk, l.unit_kind, l.area_sqft, l.source_count,
              loc.name AS locality_name, ${s.key}::text AS sort_key, ${FAIR_SELECT}
         FROM listings l JOIN localities loc ON loc.id = l.locality_id
        WHERE ${where}
        ORDER BY ${s.key} ${s.dir}, l.id ASC
        LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, HOMES_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      nextCursor: rows.length > HOMES_PAGE_SIZE && last ? encodeCursor({ k: last.sort_key, id: last.id }) : null,
      rows: page.map((r) => ({
        id: r.id,
        rentInr: r.rent_inr,
        depositInr: r.deposit_inr,
        moveInInr: r.move_in_inr ?? (r.deposit_inr == null ? null : r.rent_inr + r.deposit_inr),
        bhk: r.bhk,
        unitKind: r.unit_kind,
        areaSqft: r.area_sqft,
        sourceCount: r.source_count,
        localityName: r.locality_name,
        fair: toFairInfo(r),
      })),
    };
  } catch {
    return { rows: [], nextCursor: null };
  }
}

/** Total matching homes for the same filters. Null when the database cannot be read. */
export async function countHomes(f: HomesFilters): Promise<number | null> {
  try {
    const params: unknown[] = [];
    const where = homesWhere(f, params);
    const [r] = await query<{ n: string }>(
      `SELECT count(*) AS n FROM listings l JOIN localities loc ON loc.id = l.locality_id WHERE ${where}`,
      params,
    );
    return Number(r?.n ?? 0);
  } catch {
    return null;
  }
}

export async function getLocalityName(slug: string): Promise<string | null> {
  try {
    return (await query<{ name: string }>('SELECT name FROM localities WHERE slug = $1', [slug]))[0]?.name ?? null;
  } catch {
    return null;
  }
}
// end browse

// landing -------------------------------------------------------------------------------------------------------
// Reads for the "/" landing page. Everything is computed live; nothing here is a constant.

export type LandingStats = { flats: number; pgBeds: number };

/** Active listings split into flats (every non-PG kind, RK and studio included) and PG beds. */
export async function getLandingStats(): Promise<LandingStats | null> {
  try {
    const [r] = await query<{ flats: string; pg: string }>(
      `SELECT count(*) FILTER (WHERE unit_kind <> 'pg_bed') AS flats,
              count(*) FILTER (WHERE unit_kind = 'pg_bed') AS pg
         FROM listings WHERE is_active`,
    );
    return r ? { flats: Number(r.flats), pgBeds: Number(r.pg) } : null;
  } catch {
    return null;
  }
}

export type FeaturedFair = {
  id: string;
  localityName: string;
  bhk: number;
  rentInr: number;
  areaSqft: number | null;
  comps: number;
  fair: FairInfo & { lowInr: number; highInr: number };
};

/**
 * One real listing for the "Is this rent fair? Try it" demo: a 2 BHK with a high-confidence estimate and an interval,
 * in the locality with the most 2 BHK comparables, priced closest to its estimate. Deterministic (ties break on id).
 */
export async function getFeaturedFair(): Promise<FeaturedFair | null> {
  try {
    const [r] = await query<{
      id: string; locality_name: string; bhk: number; rent_inr: number; area_sqft: number | null; comps: string;
    } & FairCols>(
      `SELECT * FROM (
         SELECT l.id, loc.name AS locality_name, l.bhk, l.rent_inr, l.area_sqft, ${FAIR_SELECT},
                (SELECT count(*) FROM listings c
                  WHERE c.is_active AND c.locality_id = l.locality_id AND c.unit_kind = 'bhk' AND c.bhk = l.bhk) AS comps
           FROM listings l JOIN localities loc ON loc.id = l.locality_id
          WHERE l.is_active AND l.unit_kind = 'bhk' AND l.bhk = 2 AND l.confidence = 'high'
            AND l.badge IS NOT NULL AND l.fair_low_inr IS NOT NULL AND l.fair_high_inr IS NOT NULL
            AND l.fair_low_inr < l.fair_rent_inr AND l.fair_rent_inr < l.fair_high_inr
       ) q
       ORDER BY comps DESC, abs(fair_delta_pct) ASC, id
       LIMIT 1`,
    );
    const fair = r ? toFairInfo(r) : null;
    if (!r || !fair || fair.lowInr == null || fair.highInr == null) return null;
    return {
      id: r.id, localityName: r.locality_name, bhk: r.bhk, rentInr: r.rent_inr, areaSqft: r.area_sqft,
      comps: Number(r.comps), fair: { ...fair, lowInr: fair.lowInr, highInr: fair.highInr },
    };
  } catch {
    return null;
  }
}

export type MergeExample = { localityName: string; bhk: number; areaSqft: number | null; rentInr: number; sourceRents: number[] };

/** A real listing that three sources carried, for the "Merged" tab. Source names stay out of it on purpose. */
export async function getMergeExample(): Promise<MergeExample | null> {
  try {
    const rows = await query<{ locality_name: string; bhk: number; area_sqft: number | null; rent_inr: number; rents: number[] }>(
      `SELECT loc.name AS locality_name, l.bhk, l.area_sqft, l.rent_inr,
              array_agg(sl.rent_inr ORDER BY sl.source_id) AS rents
         FROM listings l
         JOIN localities loc ON loc.id = l.locality_id
         JOIN source_listings sl ON sl.listing_id = l.id AND sl.rent_inr IS NOT NULL
        WHERE l.is_active AND l.source_count = 3 AND l.unit_kind = 'bhk' AND l.bhk = 2 AND l.area_sqft IS NOT NULL
        GROUP BY l.id, loc.name
       HAVING count(*) = 3
        ORDER BY (SELECT count(*) FROM listings c WHERE c.locality_id = l.locality_id AND c.is_active) DESC, l.id
        LIMIT 1`,
    );
    const r = rows[0];
    return r ? { localityName: r.locality_name, bhk: r.bhk, areaSqft: r.area_sqft, rentInr: r.rent_inr, sourceRents: r.rents.map(Number) } : null;
  } catch {
    return null;
  }
}

export type LandingLocality = LocalityRow & { lat: number; lng: number };

/** All localities with their centroid, active-listing count and 2 BHK median (map dots, combobox, busiest grid). */
export async function getLandingLocalities(): Promise<LandingLocality[]> {
  try {
    const rows = await query<{ slug: string; name: string; zone: string; lat: number; lng: number; listings: string; median: string | null }>(
      `SELECT loc.slug, loc.name, loc.zone::text AS zone,
              ST_Y(loc.centroid::geometry) AS lat, ST_X(loc.centroid::geometry) AS lng,
              count(l.id) AS listings,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY l.rent_inr) FILTER (WHERE l.unit_kind = 'bhk' AND l.bhk = 2) AS median
         FROM localities loc
         LEFT JOIN listings l ON l.locality_id = loc.id AND l.is_active
        GROUP BY loc.id
        ORDER BY count(l.id) DESC, loc.name`,
    );
    return rows.map((r) => ({
      slug: r.slug, name: r.name, zone: r.zone, lat: Number(r.lat), lng: Number(r.lng),
      listings: Number(r.listings), median2bhkRent: r.median == null ? null : Math.round(Number(r.median)),
    }));
  } catch {
    return [];
  }
}

/** The city outline for the map teaser: the locality centroids' convex hull, padded 2.5 km and smoothed. [lng, lat] ring. */
export async function getCityOutline(): Promise<Array<[number, number]>> {
  try {
    const [r] = await query<{ g: string | null }>(
      `SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_ChaikinSmoothing(ST_Buffer(ST_ConvexHull(ST_Collect(centroid::geometry))::geography, 2500)::geometry, 2), 0.002), 4) AS g
         FROM localities`,
    );
    const ring = r?.g ? (JSON.parse(r.g) as { coordinates: number[][][] }).coordinates[0] : null;
    return ring ? ring.map((p) => [p[0]!, p[1]!] as [number, number]) : [];
  } catch {
    return [];
  }
}

export type LocalityTrend = { slug: string; weeks: Array<number | null> };

/**
 * 26 weekly points of median 2 BHK rent per locality, in SQL. Each point is the median of the rent every active
 * 2 BHK stood at as of that week's end (its latest price observation by then; listings not yet seen are left out), so
 * it tracks the market and not the noise of who happened to change price that week. Weeks end at the newest observation.
 */
export async function getLocalityTrends(slugs: string[]): Promise<LocalityTrend[]> {
  if (slugs.length === 0) return [];
  try {
    const rows = await query<{ slug: string; i: number; med: string }>(
      `WITH anchor AS (SELECT date_trunc('week', max(observed_at)) + interval '7 days' AS wk_end FROM price_observations),
            weeks AS (SELECT i, a.wk_end - (25 - i) * interval '7 days' AS wk_end FROM anchor a, generate_series(0, 25) AS i)
       SELECT loc.slug, w.i, percentile_cont(0.5) WITHIN GROUP (ORDER BY o.rent_inr) AS med
         FROM localities loc
         JOIN listings l ON l.locality_id = loc.id AND l.is_active AND l.unit_kind = 'bhk' AND l.bhk = 2
        CROSS JOIN weeks w
        CROSS JOIN LATERAL (
              SELECT po.rent_inr FROM price_observations po
               WHERE po.source_listing_id = l.canonical_source_listing_id AND po.observed_at < w.wk_end
               ORDER BY po.observed_at DESC LIMIT 1) o
        WHERE loc.slug = ANY($1::text[])
        GROUP BY loc.slug, w.i
        ORDER BY loc.slug, w.i`,
      [slugs],
    );
    const by = new Map<string, Array<number | null>>(slugs.map((s) => [s, Array<number | null>(26).fill(null)]));
    for (const r of rows) by.get(r.slug)![r.i] = Math.round(Number(r.med));
    return slugs.map((slug) => ({ slug, weeks: by.get(slug)! }));
  } catch {
    return slugs.map((slug) => ({ slug, weeks: Array<number | null>(26).fill(null) }));
  }
}

/** The 12 best deals by the stored score, as photo-card rows. */
export async function getLandingDeals(): Promise<DealRow[]> {
  return (await getDeals({ locality: null, bhk: null })).slice(0, 12);
}
// end landing ---------------------------------------------------------------------------------------------------
