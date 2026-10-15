/**
 * Stage 4: unit repair, deposit, then hard rules + robust outliers (engine). Statistics come from the
 * previous accepted set plus this batch's survivors, so one bad batch cannot move its own baseline.
 */
import {
  QUALITY_BOUNDS, assessRow, buildBaseline, hardRules, median, parseDeposit, quantiles, repairRent,
  type QualityRow, type RepairContext,
} from '@roofline/engine';
import type { Db } from './db';
import type { Draft, RefData } from './types';

export interface PriorRow extends QualityRow {
  sourceId: string;
  sourceListingId: string;
}

export async function loadPriorAccepted(db: Db): Promise<PriorRow[]> {
  const { rows } = await db.query<{
    source_id: string; source_listing_id: string; unit_kind: string; bhk: number | null; rent_inr: number;
    area_sqft: number | null; locality_id: number; zone: string; pg_sharing: string | null; lat: number | null; lng: number | null;
  }>(
    `SELECT sl.source_id, sl.source_listing_id, sl.unit_kind::text AS unit_kind, sl.bhk, sl.rent_inr, sl.area_sqft,
            sl.locality_id, l.zone::text AS zone, sl.pg_sharing::text AS pg_sharing,
            ST_Y(sl.geom::geometry) AS lat, ST_X(sl.geom::geometry) AS lng
       FROM source_listings sl JOIN localities l ON l.id = sl.locality_id
      WHERE sl.quality_status = 'accepted' AND sl.is_active
      ORDER BY sl.source_id, sl.source_listing_id`,
  );
  return rows.map((r) => ({
    sourceId: r.source_id,
    sourceListingId: r.source_listing_id,
    kind: r.unit_kind === 'pg_bed' ? 'pg' : 'flat',
    bhk: r.bhk,
    rentInr: r.rent_inr,
    areaSqft: r.area_sqft,
    localityId: r.locality_id,
    zone: r.zone,
    pgSharing: r.pg_sharing,
    lat: r.lat,
    lng: r.lng,
  }));
}

const suffix = (kind: 'flat' | 'pg', bhk: number | null, sharing: string | null): string =>
  kind === 'pg' ? `pg:${sharing ?? 'na'}` : `flat:${bhk ?? 'na'}`;

interface Cell {
  rents: number[];
  ctx?: RepairContext;
}
const MIN_CELL = 8;
const MIN_CITY = 4;

/** Locality x BHK -> zone x BHK -> city x BHK rent bands used only to repair unit mistakes. */
class BandIndex {
  private readonly cells = new Map<string, Cell>();

  add(kind: 'flat' | 'pg', bhk: number | null, sharing: string | null, localityId: number, zone: string, rent: number): void {
    const s = suffix(kind, bhk, sharing);
    for (const k of [`L${localityId}|${s}`, `Z${zone}|${s}`, `C|${s}`]) {
      const c = this.cells.get(k);
      if (c) c.rents.push(rent);
      else this.cells.set(k, { rents: [rent] });
    }
  }

  context(kind: 'flat' | 'pg', bhk: number | null, sharing: string | null, localityId: number, zone: string): RepairContext | null {
    const s = suffix(kind, bhk, sharing);
    for (const [k, min] of [[`L${localityId}|${s}`, MIN_CELL], [`Z${zone}|${s}`, MIN_CELL], [`C|${s}`, MIN_CITY]] as const) {
      const c = this.cells.get(k);
      if (!c || c.rents.length < min) continue;
      if (!c.ctx) {
        const [p10, p90] = quantiles(c.rents, [0.1, 0.9]) as [number, number];
        c.ctx = { band: { p10, p90 }, median: median(c.rents) };
      }
      return c.ctx;
    }
    return null;
  }
}

const WARNING_FLAGS = new Set([
  'FURNISHING_INVALID', 'DEPOSIT_MISSING', 'AREA_MISSING', 'RENT_UNIT_REPAIRED', 'RENT_ANNUAL_REPAIRED',
  'LOCALITY_FUZZY', 'LOCALITY_FROM_GEO', 'LOCALITY_TEXT_GEO_CONFLICT', 'BHK_TITLE_MISMATCH', 'BHK_AREA_MISMATCH', 'FLOOR_INVALID',
]);

