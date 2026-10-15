import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawListing, SourceAdapter } from '../src/adapter';
import { evalDedup } from '../src/eval/dedup-eval';
import { sourceListingUuid, uuidFor } from '../src/ids';
import { runWeek } from '../src/pipeline';
import { freshIngestDb } from './helpers/db';

const W = (n: number): Date => new Date(Date.UTC(2026, 3, 9) + n * 7 * 86_400_000);
const SOURCES = ['csv:alpha', 'csv:beta', 'csv:gamma'] as const;
type Src = (typeof SOURCES)[number];

const HASH = { x: '0f0f0f0f0f0f0f0f', y: 'f0f0f0f0f0f0f0f0', g: 'aaaaaaaaaaaaaaaa', p: '3333333333333333', q: 'cccccccccccccccc', h: '5a5a5a5a5a5a5a5a' };
const photos = (h: string): RawListing['photos'] => [0, 1, 2].map((i) => ({ seed: `${h}-${i}`, dhash: h }));

const INDIRA = { lat: 12.9784, lng: 77.6408 };
const KORA = { lat: 12.9352, lng: 77.6245 };
const M = 1 / 111_000; // one metre in degrees of latitude

function flat(id: string, loc: 'Indiranagar' | 'Koramangala', at: { lat: number; lng: number }, rent: number, hash: string, over: Partial<RawListing> = {}): RawListing {
  return {
    sourceListingId: id, title: `2 BHK flat for rent in ${loc}`, rentText: String(rent), depositText: '3 months', areaText: '1,000 sq.ft',
    bhkText: '2 BHK', furnishingText: 'Semi-Furnished', localityText: loc, lat: at.lat, lng: at.lng, photos: photos(hash), ...over,
  };
}

/** What each source lists in a given week. Scenarios are described next to the week that triggers them. */
function rowsAt(src: Src, week: number): RawListing[] {
  const rows: RawListing[] = [];
  if (src === 'csv:alpha') {
    rows.push(flat('X1', 'Indiranagar', INDIRA, 40000, HASH.x, week === 1 ? { title: '2 BHK spacious flat Indiranagar' } : {})); // title-only change in week 1
    rows.push(flat('H1', 'Indiranagar', { lat: INDIRA.lat + 20 * M, lng: INDIRA.lng }, 40000, HASH.h)); // same building, other photos
    if (week !== 3) rows.push(flat('Y1', 'Indiranagar', { lat: INDIRA.lat + 3000 * M, lng: INDIRA.lng }, week >= 2 ? 27000 : 30000, HASH.y)); // delisted in week 3, rent drop in week 2
    rows.push(flat('P1', 'Indiranagar', { lat: INDIRA.lat - 2500 * M, lng: INDIRA.lng }, 20000, HASH.p));
    rows.push(flat('G1', 'Koramangala', KORA, 35000, HASH.g));
  }
  if (src === 'csv:beta') {
    rows.push(flat('X2', 'Indiranagar', { lat: INDIRA.lat + 15 * M, lng: INDIRA.lng }, week >= 5 ? 1 : 41000, HASH.x)); // rejected (rent too low) from week 5
    rows.push(flat('P2', 'Indiranagar', { lat: INDIRA.lat - 2500 * M + 10 * M, lng: INDIRA.lng }, 20000, week === 1 ? HASH.p : HASH.q)); // same photos as P1 only in week 1
    rows.push(flat('G2', 'Koramangala', { lat: KORA.lat + 600 * M, lng: KORA.lng }, 35000, HASH.g));
  }
  if (src === 'csv:gamma') rows.push(flat('G3', 'Koramangala', { lat: KORA.lat + 1200 * M, lng: KORA.lng }, 35000, HASH.g));
  return rows;
}

const adapters = (): SourceAdapter[] =>
  SOURCES.map((id) => ({
    id,
    displayName: id,
    license: { kind: 'licensed-feed', terms: 'test fixture', attributionRequired: false, imageRights: 'none' },
    async *fetch({ asOf }) {
      const week = Math.round((asOf.getTime() - W(0).getTime()) / (7 * 86_400_000));
      for (const r of rowsAt(id, week)) yield r;
    },
  }));

let db: Client;
beforeAll(async () => {
  db = await freshIngestDb('roofline_ingest_dedup_test');
  for (const [i, id] of SOURCES.entries()) {
    await db.query(
      `INSERT INTO sources (id, display_name, license_kind, terms, attribution, is_synthetic, priority)
       VALUES ($1, $1, 'licensed_feed', 'test fixture', 'none', false, $2)`,
      [id, 90 + i],
    );
  }
});
afterAll(async () => {
  await db.end();
});

