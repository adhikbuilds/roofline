/**
 * Deterministic synthetic Bangalore rental market (PLAN section 4.4). The whole 26-week timeline is
 * generated once, up front, from a single mulberry32 stream; weekly and per-source views are pure lookups.
 * Pure: no clock, no I/O. Everything it emits is fictional.
 */
import { buildBaseline, buildLocalityIndex, checkOutlier, normLocality, resolveLocality, type QualityRow } from '@roofline/engine';
import type { RawListing } from '../../adapter';
import { uuidFor } from '../../ids';
import * as P from './params';
import type { DefectKind, SourceKey } from './params';
import { Rng } from './rng';
import { bhkLabel, pickFurnishingText, render, type RowSpec } from './render';

export interface LocalityRef {
  slug: string;
  name: string;
  zone: string;
  lat: number;
  lng: number;
  radiusM: number;
  base2bhk: number | null;
}
export interface AliasRef {
  alias: string;
  slug: string;
}
export interface SeedRefs {
  localities: LocalityRef[];
  aliases: AliasRef[];
}

export interface SeedUnit {
  idx: number;
  id: string;
  localitySlug: string;
  zone: string;
  kind: 'flat' | 'pg';
  unitKind: 'rk' | 'bhk' | 'pg_bed';
  bhk: number;
  areaSqft: number | null;
  furnishing: 'furnished' | 'semi' | 'unfurnished' | null;
  sharing: string | null;
  gender: string | null;
  food: boolean | null;
  lat: number;
  lng: number;
  floor: number | null;
  totalFloors: number | null;
  facing: string | null;
  parking: string | null;
  tags: string[];
  photos: { seed: string; dhash: string }[];
  /** Unit rent before drift (rupees, float). */
  baseRent: number;
  /** True expected rent in the unit's first week. */
  trueRent: number;
  startWeek: number;
  endWeek: number;
  deal?: { kind: 'deal' | 'too_good'; multiplier: number };
}

export interface SeedRowVersion {
  fromWeek: number;
  rentInr: number;
  listing: RawListing;
}
export interface SeedRow {
  sourceKey: SourceKey;
  sourceId: string;
  sourceListingId: string;
  unitIdx: number;
  startWeek: number;
  endWeek: number;
  defect: DefectKind | null;
  versions: SeedRowVersion[];
  spec: RowSpec;
}
export interface SeedDataset {
  seed: number;
  weeks: string[];
  units: SeedUnit[];
  rows: SeedRow[];
  hardNegatives: Array<[number, number]>;
}

export const driftAt = (week: number): number => Math.pow(1 + P.DRIFT_PER_MONTH, (week * 7) / 30.4375);
export const round500 = (x: number): number => Math.round(x / 500) * 500;
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

const FACINGS = ['east', 'west', 'north', 'south', 'north east', 'south west', 'north west', 'south east'] as const;
const PARKING = ['bike', 'car', 'bike & car', 'none'] as const;
const TAGS = ['Non-veg OK', 'Corporation water', 'Borewell', 'Power backup', 'Lift', 'Gated'] as const;
const ADJ = ['Spacious', 'Well-ventilated', 'Bright', 'Modern', 'Cozy', 'Newly painted', 'Airy'];
const SHARING_WEIGHTS = [0.15, 0.4, 0.3, 0.15];
const SHARING_TEXT: Record<string, string[]> = {
  single: ['Single sharing', 'Single occupancy', 'Private room'],
  double: ['2 sharing', 'Double sharing', 'Twin sharing'],
  triple: ['3 sharing', 'Triple sharing'],
  quad: ['4 sharing', 'Quad sharing'],
};
const GENDER_TEXT: Record<string, string[]> = {
  male: ['Gents', 'Boys', 'Male'],
  female: ['Ladies', 'Girls', 'Female'],
  coed: ['Unisex', 'Co-living'],
};
const GENDER_TITLE: Record<string, string> = { male: 'Boys', female: 'Ladies', coed: 'Co-living' };
const FOOD_YES = ['Food included', 'With food', 'Meals included'];
const FOOD_NO = ['No food', 'Food not included', 'Without food'];
const PROSE_FLAT = [
  'Well maintained home close to markets and transit.',
  'Quiet street, good sunlight and cross ventilation.',
  'Ready to move in, owner is flexible on the date.',
  'Walkable to groceries, cafes and the metro.',
  'Reserved parking and round-the-clock security.',
];
const PROSE_PG = [
  'Clean rooms, weekly housekeeping and fast wifi.',
  'Comfortable beds, laundry and a warden on site.',
  'Short walk to offices and public transport.',
  'Power backup, RO water and CCTV in common areas.',
];

function newHash(rng: Rng): string {
  const hi = BigInt(rng.int(0, 0xffffffff));
  const lo = BigInt(rng.int(0, 0xffffffff));
  return ((hi << 32n) | lo).toString(16).padStart(16, '0');
}
function flipBits(hex: string, n: number, rng: Rng): string {
  let x = BigInt(`0x${hex}`);
  const used = new Set<number>();
  while (used.size < n) used.add(rng.int(0, 63));
  for (const b of used) x ^= 1n << BigInt(b);
  return x.toString(16).padStart(16, '0');
}

