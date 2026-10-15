import { describe, expect, it } from 'vitest';
import { haversineKm } from '@roofline/engine';
import { generateSeed, summarize } from '../src/adapters/synthetic/generate';
import { DEFECT_COUNTS, SEED, SOURCES } from '../src/adapters/synthetic/params';
import { loadRefs } from './helpers/refs';

const refs = loadRefs();
const ds = generateSeed(refs);

// Portal names are assembled from pieces so this file itself passes the brand guard.
const BANNED = new RegExp(['no' + 'broker', 'magic' + 'bricks', 'nes' + 'taway', 'static' + 'mb', 'http', 'www\\.', '\\.com'].join('|'), 'i');

describe('synthetic generator: scale and determinism', () => {
  it('uses seed 20261001', () => expect(SEED).toBe(20261001));

  it('produces >= 6,400 source rows, >= 5,000 units and >= 6,400 rows over 26 weeks', () => {
    expect(ds.rows.length).toBeGreaterThanOrEqual(6400);
    expect(ds.units.length).toBeGreaterThanOrEqual(5000);
    expect(ds.weeks).toHaveLength(26);
    expect(ds.weeks[0]).toBe('2026-04-09T00:00:00.000Z');
    expect(ds.weeks[25]).toBe('2026-10-01T00:00:00.000Z');
  });

  it('is identical across two generations and differs for another seed', () => {
    expect(summarize(generateSeed(refs))).toEqual(summarize(ds));
    expect(JSON.stringify(generateSeed(refs).rows.slice(0, 50))).toBe(JSON.stringify(ds.rows.slice(0, 50)));
    expect(summarize(generateSeed(refs, { seed: 1 }))).not.toEqual(summarize(ds));
  });

  it('first 5 rows and aggregate counts are stable (snapshot)', () => {
    expect(ds.rows.slice(0, 5).map((r) => ({ id: r.sourceListingId, src: r.sourceId, v0: r.versions[0]?.listing }))).toMatchSnapshot('first-5-rows');
    expect(summarize(ds)).toMatchSnapshot('aggregates');
  });
});

describe('synthetic generator: coverage and realism', () => {
  it('covers all 69 localities', () => {
    expect(new Set(ds.units.map((u) => u.localitySlug)).size).toBe(69);
  });

  it('uses only the fictional sources from the reference data', () => {
    expect(new Set(ds.rows.map((r) => r.sourceId))).toEqual(new Set(SOURCES.map((s) => s.sourceId)));
  });

  it('has roughly the planned flat/PG split and source multiplicity', () => {
    const s = summarize(ds);
    expect(s.pgUnits).toBeGreaterThan(1000);
    expect(s.pgUnits).toBeLessThan(1500);
    expect(s.flatUnits).toBeGreaterThan(3800);
    const perUnit = s.rowsPerUnit;
    expect(perUnit[1]! / s.units).toBeGreaterThan(0.75);
    expect(perUnit[1]! / s.units).toBeLessThan(0.85);
    expect(perUnit[2]! / s.units).toBeGreaterThan(0.12);
    expect(perUnit[3]! / s.units).toBeGreaterThan(0.02);
  });

  it('PG rows carry sharing, food and gender text', () => {
    const pg = ds.rows.filter((r) => ds.units[r.unitIdx]!.kind === 'pg' && !r.defect);
    expect(pg.length).toBeGreaterThan(1000);
    for (const r of pg.slice(0, 200)) {
      const l = r.versions[0]!.listing;
      expect(l.pg?.sharingText).toBeTruthy();
      expect(l.pg?.foodText).toBeTruthy();
      expect(l.pg?.genderText).toBeTruthy();
    }
  });

  it('flat rents follow the pricing model: 3 BHK median > 2 BHK median > 1 BHK median', () => {
    const med = (bhk: number) => {
      const xs = ds.units.filter((u) => u.kind === 'flat' && u.bhk === bhk).map((u) => u.trueRent);
      xs.sort((a, b) => a - b);
      return xs[Math.floor(xs.length / 2)]!;
    };
    expect(med(3)).toBeGreaterThan(med(2));
    expect(med(2)).toBeGreaterThan(med(1));
    expect(med(1)).toBeGreaterThan(med(0));
  });

  it('plants near-duplicate rows of one unit across different sources', () => {
    const byUnit = new Map<number, string[]>();
    for (const r of ds.rows) byUnit.set(r.unitIdx, [...(byUnit.get(r.unitIdx) ?? []), r.sourceId]);
    const multi = [...byUnit.values()].filter((s) => s.length >= 2);
    expect(multi.length).toBeGreaterThan(800);
    for (const s of multi) expect(new Set(s).size).toBe(s.length);
  });

  it('plants 150 hard-negative pairs: same building, same BHK, rent within 5%, different floors and photos', () => {
    expect(ds.hardNegatives).toHaveLength(150);
    for (const [a, b] of ds.hardNegatives) {
      const ua = ds.units[a]!;
      const ub = ds.units[b]!;
      expect(haversineKm(ua, ub) * 1000).toBeLessThanOrEqual(30);
      expect(ub.bhk).toBe(ua.bhk);
      expect(ub.floor).not.toBe(ua.floor);
      const rowA = ds.rows.find((r) => r.unitIdx === a)!;
      const rowB = ds.rows.find((r) => r.unitIdx === b)!;
      const ra = rowA.versions[0]!.listing;
      const rb = rowB.versions[0]!.listing;
      expect(Math.abs(rowB.versions[0]!.rentInr / rowA.versions[0]!.rentInr - 1)).toBeLessThanOrEqual(0.05);
      const seedsA = new Set((ra.photos ?? []).map((p) => p.seed));
      expect((rb.photos ?? []).some((p) => seedsA.has(p.seed))).toBe(false);
    }
  });
});