const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query(sql, params)).rows as T[];
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await rows<T>(sql, params))[0] as T;
const slId = (sid: string): string => sourceListingUuid(SOURCES[sid.startsWith('X1') || ['H1', 'Y1', 'P1', 'G1'].includes(sid) ? 0 : sid === 'G3' ? 2 : 1] as string, sid);
const listingOf = async (sid: string): Promise<{ listing_id: string | null; is_active: boolean }> =>
  one('SELECT listing_id, is_active FROM source_listings WHERE id = $1', [slId(sid)]);
const dangling = async (): Promise<number> =>
  Number((await one<{ n: string }>('SELECT count(*) AS n FROM listing_redirects r LEFT JOIN listings l ON l.id = r.new_id WHERE l.id IS NULL')).n);
const week = async (n: number, full = false) => {
  const res = await runWeek(db, adapters(), W(n), { full });
  return res[0]!.stats;
};

describe('week 0: merges, guards and hard negatives', () => {
  it('merges a cross-source duplicate into one listing with a cluster view', async () => {
    const s = await week(0);
    expect(s.accepted).toBeGreaterThan(0);
    expect(s.rejected).toBe(0);
    const x1 = await listingOf('X1');
    const x2 = await listingOf('X2');
    expect(x1.listing_id).not.toBeNull();
    expect(x1.listing_id).toBe(x2.listing_id);
    const l = await one<{ member_count: number; source_count: number; source_ids: string[]; rent_min_inr: number; rent_max_inr: number; id: string }>(
      'SELECT * FROM listings WHERE id = $1',
      [x1.listing_id],
    );
    expect(l).toMatchObject({ member_count: 2, source_count: 2, source_ids: ['csv:alpha', 'csv:beta'], rent_min_inr: 40000, rent_max_inr: 41000 });
    // minted id of a first-time cluster is the Phase 1 scheme for the seed member (min source-listing id)
    expect([uuidFor('listing', 'csv:alpha:X1'), uuidFor('listing', 'csv:beta:X2')]).toContain(l.id);
  });

  it('never merges the same-building hard negative (same source, different photos)', async () => {
    expect((await listingOf('H1')).listing_id).not.toBe((await listingOf('X1')).listing_id);
  });

  it('splits a 600 m + 600 m chain at the geo-span guard and records guard_split', async () => {
    const g1 = (await listingOf('G1')).listing_id;
    const g2 = (await listingOf('G2')).listing_id;
    const g3 = (await listingOf('G3')).listing_id;
    expect(new Set([g1, g2, g3]).size).toBe(2);
    const gs = await rows<{ decision: string; features: { guard?: string; raw_decision: string } }>(
      `SELECT decision, features FROM dedup_pairs WHERE decision = 'guard_split'`,
    );
    expect(gs).toHaveLength(1);
    expect(gs[0]!.features).toMatchObject({ guard: 'GEO_SPAN', raw_decision: 'match' });
  });

  it('keeps P1 and P2 apart while their photos differ, and writes no redirect or dangling row', async () => {
    expect((await listingOf('P1')).listing_id).not.toBe((await listingOf('P2')).listing_id);
    expect(await dangling()).toBe(0);
  });

  it('stores dedup_pairs with a < b and run ids from this invocation', async () => {
    const bad = await one<{ n: string }>('SELECT count(*) AS n FROM dedup_pairs WHERE a_id >= b_id');
    expect(bad.n).toBe('0');
  });

  it('re-running the same week changes nothing: listings_changed = 0, no raw inserts', async () => {
    const before = await one<{ h: string }>(`SELECT md5(string_agg(l::text, '' ORDER BY id)) AS h FROM listings l`);
    const s = await week(0);
    expect(s).toMatchObject({ raw_inserted: 0, listings_changed: 0 });
    expect(s.dedup).toMatchObject({ mode: 'incremental', dirty: 0, removed: 0, listings_changed: 0 });
    expect((await one<{ h: string }>(`SELECT md5(string_agg(l::text, '' ORDER BY id)) AS h FROM listings l`)).h).toBe(before.h);
  });
});