function offsetMeters(lat: number, lng: number, dxM: number, dyM: number): { lat: number; lng: number } {
  return { lat: r6(lat + dyM / 111_320), lng: r6(lng + dxM / (111_320 * Math.cos((lat * Math.PI) / 180))) };
}
function jitterWithin(rng: Rng, lat: number, lng: number, maxM: number): { lat: number; lng: number } {
  const d = maxM * Math.sqrt(rng.float());
  const a = rng.uniform(0, 2 * Math.PI);
  return offsetMeters(lat, lng, d * Math.cos(a), d * Math.sin(a));
}

function typo(rng: Rng, s: string): string {
  if (s.length < 5) return s;
  const i = rng.int(1, s.length - 3);
  return rng.chance(0.5) ? s.slice(0, i) + s.slice(i + 1) : s.slice(0, i) + (s[i + 1] ?? '') + (s[i] ?? '') + s.slice(i + 2);
}
const titleCase = (s: string): string => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Smallest base cohort whose 26-week simulation reaches the unit target. */
function pickInitialCohort(target: number): number {
  const total = (n0: number): number => {
    let active = n0;
    let all = n0;
    for (let w = 1; w < P.WEEKS; w++) {
      const add = Math.round(P.WEEKLY_NEW * active);
      all += add;
      active += add - Math.round(P.WEEKLY_DELIST * active);
    }
    return all;
  };
  let n = 1000;
  while (total(n) < target) n += 10;
  while (total(n - 1) >= target) n -= 1;
  return n;
}