const plausibleRent = (kind: 'flat' | 'pg', rent: number): boolean =>
  kind === 'pg'
    ? rent >= QUALITY_BOUNDS.pgRentMin && rent <= QUALITY_BOUNDS.pgRentMax
    : rent >= QUALITY_BOUNDS.flatRentMin && rent <= QUALITY_BOUNDS.flatRentMax;

function toQualityRow(d: Draft, ref: RefData): QualityRow {
  const loc = d.localityId === null ? undefined : ref.byId.get(d.localityId);
  return {
    kind: d.kind,
    bhk: d.kind === 'flat' ? d.bhk : null,
    rentInr: d.rentInr as number,
    areaSqft: d.areaSqft,
    localityId: d.localityId,
    zone: loc?.zone ?? null,
    pgSharing: d.pgSharing,
    lat: d.lat,
    lng: d.lng,
    localityFromGeo: d.localityFromGeo,
  };
}

export function assessDrafts(drafts: Draft[], prior: readonly PriorRow[], ref: RefData): void {
  // Rent bands from the previous accepted set plus this batch's plausible, located rows.
  const bands = new BandIndex();
  for (const p of prior) {
    if (p.localityId !== null && p.zone !== null) bands.add(p.kind, p.bhk, p.pgSharing, p.localityId, p.zone, p.rentInr);
  }
  for (const d of drafts) {
    const loc = d.localityId === null ? undefined : ref.byId.get(d.localityId);
    if (loc && d.rentParsed !== null && plausibleRent(d.kind, d.rentParsed)) {
      bands.add(d.kind, d.bhk, d.pgSharing, loc.id, loc.zone, d.rentParsed);
    }
  }

  // Repair, then deposit (months need the repaired rent).
  for (const d of drafts) {
    if (d.rentParsed === null) continue;
    const loc = d.localityId === null ? undefined : ref.byId.get(d.localityId);
    const ctx = loc ? bands.context(d.kind, d.bhk, d.pgSharing, loc.id, loc.zone) : null;
    const fixed = repairRent(d.rentParsed, ctx);
    d.rentInr = fixed.value === null ? null : Math.round(fixed.value);
    fixed.flags.forEach((f) => d.flags.add(f));
    const dep = parseDeposit(d.depositText, d.rentInr);
    d.depositInr = dep.value === null ? null : Math.round(dep.value);
    dep.flags.forEach((f) => d.flags.add(f));
  }

  // Hard rules for everyone; outlier baseline from prior accepted + this batch's clean, located rows.
  const survivors: QualityRow[] = [];
  const hard = new Map<Draft, ReturnType<typeof hardRules>>();
  for (const d of drafts) {
    if (d.rentInr === null || d.unitKind === null) continue;
    const q = toQualityRow(d, ref);
    const h = hardRules(q);
    hard.set(d, h);
    if (h.reasons.length === 0 && d.localityId !== null) survivors.push(q);
  }
  const priorSet = new Set(drafts.map((d) => `${d.sourceId}\u0000${d.sourceListingId}`));
  const priorRows = prior.filter((p) => !priorSet.has(`${p.sourceId}\u0000${p.sourceListingId}`));
  const baseline = buildBaseline([...priorRows, ...survivors]);

  for (const d of drafts) {
    const reasons: string[] = [];
    const warnings = new Set<string>([...d.flags].filter((f) => WARNING_FLAGS.has(f)));
    if (d.rentInr === null) reasons.push('RENT_MISSING');
    if (d.unitKind === null) reasons.push('UNIT_KIND_MISSING');
    const h = hard.get(d);
    if (h) {
      reasons.push(...h.reasons);
      h.warnings.forEach((w) => warnings.add(w));
      if (d.localityId === null) {
        // The engine only warns when geo is valid but PostGIS found nothing close enough: reject here.
        if (!reasons.includes('LOCALITY_UNRESOLVED')) reasons.push('LOCALITY_UNRESOLVED');
        warnings.delete('LOCALITY_FROM_GEO'); // geo did not resolve it, so the warning would be a lie
      } else if (reasons.length === 0) {
        const verdict = assessRow(toQualityRow(d, ref), baseline);
        reasons.push(...verdict.reasons);
        verdict.warnings.forEach((w) => warnings.add(w));
      }
    }
    d.reasons = [...new Set(reasons)];
    d.warnings = [...warnings].sort();
    d.status = d.reasons.length === 0 ? 'accepted' : 'rejected';
  }
}