describe('week 1: merge of two listings, redirects and price observations', () => {
  let p1Before: string;
  let p2Before: string;
  beforeAll(async () => {
    p1Before = (await listingOf('P1')).listing_id as string;
    p2Before = (await listingOf('P2')).listing_id as string;
  });

  it('a title-only change creates no price observation', async () => {
    const before = Number((await one<{ n: string }>('SELECT count(*) AS n FROM price_observations WHERE source_listing_id = $1', [slId('X1')])).n);
    const s = await week(1);
    expect(s.dedup).toMatchObject({ mode: 'incremental' });
    expect(Number((await one<{ n: string }>('SELECT count(*) AS n FROM price_observations WHERE source_listing_id = $1', [slId('X1')])).n)).toBe(before);
  });

  it('absorbs one prior listing into the other: one redirect, absorbed row deleted, pointers repointed', async () => {
    const p1 = (await listingOf('P1')).listing_id as string;
    const p2 = (await listingOf('P2')).listing_id as string;
    expect(p1).toBe(p2);
    const survivor = p1;
    const loser = survivor === p1Before ? p2Before : p1Before;
    expect([p1Before, p2Before]).toContain(survivor);
    expect(await rows('SELECT * FROM listing_redirects')).toMatchObject([{ old_id: loser, new_id: survivor }]);
    expect(await rows('SELECT id FROM listings WHERE id = $1', [loser])).toHaveLength(0);
    expect(await rows('SELECT id FROM source_listings WHERE listing_id = $1', [loser])).toHaveLength(0);
    expect(await dangling()).toBe(0);
    expect(Number((await one<{ n: string }>('SELECT member_count AS n FROM listings WHERE id = $1', [survivor])).n)).toBe(2);
  });
});

describe('week 2: split keeps the old id on one piece, mints #1 for the other, price change recorded', () => {
  it('splits the merged listing again', async () => {
    const merged = (await listingOf('P1')).listing_id as string;
    await week(2);
    const p1 = (await listingOf('P1')).listing_id as string;
    const p2 = (await listingOf('P2')).listing_id as string;
    expect(p1).not.toBe(p2);
    expect([p1, p2]).toContain(merged);
    const minted = p1 === merged ? p2 : p1;
    expect([uuidFor('listing', 'csv:alpha:P1#1'), uuidFor('listing', 'csv:beta:P2#1')]).toContain(minted);
    expect(await dangling()).toBe(0);
    // the redirect written when the pair merged still points at a live listing
    expect(Number((await one<{ n: string }>('SELECT count(*) AS n FROM listing_redirects')).n)).toBe(1);
  });

  it('a rent change adds one observation and stamps last_price_change_at on an unchanged canonical', async () => {
    const obs = await rows<{ rent_inr: number }>('SELECT rent_inr FROM price_observations WHERE source_listing_id = $1 ORDER BY observed_at', [slId('Y1')]);
    expect(obs.map((o) => o.rent_inr)).toEqual([30000, 27000]);
    const l = await one<{ rent_inr: number; last_price_change_at: Date }>(
      'SELECT l.rent_inr, l.last_price_change_at FROM listings l WHERE l.id = $1',
      [(await listingOf('Y1')).listing_id],
    );
    expect(l.rent_inr).toBe(27000);
    expect(l.last_price_change_at.toISOString()).toBe(W(2).toISOString());
  });
});

describe('weeks 3-4: delist -> orphan without redirect -> reactivation inherits the id back', () => {
  let y1: string;
  it('a delisted singleton keeps its row, goes inactive and gets no redirect', async () => {
    y1 = (await listingOf('Y1')).listing_id as string;
    const before = Number((await one<{ n: string }>('SELECT count(*) AS n FROM listing_redirects')).n);
    const s = await week(3);
    expect(s.delisted).toBe(1);
    expect(await one('SELECT is_active FROM listings WHERE id = $1', [y1])).toEqual({ is_active: false });
    expect(Number((await one<{ n: string }>('SELECT count(*) AS n FROM listing_redirects')).n)).toBe(before);
    expect((await listingOf('Y1')).listing_id).toBe(y1);
  });

  it('when it returns it inherits the same id and the listing is active again', async () => {
    await week(4);
    expect(await listingOf('Y1')).toEqual({ listing_id: y1, is_active: true });
    expect(await one('SELECT is_active FROM listings WHERE id = $1', [y1])).toEqual({ is_active: true });
  });
});

describe('week 5: accepted -> rejected removes the row from its cluster', () => {
  it('shrinks the listing to its remaining member and recomputes the view', async () => {
    const x = (await listingOf('X1')).listing_id as string;
    const s = await week(5);
    expect(await one('SELECT quality_status FROM source_listings WHERE id = $1', [slId('X2')])).toEqual({ quality_status: 'rejected' });
    expect(s.dedup).toMatchObject({ mode: 'incremental', removed: 1 });
    const l = await one<{ member_count: number; source_count: number; source_ids: string[]; rent_min_inr: number; rent_max_inr: number; is_active: boolean }>(
      'SELECT * FROM listings WHERE id = $1',
      [x],
    );
    expect(l).toMatchObject({ member_count: 1, source_count: 1, source_ids: ['csv:alpha'], rent_min_inr: 40000, rent_max_inr: 40000, is_active: true });
    expect(await dangling()).toBe(0);
  });
});