export function generateSeed(refs: SeedRefs, opts: { seed?: number } = {}): SeedDataset {
  const seed = opts.seed ?? P.SEED;
  const rng = new Rng(seed);
  const weeks = Array.from({ length: P.WEEKS }, (_, w) => P.weekAsOf(w).toISOString());

  // Sorted so the output never depends on the order the caller loaded reference data in.
  const locs = [...refs.localities].sort((a, b) => a.slug.localeCompare(b.slug));
  const locBySlug = new Map(locs.map((l) => [l.slug, l]));
  const aliasesBySlug = new Map<string, string[]>();
  for (const a of [...refs.aliases].sort((x, y) => x.alias.localeCompare(y.alias))) aliasesBySlug.set(a.slug, [...(aliasesBySlug.get(a.slug) ?? []), a.alias]);
  const index = buildLocalityIndex(locs.map((l) => ({ id: l.slug, name: l.name, aliases: aliasesBySlug.get(l.slug) ?? [] })));
  const canonicalOk = new Map(locs.map((l) => [l.slug, resolveLocality(l.name, index).id === l.slug]));

  // Zipf-ish locality popularity so the busiest cells are dense enough for the MAD test.
  const ranks = rng.shuffle(locs.map((_, i) => i));
  const locWeights = locs.map((_, i) => 1 / Math.pow(ranks.indexOf(i) + 1, 0.7));

  // ---- timeline: who is listed in which week -------------------------------------------------
  const baseTarget = P.TARGET_UNITS - P.HARD_NEGATIVE_PAIRS;
  const n0 = pickInitialCohort(baseTarget);
  const windows: Array<{ start: number; end: number }> = [];
  const active: number[] = [];
  for (let i = 0; i < n0; i++) {
    windows.push({ start: 0, end: P.WEEKS - 1 });
    active.push(i);
  }
  let liveCount = active.length;
  for (let w = 1; w < P.WEEKS; w++) {
    const del = Math.round(P.WEEKLY_DELIST * liveCount);
    const add = Math.round(P.WEEKLY_NEW * liveCount);
    const pool = rng.shuffle(active.filter((i) => (windows[i] as { end: number }).end === P.WEEKS - 1));
    for (const i of pool.slice(0, del)) (windows[i] as { end: number }).end = w - 1;
    for (let k = 0; k < add; k++) {
      windows.push({ start: w, end: P.WEEKS - 1 });
      active.push(windows.length - 1);
    }
    liveCount += add - del;
  }

  // ---- units and rows --------------------------------------------------------------------------
  const units: SeedUnit[] = [];
  const rows: SeedRow[] = [];
  const counters = new Map<SourceKey, number>();
  const nextId = (s: (typeof P.SOURCES)[number]): string => {
    const n = (counters.get(s.key) ?? 0) + 1;
    counters.set(s.key, n);
    return `${s.prefix}-${String(n).padStart(6, '0')}`;
  };

  const makePhotos = (unitIdx: number): { seed: string; dhash: string }[] =>
    Array.from({ length: rng.int(3, 9) }, (_, i) => ({ seed: `u${unitIdx.toString(36)}-${i}`, dhash: newHash(rng) }));

  const localityText = (loc: LocalityRef, geoPresent: boolean): { text: string; needsGeo: boolean } => {
    const canon = { text: loc.name, needsGeo: !canonicalOk.get(loc.slug) };
    const verified = (t: string): { text: string; needsGeo: boolean } =>
      resolveLocality(t, index).id === loc.slug ? { text: t, needsGeo: false } : canon;
    const r = rng.float();
    if (r < 0.62) return canon;
    if (r < 0.76) return canonicalOk.get(loc.slug) ? { text: `${loc.name}, ${rng.pick(['Bangalore', 'Bengaluru'])}`, needsGeo: false } : canon;
    if (r < 0.8) return canonicalOk.get(loc.slug) ? { text: loc.name.toUpperCase(), needsGeo: false } : canon;
    if (r < 0.9) {
      const al = aliasesBySlug.get(loc.slug);
      return al && al.length > 0 ? verified(titleCase(rng.pick(al))) : canon;
    }
    if (r < 0.96) return geoPresent || canonicalOk.get(loc.slug) ? verified(typo(rng, loc.name)) : canon;
    const suffix = rng.pick(['2nd Stage', 'Phase 2', 'Sector 3', '4th Block']);
    const t = `${loc.name} ${suffix}`;
    return normLocality(t) === normLocality(loc.name) ? verified(t) : canon;
  };

  for (let i = 0; i < windows.length; i++) {
    const win = windows[i] as { start: number; end: number };
    const loc = locs[rng.weightedIndex(locWeights)] as LocalityRef;
    const isPg = rng.chance(P.PG_UNIT_SHARE);
    const sigma = loc.radiusM / 2;
    let dx = rng.normal() * sigma;
    let dy = rng.normal() * sigma;
    const dist = Math.hypot(dx, dy);
    if (dist > loc.radiusM) {
      dx *= loc.radiusM / dist;
      dy *= loc.radiusM / dist;
    }
    const geo = offsetMeters(loc.lat, loc.lng, dx, dy);
    const bldg = Math.exp(P.BUILDING_SD * rng.clippedNormal(P.NOISE_CLIP));
    const drift0 = driftAt(win.start);
    let unit: SeedUnit;
    if (isPg) {
      const si = rng.weightedIndex(SHARING_WEIGHTS);
      const [sharing, mult] = P.PG_SHARING[si] as readonly [string, number];
      const food = rng.chance(P.PG_FOOD_SHARE);
      const gender = rng.weighted(P.PG_GENDER_WEIGHTS.map((g) => g[0]), P.PG_GENDER_WEIGHTS.map((g) => g[1]));
      const baseRent = ((P.PG_BASE_SINGLE[loc.zone] ?? 12000) * mult + (food ? P.PG_FOOD_INR : 0)) * bldg;
      unit = {
        idx: i, id: uuidFor('unit', String(i)), localitySlug: loc.slug, zone: loc.zone, kind: 'pg', unitKind: 'pg_bed', bhk: 0,
        areaSqft: null, furnishing: null, sharing, gender, food, ...geo, floor: null, totalFloors: null, facing: null,
        parking: null, tags: [], photos: makePhotos(i), baseRent, trueRent: Math.round(baseRent * drift0),
        startWeek: win.start, endWeek: win.end,
      };
    } else {
      const bhk = rng.weighted(P.BHK_WEIGHTS.map((b) => b[0]), P.BHK_WEIGHTS.map((b) => b[1]));
      const furn = rng.weighted(P.FURN_WEIGHTS.map((f) => f[0]), P.FURN_WEIGHTS.map((f) => f[1]));
      const typ = P.TYP_AREA[bhk] as number;
      const area = Math.max(150, Math.round(typ * (1 + P.AREA_SD * rng.clippedNormal(2.5))));
      const baseRent =
        (loc.base2bhk ?? 35000) * (P.BHK_MULT[bhk] as number) * P.FURN_MULT[furn] * Math.pow(area / typ, P.AREA_EXPONENT) * bldg;
      const totalFloors = rng.int(2, 20);
      unit = {
        idx: i, id: uuidFor('unit', String(i)), localitySlug: loc.slug, zone: loc.zone, kind: 'flat',
        unitKind: bhk === 0 ? 'rk' : 'bhk', bhk, areaSqft: area, furnishing: furn, sharing: null, gender: null, food: null,
        ...geo, floor: rng.int(0, totalFloors), totalFloors, facing: rng.pick(FACINGS), parking: rng.pick(PARKING),
        tags: TAGS.filter(() => rng.chance(0.4)), photos: makePhotos(i), baseRent, trueRent: Math.round(baseRent * drift0),
        startWeek: win.start, endWeek: win.end,
      };
    }
    units.push(unit);

    const nSources = 1 + rng.weightedIndex([...P.SOURCE_COUNT_WEIGHTS]);
    const eligible = P.SOURCES.filter((s) => (isPg ? s.pgWeight > 0 : s.flatWeight > 0));
    const chosen = rng.weightedSample(eligible, eligible.map((s) => (isPg ? s.pgWeight : s.flatWeight)), nSources);
    const noise = Math.exp(P.NOISE_SD * rng.clippedNormal(P.NOISE_CLIP));
    chosen.forEach((src, j) => {
      rows.push(buildRow(unit, src, j, noise));
    });
  }

  function buildRow(unit: SeedUnit, src: (typeof P.SOURCES)[number], j: number, noise: number, forced?: { rent: number; geoPresent: boolean }): SeedRow {
    const loc = locBySlug.get(unit.localitySlug) as LocalityRef;
    const variantRent = j === 0 ? 1 : rng.uniform(0.95, 1.05);
    const rentInr = forced?.rent ?? round500(unit.trueRent * noise * variantRent * src.rentSkew);
    const geoPresent = forced?.geoPresent ?? !rng.chance(src.geoMissing);
    const geo = j === 0 ? { lat: unit.lat, lng: unit.lng } : jitterWithin(rng, unit.lat, unit.lng, 120);
    const loct = localityText(loc, geoPresent);
    const showGeo = geoPresent || loct.needsGeo;
    const photos = rowPhotos(unit, j);
    const dep = (() => {
      if (rng.chance(src.depositMissing)) return null;
      const months = unit.kind === 'pg' ? rng.int(1, 2) : rng.weighted(P.DEPOSIT_MONTHS.map((d) => d[0]), P.DEPOSIT_MONTHS.map((d) => d[1]));
      return rng.chance(0.6) ? { months } : { abs: months * rentInr };
    })();
    const area = unit.areaSqft == null ? null : rng.chance(j === 0 ? 0.03 : 0.1) ? null : Math.round(unit.areaSqft * (j === 0 ? 1 : rng.uniform(0.97, 1.03)));
    const style = rng.int(0, 4);
    const areaStyle = rng.weighted([0, 1, 2, 3, 4], [0.5, 0.35, 0.06, 0.03, 0.06]);
    const bhkStyle = rng.weighted([0, 1, 2], [0.5, 0.3, 0.2]);
    const furnText = unit.furnishing ? pickFurnishingText(rng, unit.furnishing) : undefined;
    const startWeek = unit.startWeek;
    const posted = new Date(P.weekAsOf(startWeek).getTime() - rng.int(0, 6) * 86_400_000).toISOString();
    const id = nextId(src);
    const pgSpec = unit.kind === 'pg'
      ? {
          sharingText: rng.pick(SHARING_TEXT[unit.sharing as string] as string[]),
          foodText: rng.pick(unit.food ? FOOD_YES : FOOD_NO),
          genderText: rng.pick(GENDER_TEXT[unit.gender as string] as string[]),
        }
      : undefined;
    const lname = loc.name;
    const title = unit.kind === 'pg'
      ? rng.pick([
          `${GENDER_TITLE[unit.gender as string]} PG in ${lname}`,
          `PG for ${GENDER_TITLE[unit.gender as string]?.toLowerCase()} in ${lname} - ${unit.sharing} room`,
          `${rng.pick(ADJ)} paying guest accommodation, ${lname}`,
        ])
      : rng.pick([
          `${rng.pick(ADJ)} ${bhkLabel(unit.bhk, 0)} ${unit.bhk >= 2 && rng.chance(0.1) ? 'house' : 'flat'} for rent in ${lname}`,
          `${bhkLabel(unit.bhk, 0)} apartment available in ${lname}`,
          `${bhkLabel(unit.bhk, 0)} ${rng.pick(['flat', 'apartment'])} - ${lname}`,
        ]);
    const spec: RowSpec = {
      sourceListingId: id,
      freeTextOnly: src.freeTextOnly,
      postedAt: posted,
      title,
      prose: rng.pick(unit.kind === 'pg' ? PROSE_PG : PROSE_FLAT),
      kind: unit.kind,
      bhk: unit.bhk,
      rentInr,
      rentStyle: style,
      deposit: dep,
      maintenance: unit.kind === 'flat' && rng.chance(0.45) ? round500(((unit.areaSqft as number) * rng.uniform(2, 4)) / 1) : null,
      areaSqft: area,
      areaStyle,
      furnishingKey: unit.furnishing,
      furnishingText: furnText,
      localityText: loct.text,
      lat: showGeo ? geo.lat : null,
      lng: showGeo ? geo.lng : null,
      floor: unit.floor,
      totalFloors: unit.totalFloors,
      facingText: unit.facing,
      parkingText: unit.parking,
      tags: unit.tags.filter(() => j === 0 || rng.chance(0.8)),
      photos,
      pg: pgSpec,
      bhkText: unit.kind === 'pg' ? 'PG' : bhkLabel(unit.bhk, bhkStyle),
    };
    return {
      sourceKey: src.key, sourceId: src.sourceId, sourceListingId: id, unitIdx: unit.idx,
      startWeek: unit.startWeek, endWeek: unit.endWeek, defect: null,
      versions: [{ fromWeek: unit.startWeek, rentInr, listing: render(spec) }], spec,
    };
  }

  function rowPhotos(unit: SeedUnit, j: number): { seed: string; dhash: string }[] {
    if (j === 0) return unit.photos.map((p) => ({ ...p }));
    const target = Math.max(3, Math.min(9, unit.photos.length + rng.int(-2, 2)));
    const kept = rng.shuffle(unit.photos).slice(0, target).map((p) => ({ seed: p.seed, dhash: flipBits(p.dhash, rng.int(0, 4), rng) }));
    for (let k = kept.length; k < target; k++) kept.push({ seed: `u${unit.idx.toString(36)}-x${j}${k}`, dhash: newHash(rng) });
    return kept;
  }

  const rerender = (row: SeedRow): void => {
    (row.versions[0] as SeedRowVersion).listing = render(row.spec);
    (row.versions[0] as SeedRowVersion).rentInr = row.spec.rentInr;
  };

  // ---- planted deals, defects and hard negatives (week-0 cohort only) ----------------------------
  const locNo = new Map(locs.map((l, i) => [l.slug, i + 1]));
  const qrowOf = (r: SeedRow, rentInr: number): QualityRow => {
    const u = units[r.unitIdx] as SeedUnit;
    return {
      kind: u.kind, bhk: u.kind === 'flat' ? u.bhk : null, rentInr,
      areaSqft: r.spec.areaTextOverride === '0' ? null : r.spec.areaSqft, localityId: locNo.get(u.localitySlug) as number,
      zone: u.zone, pgSharing: u.sharing, lat: null, lng: null,
    };
  };
  const rowsByUnit = new Map<number, SeedRow[]>();
  for (const r of rows) rowsByUnit.set(r.unitIdx, [...(rowsByUnit.get(r.unitIdx) ?? []), r]);
  const used = new Set<string>();
  const usedUnits = new Set<number>();
  const owner = (r: SeedRow): boolean => r.sourceKey === 'gulmohar';
  const week0Flat = rows.filter((r) => r.startWeek === 0 && (units[r.unitIdx] as SeedUnit).kind === 'flat');
  const cellKey = (r: SeedRow): string => {
    const u = units[r.unitIdx] as SeedUnit;
    return `${u.localitySlug}|${u.bhk}`;
  };
  const cells = new Map<string, number[]>();
  for (const r of week0Flat) cells.set(cellKey(r), [...(cells.get(cellKey(r)) ?? []), r.spec.rentInr]);
  const cellMedian = (k: string): number => {
    const xs = [...(cells.get(k) ?? [])].sort((a, b) => a - b);
    return xs[Math.floor(xs.length / 2)] ?? 0;
  };
  const dense = (r: SeedRow): boolean => (cells.get(cellKey(r))?.length ?? 0) >= 12;
  const free = (r: SeedRow): boolean => !used.has(r.sourceListingId) && !usedUnits.has(r.unitIdx);
  const take = (pool: SeedRow[], n: number, label: DefectKind, apply: (r: SeedRow) => void, onePerCell = false): void => {
    const shuffled = rng.shuffle(pool.filter(free));
    const cellsUsed = new Set<string>();
    let got = 0;
    for (const r of shuffled) {
      if (got >= n) break;
      if (onePerCell) {
        if (cellsUsed.has(cellKey(r))) continue;
        cellsUsed.add(cellKey(r));
      }
      r.defect = label;
      used.add(r.sourceListingId);
      apply(r);
      rerender(r);
      got++;
    }
    if (got < n) throw new Error(`generator: only found ${got}/${n} eligible rows for ${label}`);
  };
  const single = (r: SeedRow): boolean => (rowsByUnit.get(r.unitIdx) ?? []).length === 1;
  const complete = (r: SeedRow): boolean =>
    r.spec.areaSqft != null && r.spec.deposit != null && r.spec.lat != null && !owner(r) && resolveLocality(r.spec.localityText, index).method === 'exact';

  // too_good (x0.30): dense 2/3 BHK cells so the locality MAD test applies
  const tooGoodPool = week0Flat.filter((r) => single(r) && complete(r) && dense(r) && ((units[r.unitIdx] as SeedUnit).bhk === 2 || (units[r.unitIdx] as SeedUnit).bhk === 3));
  {
    const seenCells = new Set<string>();
    const pre = buildBaseline(rows.filter((r) => r.startWeek === 0).map((r) => qrowOf(r, r.spec.rentInr)));
    let g = 0;
    for (const r of rng.shuffle(tooGoodPool)) {
      if (g >= P.TOO_GOOD_COUNT) break;
      if (seenCells.has(cellKey(r))) continue;
      const u = units[r.unitIdx] as SeedUnit;
      // only cells where x0.30 is a clear MAD outlier (z well past -4), not a marginal one
      const z = checkOutlier(pre, qrowOf(r, round500(u.trueRent * P.TOO_GOOD_MULT))).z ?? 0;
      if (z > -4.6) continue;
      seenCells.add(cellKey(r));
      u.deal = { kind: 'too_good', multiplier: P.TOO_GOOD_MULT };
      r.defect = 'too_good';
      r.spec.rentInr = round500(u.trueRent * P.TOO_GOOD_MULT);
      rerender(r);
      used.add(r.sourceListingId);
      usedUnits.add(u.idx);
      g++;
    }
    if (g < P.TOO_GOOD_COUNT) throw new Error('generator: not enough dense cells for too_good rows');
  }
  // genuine deals (2% of flat units): complete data, rent = truth x U(0.60, 0.78)
  {
    const flatUnits = units.filter((u) => u.kind === 'flat').length;
    const want = Math.round(P.DEAL_SHARE * flatUnits);
    const pool = rng.shuffle(week0Flat.filter((r) => single(r) && complete(r) && free(r) && dense(r)));
    let g = 0;
    for (const r of pool) {
      if (g >= want) break;
      const u = units[r.unitIdx] as SeedUnit;
      const mult = Math.round(rng.uniform(P.DEAL_MULT[0], P.DEAL_MULT[1]) * 100) / 100;
      u.deal = { kind: 'deal', multiplier: mult };
      r.spec.rentInr = round500(u.trueRent * mult);
      rerender(r);
      usedUnits.add(u.idx);
      used.add(r.sourceListingId);
      g++;
    }
  }

  const structured = (r: SeedRow): boolean => !owner(r);
  const regular = week0Flat.filter((r) => structured(r) && !used.has(r.sourceListingId));
  const week0All = rows.filter((r) => r.startWeek === 0 && structured(r));
  const ratio = (r: SeedRow): number => r.spec.rentInr / cellMedian(cellKey(r));

  take(regular.filter((r) => dense(r) && ratio(r) >= 1.05 && ratio(r) <= 1.12 && r.spec.rentInr * 12 <= 900_000), P.DEFECT_COUNTS.rent_annual, 'rent_annual', (r) => {
    r.spec.rentTextOverride = String(r.spec.rentInr * 12);
  }, true);
  take(regular.filter((r) => dense(r) && ratio(r) >= 0.9 && ratio(r) <= 1.1 && r.spec.rentInr % 500 === 0), P.DEFECT_COUNTS.rent_lakh, 'rent_lakh', (r) => {
    r.spec.rentTextOverride = String(r.spec.rentInr / 1000);
  }, true);
  take(week0All, P.DEFECT_COUNTS.rent_one, 'rent_one', (r) => {
    r.spec.rentTextOverride = rng.pick(['₹1', '1']);
  });
  const hasGeo = (r: SeedRow): boolean => r.spec.lat != null;
  const exact = (r: SeedRow): boolean => resolveLocality(r.spec.localityText, index).method === 'exact';
  take(week0All, P.DEFECT_COUNTS.locality_from_nogeo, 'locality_from_nogeo', (r) => {
    r.spec.localityText = 'From';
    r.spec.lat = null;
    r.spec.lng = null;
  });
  take(week0All.filter(hasGeo), P.DEFECT_COUNTS.locality_from_geo, 'locality_from_geo', (r) => {
    r.spec.localityText = 'From';
  });
  take(week0All, P.DEFECT_COUNTS.locality_bangalore_nogeo, 'locality_bangalore_nogeo', (r) => {
    r.spec.localityText = 'Bangalore';
    r.spec.lat = null;
    r.spec.lng = null;
  });
  take(week0All.filter(hasGeo), P.DEFECT_COUNTS.locality_bangalore_geo, 'locality_bangalore_geo', (r) => {
    r.spec.localityText = 'Bangalore';
  });
  take(week0All.filter(hasGeo), P.DEFECT_COUNTS.empty_locality_geo, 'empty_locality_geo', (r) => {
    r.spec.localityText = '';
  });
  take(regular, P.DEFECT_COUNTS.furnishing_invalid, 'furnishing_invalid', (r) => {
    r.spec.furnishingTextOverride = '11901';
  });
  take(regular.filter((r) => r.spec.areaSqft != null), P.DEFECT_COUNTS.area_zero, 'area_zero', (r) => {
    r.spec.areaTextOverride = '0';
  });
  take(regular.filter((r) => r.spec.areaSqft != null), P.DEFECT_COUNTS.area_huge, 'area_huge', (r) => {
    r.spec.areaTextOverride = '99,999';
  });
  take(week0All.filter(exact), P.DEFECT_COUNTS.geo_zero, 'geo_zero', (r) => {
    r.spec.lat = 0;
    r.spec.lng = 0;
  });

  // hard negatives: a distinct unit in the same building, <= 30 m away, same BHK, rent within 5%,
  // different floor and different photos. Single source, same source as the anchor's primary row.
  const hardNegatives: Array<[number, number]> = [];
  {
    const anchors = rng.shuffle(
      week0Flat.filter((r) => structured(r) && free(r) && r.spec.rentInr >= 20_000 && r.spec.lat != null && r.spec.lat !== 0 && (rowsByUnit.get(r.unitIdx) as SeedRow[])[0] === r),
    );
    for (const a of anchors) {
      if (hardNegatives.length >= P.HARD_NEGATIVE_PAIRS) break;
      const ua = units[a.unitIdx] as SeedUnit;
      const src = P.SOURCES.find((s) => s.key === a.sourceKey) as (typeof P.SOURCES)[number];
      const idx = units.length;
      const near = jitterWithin(rng, ua.lat, ua.lng, 28);
      const total = ua.totalFloors as number;
      let floor = rng.int(0, total);
      if (floor === ua.floor) floor = floor === total ? 0 : floor + 1;
      const obs = round500(a.spec.rentInr * (1 + rng.uniform(-0.02, 0.02)));
      const ub: SeedUnit = {
        ...ua, idx, id: uuidFor('unit', String(idx)), lat: near.lat, lng: near.lng, floor, photos: makePhotos(idx),
        areaSqft: Math.round((ua.areaSqft as number) * rng.uniform(0.98, 1.02)),
        baseRent: ua.baseRent * (obs / a.spec.rentInr), trueRent: Math.round(ua.trueRent * (obs / a.spec.rentInr)),
        deal: undefined,
      };
      units.push(ub);
      const row = buildRow(ub, src, 0, 1, { rent: obs, geoPresent: true });
      row.spec.localityText = (locBySlug.get(ub.localitySlug) as LocalityRef).name;
      row.spec.areaTextOverride = undefined;
      row.spec.areaSqft = ub.areaSqft;
      row.defect = 'hard_negative';
      rerender(row);
      rows.push(row);
      rowsByUnit.set(idx, [row]);
      hardNegatives.push([a.unitIdx, idx]);
      used.add(a.sourceListingId);
      usedUnits.add(a.unitIdx);
      usedUnits.add(idx);
    }
    if (hardNegatives.length < P.HARD_NEGATIVE_PAIRS) throw new Error('generator: not enough anchors for hard negatives');
  }

  // ---- audit: only planted rows may be statistical outliers ---------------------------------------
  // Natural rents are nudged (and genuine deals lifted) until the engine's own outlier test, run on the
  // week-0 cohort the way the pipeline will run it, rejects exactly the too_good rows and nothing else.
  {
    const NOT_IN_BASELINE = new Set<DefectKind | null>(['rent_one', 'locality_from_nogeo', 'locality_bangalore_nogeo', 'area_huge']);
    const week0 = rows.filter((r) => r.startWeek === 0 && !NOT_IN_BASELINE.has(r.defect));
    const qrow = (r: SeedRow): QualityRow => qrowOf(r, r.spec.rentInr);
    for (let pass = 0; pass < 12; pass++) {
      const baseline = buildBaseline(week0.map(qrow));
      let changed = false;
      for (const r of week0) {
        if (r.defect === 'too_good') continue;
        const verdict = checkOutlier(baseline, qrow(r));
        if (!verdict.rejected) continue;
        const u = units[r.unitIdx] as SeedUnit;
        if (u.deal?.kind === 'deal') {
          const lifted = round500(r.spec.rentInr * 1.04);
          if (lifted / u.trueRent > P.DEAL_MULT[1]) {
            u.deal = undefined; // the unit is a natural outlier even at the top of the deal band: un-plant it
            r.spec.rentInr = round500(u.trueRent);
          } else {
            r.spec.rentInr = lifted;
            u.deal.multiplier = Math.round((lifted / u.trueRent) * 100) / 100;
          }
        } else {
          r.spec.rentInr = Math.max(round500(r.spec.rentInr * ((verdict.z ?? 0) < 0 ? 1.06 : 0.94)), 500);
        }
        rerender(r);
        changed = true;
      }
      if (!changed) break;
    }
    // too_good must stay clearly rejected: if the nudging above moved its cell, push it further down.
    for (let pass = 0; pass < 6; pass++) {
      const baseline = buildBaseline(week0.map(qrow));
      let changed = false;
      for (const r of week0) {
        if (r.defect !== 'too_good' || checkOutlier(baseline, qrow(r)).rejected) continue;
        r.spec.rentInr = Math.max(round500(r.spec.rentInr * 0.9), 500);
        const u = units[r.unitIdx] as SeedUnit;
        if (u.deal) u.deal.multiplier = Math.round((r.spec.rentInr / u.trueRent) * 100) / 100;
        rerender(r);
        changed = true;
      }
      if (!changed) break;
    }
    const baseline = buildBaseline(week0.map(qrow));
    for (const r of week0) {
      const rejected = checkOutlier(baseline, qrow(r)).rejected;
      if (r.defect === 'too_good' && !rejected) throw new Error(`generator: too_good row ${r.sourceListingId} is not an outlier`);
      if (r.defect !== 'too_good' && rejected) throw new Error(`generator: natural row ${r.sourceListingId} is an outlier`);
    }
  }

  // ---- weekly price changes (never on planted rows) ------------------------------------------------
  const live = rows.filter((r) => r.defect === null && (units[r.unitIdx] as SeedUnit).deal === undefined);
  const current = new Map(live.map((r) => [r.sourceListingId, r.spec.rentInr]));
  const seenRents = new Map(live.map((r) => [r.sourceListingId, new Set([r.spec.rentInr])]));
  for (let w = 1; w < P.WEEKS; w++) {
    for (const r of live) {
      if (w <= r.startWeek || w > r.endWeek) continue;
      if (!rng.chance(P.WEEKLY_PRICE_CHANGE)) continue;
      if (w - r.startWeek < 3) continue;
      const cur = current.get(r.sourceListingId) as number;
      const pct = rng.chance(0.8) ? -rng.uniform(0.03, 0.1) : rng.uniform(0.03, 0.06);
      const next = Math.max(round500(cur * (1 + pct)), 500);
      const seen = seenRents.get(r.sourceListingId) as Set<number>;
      if (next === cur || seen.has(next)) continue; // never revert to an earlier payload
      seen.add(next);
      current.set(r.sourceListingId, next);
      const listing = render({ ...r.spec, rentInr: next });
      r.versions.push({ fromWeek: w, rentInr: next, listing });
    }
  }

  // ---- audit, weeks 1-25: new listings and price changes are assessed against the prior accepted set ---
  {
    const NOT_ACCEPTED = new Set<DefectKind | null>(['rent_one', 'locality_from_nogeo', 'locality_bangalore_nogeo', 'area_huge', 'too_good']);
    const rentAt = (r: SeedRow, w: number): number => {
      let cur = r.versions[0] as SeedRowVersion;
      for (const v of r.versions) if (v.fromWeek <= w) cur = v;
      return cur.rentInr;
    };
    for (let w = 1; w < P.WEEKS; w++) {
      const batch = rows.filter((r) => r.startWeek <= w && w <= r.endWeek && r.versions.some((v) => v.fromWeek === w));
      if (batch.length === 0) continue;
      const inBatch = new Set(batch);
      const prior = rows
        .filter((r) => !inBatch.has(r) && !NOT_ACCEPTED.has(r.defect) && r.startWeek <= w - 1 && w - 1 <= r.endWeek)
        .map((r) => qrowOf(r, rentAt(r, w - 1)));
      for (let pass = 0; pass < 10; pass++) {
        const baseline = buildBaseline([...prior, ...batch.map((r) => qrowOf(r, rentAt(r, w)))]);
        let changed = false;
        for (const r of batch) {
          const verdict = checkOutlier(baseline, qrowOf(r, rentAt(r, w)));
          if (!verdict.rejected) continue;
          const factor = (verdict.z ?? 0) < 0 ? 1.06 : 0.94;
          for (const v of r.versions) {
            if (v.fromWeek < w) continue;
            v.rentInr = Math.max(round500(v.rentInr * factor), 500);
            v.listing = render({ ...r.spec, rentInr: v.rentInr });
            if (v.fromWeek === r.startWeek) r.spec.rentInr = v.rentInr;
          }
          changed = true;
        }
        if (!changed) break;
      }
    }
  }

  return { seed, weeks, units, rows, hardNegatives };
}

