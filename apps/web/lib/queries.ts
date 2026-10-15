/**
 * Server-side reads for the web app. Every query is parameterized and runs in a read-only transaction as
 * the unprivileged roofline_app role (withReadOnly), never as the owner.
 * Any failure (database down, tables not migrated or empty) degrades to an empty state instead of a 500.
 */

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
};
export type ListingPage = { rows: ListingRow[]; page: number; hasNext: boolean };
export type LocalityRow = { slug: string; name: string; zone: string; listings: number; median2bhkRent: number | null };

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

export async function getLedger(): Promise<Ledger> {
  try {
    const [r] = await query<{ listings: string; sources: string; accepted: string; rejected: string }>(
      `SELECT (SELECT count(*) FROM listings WHERE is_active) AS listings,
              (SELECT count(DISTINCT source_id) FROM source_listings) AS sources,
              (SELECT count(*) FROM source_listings WHERE quality_status = 'accepted') AS accepted,
              (SELECT count(*) FROM source_listings WHERE quality_status = 'rejected') AS rejected`,
    );
    if (!r) return EMPTY_LEDGER;
    const listings = Number(r.listings);
    return {
      listings,
      sources: Number(r.sources),
      merged: Math.max(0, Number(r.accepted) - listings),
      rejected: Number(r.rejected),
    };
  } catch {
    return EMPTY_LEDGER;
  }
}

export async function getListings(page: number): Promise<ListingPage> {
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  try {
    const rows = await query<{
      id: string; rent_inr: number; deposit_inr: number | null; move_in_inr: number | null; bhk: number | null;
      unit_kind: string; area_sqft: number | null; source_count: number; locality_name: string;
    }>(
      `SELECT l.id, l.rent_inr, l.deposit_inr, l.move_in_inr, l.bhk, l.unit_kind, l.area_sqft, l.source_count,
              loc.name AS locality_name
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
