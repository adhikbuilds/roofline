/**
 * Server-side reads for the web app. Every query is parameterized and runs in a read-only transaction as
 * the unprivileged roofline_app role (withReadOnly), never as the owner.
 * Any failure (database down, tables not migrated or empty) degrades to an empty state instead of a 500.
 */

import { resolveRedirect, type HistoryPoint, type Resolution } from './listing-detail';
import { PLATE_SEED } from './plate';
import { toFairInfo, type FairInfo } from './fairness';
import type { DealFilters } from './deals-filters';

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