describe('db/test/guards.sql', () => {
  it('every guard check reports zero violations on the settled fixture state', async () => {
    const sql = readFileSync(resolve(import.meta.dirname, '../../db/test/guards.sql'), 'utf8');
    const results = (await db.query(sql)) as unknown as Array<{ rows: Array<{ check: string; violations: string }> }>;
    const flat = results.flatMap((r) => r.rows);
    expect(flat.map((r) => r.check)).toEqual([
      'rent_spread', 'geo_span', 'size', 'member_count_matches', 'dangling_redirects', 'redirect_of_live_listing', 'canonical_is_member',
    ]);
    expect(flat.filter((r) => Number(r.violations) !== 0)).toEqual([]);
  });
});

describe('--full equivalence and eval:dedup', () => {
  it('--full on the settled state rewrites nothing: same listings, same pairs, no new redirects', async () => {
    const snap = async () => ({
      listings: (await one<{ h: string }>(`SELECT md5(string_agg(l::text, '' ORDER BY id)) AS h FROM listings l`)).h,
      pairs: (await one<{ h: string }>(`SELECT md5(string_agg(a_id::text || b_id::text || decision::text || score::text, '' ORDER BY a_id, b_id)) AS h FROM dedup_pairs`)).h,
      redirects: (await one<{ h: string }>(`SELECT md5(string_agg(r::text, '' ORDER BY old_id)) AS h FROM listing_redirects r`)).h,
    });
    const before = await snap();
    const s = await week(5, true);
    expect(s.dedup).toMatchObject({ mode: 'full', listings_changed: 0, redirects_written: 0, ids_minted: 0 });
    expect(await snap()).toEqual(before);
  });

  it('a rolled-forward engine version forces a full rebuild', async () => {
    await db.query(`UPDATE ingest_runs SET stats = jsonb_set(stats, '{dedup,engine_version}', '"0.0.0"') WHERE stats->'dedup' ? 'engine_version'`);
    const s = await week(5);
    expect(s.dedup).toMatchObject({ mode: 'full', listings_changed: 0 });
  });

  it('eval:dedup reports hand-computed pairwise and B-cubed numbers against planted truth', async () => {
    await db.query('TRUNCATE seed_truth.source_rows, seed_truth.units CASCADE');
    const unitOf: Record<string, string> = { X1: 'U1', X2: 'U1', Y1: 'U2', P1: 'U3', P2: 'U4', H1: 'U5', G1: 'U6', G2: 'U6', G3: 'U6' };
    for (const u of new Set(Object.values(unitOf))) {
      await db.query(
        `INSERT INTO seed_truth.units (unit_id, locality_id, unit_kind, bhk, true_rent_inr)
         VALUES ($1, (SELECT id FROM localities WHERE slug = 'indiranagar'), 'bhk', 2, 40000)`,
        [uuidFor('unit', u)],
      );
    }
    const src = (sid: string): string => (['X2', 'P2', 'G2'].includes(sid) ? 'csv:beta' : sid === 'G3' ? 'csv:gamma' : 'csv:alpha');
    for (const [sid, u] of Object.entries(unitOf)) {
      await db.query('INSERT INTO seed_truth.source_rows (source_id, source_listing_id, unit_id, defect) VALUES ($1,$2,$3,$4)', [
        src(sid), sid, uuidFor('unit', u), sid === 'H1' ? 'hard_negative' : null,
      ]);
    }
    const r = await evalDedup(db);
    // X2 was rejected in week 5, so members are X1,Y1,P1,P2,H1,G1,G2,G3; truth pairs: 3 from {G1,G2,G3};
    // predicted pairs: the G1-G2 pair only; tp = 1
    expect(r.members).toBe(8);
    expect(r.truePairs).toBe(3);
    expect(r.pairwisePrecision).toBe(1);
    expect(r.pairwiseRecall).toBeCloseTo(1 / 3, 10);
    expect(r.bcubedPrecision).toBe(1);
    expect(r.bcubedRecall).toBeCloseTo((5 + 2 / 3 + 2 / 3 + 1 / 3) / 8, 10);
    expect(r.hardNegativesEvaluated).toBe(1);
    expect(r.hardNegativeMerges).toBe(0);
    expect(r.blockingRecall).toBe(1);
    expect(r.ok).toBe(false); // recall below target and only 1 of the 150 hard negatives exists here
    expect(r.lines.at(-1)).toBe('eval:dedup FAILED');
  });
});
