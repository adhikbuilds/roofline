/** Stage 2: parse every text field with the engine's pure parsers. Never throws. */
import {
  hasValidGeo, parseArea, parseFacing, parseFloor, parseFood, parseFurnishing, parseGender, parseMoney,
  parseParking, parseRent, parseSharing, parseTags, parseUnitKind, titleTokens,
} from '@roofline/engine';
import type { RawListing } from '../adapter';
import { extractFromDescription } from './extract';
import type { Draft } from './types';

export interface NormalizeContext {
  runId: number;
  sourceId: string;
  isSynthetic: boolean;
  asOf: Date;
}

/** 16 hex chars (unsigned 64-bit dHash) to the signed bigint string Postgres bigint[] needs. */
export function toSignedHash(hex: unknown): string | null {
  if (typeof hex !== 'string' || !/^[0-9a-f]{16}$/i.test(hex)) return null;
  return BigInt.asIntN(64, BigInt(`0x${hex}`)).toString();
}

const present = (s: string | undefined): s is string => typeof s === 'string' && s.trim() !== '';

export function normalizeRaw(raw: RawListing, ctx: NormalizeContext): Draft {
  const flags = new Set<string>();
  const ex = extractFromDescription(raw.description);
  let usedExtractor = false;
  const pick = (own: string | undefined, fallback: string | undefined): string | undefined => {
    if (present(own)) return own;
    if (present(fallback)) {
      usedExtractor = true;
      return fallback;
    }
    return own;
  };
  const rentText = pick(raw.rentText, ex.rentText);
  const areaText = pick(raw.areaText, ex.areaText);
  const bhkText = pick(raw.bhkText, ex.bhkText);
  const furnishingText = pick(raw.furnishingText, ex.furnishingText);
  const localityText = pick(raw.localityText, ex.localityText) ?? '';
  const depositText = pick(raw.depositText, ex.depositText);
  const maintenanceText = pick(raw.maintenanceText, ex.maintenanceText);

  const unit = parseUnitKind(bhkText, raw.title);
  unit.flags.forEach((f) => flags.add(f));
  const unitKind = unit.value?.unitKind ?? null;
  const kind: 'flat' | 'pg' = unitKind === 'pg_bed' ? 'pg' : 'flat';

  const rent = parseRent(rentText);
  if (rent.value === null) flags.add('RENT_MISSING');

  const area = parseArea(areaText);
  if (kind === 'flat') area.flags.forEach((f) => flags.add(f));

  let furnishing: Draft['furnishing'] = null;
  if (kind === 'flat' && present(furnishingText)) {
    const f = parseFurnishing(furnishingText);
    furnishing = f.value;
    f.flags.forEach((x) => flags.add(x));
  }

  const maint = present(maintenanceText) ? parseMoney(maintenanceText).value : null;
  const floor = parseFloor(ex.floorText);
  floor.flags.forEach((f) => flags.add(f));

  const lat = typeof raw.lat === 'number' && Number.isFinite(raw.lat) ? raw.lat : null;
  const lng = typeof raw.lng === 'number' && Number.isFinite(raw.lng) ? raw.lng : null;
  const geoValid = hasValidGeo({ lat, lng });

  const posted = raw.postedAt ? new Date(raw.postedAt) : null;
  const photos = raw.photos ?? [];

  return {
    runId: ctx.runId,
    sourceId: ctx.sourceId,
    isSynthetic: ctx.isSynthetic,
    asOf: ctx.asOf,
    raw,
    sourceListingId: raw.sourceListingId,
    firstSeen: true,
    unitKind,
    bhk: unit.value ? unit.value.bhk : null,
    kind,
    rentParsed: rent.value,
    depositText,
    maintenanceInr: maint === null ? null : Math.round(maint),
    areaSqft: area.value === null ? null : Math.round(area.value),
    furnishing,
    pgSharing: kind === 'pg' ? parseSharing(raw.pg?.sharingText).value : null,
    pgFood: kind === 'pg' ? parseFood(raw.pg?.foodText).value : null,
    pgGender: kind === 'pg' ? parseGender(raw.pg?.genderText).value : null,
    parking: parseParking(ex.parkingText).value,
    facing: parseFacing(ex.facingText).value,
    floor: floor.value.floor,
    totalFloors: floor.value.totalFloors,
    tags: parseTags(raw.tags).value,
    title: raw.title ?? null,
    titleTokens: titleTokens(raw.title),
    description: raw.description ?? null,
    photoHashes: photos.map((p) => toSignedHash(p.dhash)).filter((h): h is string => h !== null),
    photoSeeds: photos.map((p) => p.seed).filter((s): s is string => typeof s === 'string' && s !== ''),
    postedAt: posted && !Number.isNaN(posted.getTime()) ? posted.toISOString() : null,
    lat: geoValid ? lat : null,
    lng: geoValid ? lng : null,
    geoValid,
    extractedBy: usedExtractor ? 'rules' : null,
    localityText,
    flags,
    localityId: null,
    localityMethod: 'unresolved',
    localityFromGeo: false,
    rentInr: null,
    depositInr: null,
    status: 'accepted',
    reasons: [],
    warnings: [],
  };
}