export interface SeedSummary {
  units: number;
  flatUnits: number;
  pgUnits: number;
  rows: number;
  rowsPerUnit: Record<number, number>;
  rowsBySource: Record<string, number>;
  defects: Record<string, number>;
  deals: number;
  tooGood: number;
  priceChanges: number;
  hardNegatives: number;
}

export function summarize(ds: SeedDataset): SeedSummary {
  const perUnit = new Map<number, number>();
  for (const r of ds.rows) perUnit.set(r.unitIdx, (perUnit.get(r.unitIdx) ?? 0) + 1);
  const rowsPerUnit: Record<number, number> = {};
  for (const n of perUnit.values()) rowsPerUnit[n] = (rowsPerUnit[n] ?? 0) + 1;
  const rowsBySource: Record<string, number> = {};
  const defects: Record<string, number> = {};
  let priceChanges = 0;
  for (const r of ds.rows) {
    rowsBySource[r.sourceId] = (rowsBySource[r.sourceId] ?? 0) + 1;
    if (r.defect) defects[r.defect] = (defects[r.defect] ?? 0) + 1;
    priceChanges += r.versions.length - 1;
  }
  return {
    units: ds.units.length,
    flatUnits: ds.units.filter((u) => u.kind === 'flat').length,
    pgUnits: ds.units.filter((u) => u.kind === 'pg').length,
    rows: ds.rows.length,
    rowsPerUnit,
    rowsBySource,
    defects,
    deals: ds.units.filter((u) => u.deal?.kind === 'deal').length,
    tooGood: ds.units.filter((u) => u.deal?.kind === 'too_good').length,
    priceChanges,
    hardNegatives: ds.hardNegatives.length,
  };
}