describe('synthetic generator: planted defects', () => {
  const count = (d: string) => ds.rows.filter((r) => r.defect === d).length;

  it.each(Object.entries(DEFECT_COUNTS))('plants exactly the planned number of %s rows', (defect, n) => {
    expect(count(defect)).toBe(n);
  });

  it('writes the defect text the pipeline must cope with', () => {
    const first = (d: string) => ds.rows.find((r) => r.defect === d)!.versions[0]!.listing;
    expect(['₹1', '1']).toContain(first('rent_one').rentText);
    expect(first('locality_from_nogeo').localityText).toBe('From');
    expect(first('locality_from_nogeo').lat).toBeUndefined();
    expect(first('locality_from_geo').lat).toBeDefined();
    expect(first('empty_locality_geo').localityText).toBe('');
    expect(first('empty_locality_geo').lat).toBeDefined();
    expect(first('furnishing_invalid').furnishingText).toBe('11901');
    expect(first('geo_zero')).toMatchObject({ lat: 0, lng: 0 });
    expect(first('area_zero').areaText).toBe('0');
    expect(first('area_huge').areaText).toBe('99,999');
  });

  it('keeps defect rows inside the initial cohort so counts do not grow weekly', () => {
    for (const r of ds.rows) if (r.defect) expect(r.startWeek).toBe(0);
  });

  it('plants 80ish deals plus exactly 10 too_good rows at x0.30', () => {
    const tooGood = ds.units.filter((u) => u.deal?.kind === 'too_good');
    expect(tooGood).toHaveLength(10);
    for (const u of tooGood) expect(u.deal?.multiplier).toBe(0.3);
    const deals = ds.units.filter((u) => u.deal?.kind === 'deal');
    expect(deals.length).toBeGreaterThan(60);
    for (const u of deals) {
      expect(u.deal!.multiplier).toBeGreaterThanOrEqual(0.6);
      expect(u.deal!.multiplier).toBeLessThanOrEqual(0.78);
    }
  });
});

describe('synthetic generator: no real portal names or URLs', () => {
  it('payloads never mention a portal, a URL scheme or a domain', () => {
    for (const r of ds.rows) for (const v of r.versions) expect(JSON.stringify(v.listing)).not.toMatch(BANNED);
  });

  it('never sets the optional url field', () => {
    expect(ds.rows.some((r) => r.versions.some((v) => v.listing.url !== undefined))).toBe(false);
  });

  it('photo seeds satisfy the plate route pattern', () => {
    for (const r of ds.rows.slice(0, 500)) for (const p of r.versions[0]!.listing.photos ?? []) expect(p.seed).toMatch(/^[a-z0-9-]{1,64}$/);
  });
});
