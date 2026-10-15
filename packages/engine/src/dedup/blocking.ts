import { geohashEncode, geohashNeighbors } from '../geo';
import type { DedupRecord } from './types';

export const BLOCKING = {
  geohashPrecision: 6,
  rentBandBase: 1.25,
  rentBandRadius: 1,
  maxBhkClass: 5,
} as const;

export type UnitClass = `f${0 | 1 | 2 | 3 | 4 | 5}` | 'pg';
export type BlockKey = string;

const LN_BASE = Math.log(BLOCKING.rentBandBase);

/** Unit class for blocking; null = unblockable (bhk without a bhk count). */
export function unitClass(r: Pick<DedupRecord, 'unitKind' | 'bhk'>): UnitClass | null {
  switch (r.unitKind) {
    case 'rk':
    case 'studio':
      return 'f0';
    case 'pg_bed':
      return 'pg';
    case 'bhk': {
      if (r.bhk === null || !Number.isFinite(r.bhk) || r.bhk < 0) return null;
      const n = Math.min(Math.floor(r.bhk), BLOCKING.maxBhkClass);
      return `f${n}` as UnitClass;
    }
    default:
      return null;
  }
}

/** Log-scale rent band of width ln(1.25), matching the RENT_FAR gate. */
export function rentBand(rentInr: number): number {
  if (!Number.isFinite(rentInr) || rentInr <= 0) {
    throw new RangeError('rentBand: rent must be a positive finite number');
  }
  return Math.floor(Math.log(rentInr) / LN_BASE);
}

function geoCell(r: DedupRecord): string | null {
  return r.geo ? geohashEncode(r.geo.lat, r.geo.lng, BLOCKING.geohashPrecision) : null;
}

/** Keys under which a record is indexed: G + LA (geo) or L0 + LA (geo-less). */
export function indexKeys(r: DedupRecord): BlockKey[] {
  const cls = unitClass(r);
  if (cls === null) return [];
  const band = rentBand(r.rentInr);
  const cell = geoCell(r);
  const la = `la:${r.localityId}|${cls}|${band}`;
  return cell !== null ? [`g:${cell}|${cls}|${band}`, la] : [`l0:${r.localityId}|${cls}|${band}`, la];
}

/** Keys a record probes: 27 G + 3 L0 (geo) or 3 LA (geo-less). */
export function probeKeys(r: DedupRecord): BlockKey[] {
  const cls = unitClass(r);
  if (cls === null) return [];
  const band = rentBand(r.rentInr);
  const rad = BLOCKING.rentBandRadius;
  const cell = geoCell(r);
  const keys: BlockKey[] = [];
  if (cell !== null) {
    const cells = [cell, ...geohashNeighbors(cell)];
    for (const c of cells) for (let d = -rad; d <= rad; d++) keys.push(`g:${c}|${cls}|${band + d}`);
    for (let d = -rad; d <= rad; d++) keys.push(`l0:${r.localityId}|${cls}|${band + d}`);
  } else {
    for (let d = -rad; d <= rad; d++) keys.push(`la:${r.localityId}|${cls}|${band + d}`);
  }
  return keys;
}

export interface BlockIndex {
  readonly byKey: ReadonlyMap<BlockKey, readonly string[]>;
}

export function buildBlockIndex(records: readonly DedupRecord[]): BlockIndex {
  const m = new Map<BlockKey, string[]>();
  for (const r of records) {
    for (const k of indexKeys(r)) {
      const list = m.get(k);
      if (list) list.push(r.id);
      else m.set(k, [r.id]);
    }
  }
  for (const list of m.values()) list.sort(cmp);
  return { byKey: m };
}

export interface CandidatePair {
  readonly a: string;
  readonly b: string;
}
export interface BlockingStats {
  probed: number;
  unblockable: number;
  comparisons: number;
  perRecordMean: number;
  perRecordMax: number;
  largestBlock: number;
}

function cmp(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Pairs with at least one endpoint in `probe`; de-duplicated, sorted by (a, b). */
export function candidatePairs(
  index: BlockIndex,
  records: ReadonlyMap<string, DedupRecord>,
  probe: Iterable<string>,
): { pairs: CandidatePair[]; stats: BlockingStats } {
  const probeIds = [...new Set(probe)].sort(cmp);
  const seen = new Map<string, CandidatePair>();
  let probed = 0;
  let unblockable = 0;
  let sumPer = 0;
  let maxPer = 0;
  let largestBlock = 0;
  for (const id of probeIds) {
    const r = records.get(id);
    if (!r) continue;
    const keys = probeKeys(r);
    if (keys.length === 0) {
      unblockable++;
      continue;
    }
    probed++;
    const others = new Set<string>();
    for (const k of keys) {
      const list = index.byKey.get(k);
      if (!list) continue;
      if (list.length > largestBlock) largestBlock = list.length;
      for (const o of list) if (o !== id) others.add(o);
    }
    sumPer += others.size;
    if (others.size > maxPer) maxPer = others.size;
    for (const o of others) {
      const [a, b] = id < o ? [id, o] : [o, id];
      const key = `${a}|${b}`;
      if (!seen.has(key)) seen.set(key, { a, b });
    }
  }
  const pairs = [...seen.values()].sort((p, q) => cmp(p.a, q.a) || cmp(p.b, q.b));
  return {
    pairs,
    stats: {
      probed,
      unblockable,
      comparisons: pairs.length,
      perRecordMean: probed === 0 ? 0 : sumPer / probed,
      perRecordMax: maxPer,
      largestBlock,
    },
  };
}
