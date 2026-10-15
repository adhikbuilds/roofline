import type { RawListing, SourceAdapter } from '../../src/adapter';

export const FIXTURE_SOURCE = 'csv:fixture';

const INDIRANAGAR = { lat: 12.9784, lng: 77.6408 };
const KORAMANGALA = { lat: 12.9352, lng: 77.6245 };
const HSR = { lat: 12.9116, lng: 77.6474 };

const flat = (id: string, loc: string, base: { lat: number; lng: number }, rent: string, over: Partial<RawListing> = {}): RawListing => ({
  sourceListingId: id,
  title: `2 BHK flat for rent in ${loc}`,
  rentText: rent,
  depositText: '3 months',
  areaText: '1,100 sq.ft',
  bhkText: '2 BHK',
  furnishingText: 'Semi-Furnished',
  localityText: loc,
  lat: base.lat + (Number(id.slice(1)) % 5) * 0.0004,
  lng: base.lng + (Number(id.slice(1)) % 3) * 0.0004,
  ...over,
});

const pg = (id: string, rent: string, locality: string): RawListing => ({
  sourceListingId: id,
  title: 'Boys PG in HSR Layout',
  rentText: rent,
  bhkText: 'PG',
  localityText: locality,
  lat: HSR.lat + 0.0003,
  lng: HSR.lng + 0.0003,
  pg: { sharingText: '2 sharing', foodText: 'Food included', genderText: 'Gents' },
});

/** Forty hand-built rows. FIXTURE_EXPECTED below is the exact outcome the pipeline must produce for each. */
export function fixtureRows(): RawListing[] {
  const I = INDIRANAGAR;
  const K = KORAMANGALA;
  const clean: RawListing[] = [
    flat('f01', 'Indiranagar', I, '₹44,000', { depositText: undefined }),
    flat('f02', 'Indiranagar', I, '45500'),
    flat('f03', 'Indiranagar', I, '46.5K'),
    flat('f04', 'Indiranagar', I, '47,000/-'),
    flat('f05', 'Indiranagar', I, 'Rs. 48,000'),
    flat('f06', 'indira nagar', I, '49000'),
    flat('f07', 'Indiranager', I, '50000'),
    flat('f08', 'INDIRANAGAR, Bangalore', I, '50,500'),
    flat('f09', 'Indiranagar 2nd Stage', I, '51500'),
    flat('f10', 'Indiranagar', I, '52500'),
    flat('f11', 'Indiranagar', I, '54000'),
    ...[['f12', '40000'], ['f13', '41000'], ['f14', '42000'], ['f15', '43000'], ['f16', '44000'], ['f17', '45000']].map(([id, r]) =>
      flat(id as string, 'Koramangala', K, r as string)),
    flat('f18', 'Koramangala 5th Block', K, '46000'),
    flat('f19', 'koramangla', K, '43500'),
    pg('f20', '9500', 'HSR Layout'),
    pg('f21', '10500', 'HSR Layout'),
    pg('f22', '11000', 'hsr'),
    pg('f23', '12000', 'HSR Layout'),
    pg('f24', '12500', 'HSR Layout'),
  ];
  const planted: RawListing[] = [
    flat('f25', 'Indiranagar', I, '₹1'),
    flat('f26', 'From', I, '48000', { lat: undefined, lng: undefined }),
    flat('f27', 'From', K, '43000'),
    flat('f28', '', I, '49500'),
    flat('f29', 'Indiranagar', I, '50500', { furnishingText: '11901' }),
    flat('f30', 'Indiranagar', I, '48500', { areaText: '0' }),
    flat('f31', 'Indiranagar', I, '50000', { areaText: '99,999' }),
    flat('f32', 'Indiranagar', I, '49000', { lat: 0, lng: 0 }),
    flat('f33', 'Indiranagar', I, '624000'),
    flat('f34', 'Indiranagar', I, '48.5'),
    {
      sourceListingId: 'f35',
      title: '2 BHK flat for rent in Koramangala',
      description:
        'Owner submission. Rent: ₹44,000 per month; Deposit: 3 months; Area: 1,050 sq.ft; Furnishing: Semi-Furnished; Locality: Koramangala; Floor: 2/4; Parking: bike.',
      lat: K.lat,
      lng: K.lng,
    },
    flat('f36', 'Zzzville', { lat: 13.2, lng: 77.4 }, '40000', { lat: 13.2, lng: 77.4 }),
    flat('f37', 'Koramangala', K, '9000'),
    flat('f38', 'Indiranagar', K, '44500'),
    { sourceListingId: 'f39', title: 'Spacious home', rentText: '30000', localityText: 'Indiranagar' },
    flat('f40', 'Indiranagar', I, 'Negotiable'),
  ];
  return [...clean, ...planted];
}

export interface Expected {
  status: 'accepted' | 'rejected';
  reasons: string[];
  warnings: string[];
  locality: string | null;
  rent: number | null;
}

const ok = (locality: string, rent: number, warnings: string[] = []): Expected => ({ status: 'accepted', reasons: [], warnings, locality, rent });
const bad = (locality: string | null, rent: number | null, reasons: string[], warnings: string[] = []): Expected => ({
  status: 'rejected', reasons, warnings, locality, rent,
});

export const FIXTURE_EXPECTED: Record<string, Expected> = {
  f01: ok('indiranagar', 44000, ['DEPOSIT_MISSING']),
  f02: ok('indiranagar', 45500),
  f03: ok('indiranagar', 46500),
  f04: ok('indiranagar', 47000),
  f05: ok('indiranagar', 48000),
  f06: ok('indiranagar', 49000),
  f07: ok('indiranagar', 50000, ['LOCALITY_FUZZY']),
  f08: ok('indiranagar', 50500),
  f09: ok('indiranagar', 51500),
  f10: ok('indiranagar', 52500),
  f11: ok('indiranagar', 54000),
  f12: ok('koramangala', 40000),
  f13: ok('koramangala', 41000),
  f14: ok('koramangala', 42000),
  f15: ok('koramangala', 43000),
  f16: ok('koramangala', 44000),
  f17: ok('koramangala', 45000),
  f18: ok('koramangala', 46000),
  f19: ok('koramangala', 43500),
  f20: ok('hsr-layout', 9500, ['DEPOSIT_MISSING']),
  f21: ok('hsr-layout', 10500, ['DEPOSIT_MISSING']),
  f22: ok('hsr-layout', 11000, ['DEPOSIT_MISSING']),
  f23: ok('hsr-layout', 12000, ['DEPOSIT_MISSING']),
  f24: ok('hsr-layout', 12500, ['DEPOSIT_MISSING']),
  f25: bad('indiranagar', 1, ['PSF_IMPLAUSIBLE', 'RENT_TOO_LOW']),
  f26: bad(null, 48000, ['GEO_INVALID', 'LOCALITY_UNRESOLVED']),
  f27: ok('koramangala', 43000, ['LOCALITY_FROM_GEO']),
  f28: ok('indiranagar', 49500, ['LOCALITY_FROM_GEO']),
  f29: ok('indiranagar', 50500, ['FURNISHING_INVALID']),
  f30: ok('indiranagar', 48500, ['AREA_MISSING']),
  f31: bad('indiranagar', 50000, ['AREA_IMPLAUSIBLE', 'PSF_IMPLAUSIBLE'], ['BHK_AREA_MISMATCH']),
  f32: ok('indiranagar', 49000),
  f33: ok('indiranagar', 52000, ['RENT_ANNUAL_REPAIRED']),
  f34: ok('indiranagar', 48500, ['RENT_UNIT_REPAIRED']),
  f35: ok('koramangala', 44000),
  f36: bad(null, 40000, ['LOCALITY_UNRESOLVED']),
  f37: bad('koramangala', 9000, ['RENT_OUTLIER_MAD']),
  f38: ok('koramangala', 44500, ['LOCALITY_TEXT_GEO_CONFLICT']),
  f39: bad('indiranagar', 30000, ['UNIT_KIND_MISSING'], ['AREA_MISSING', 'DEPOSIT_MISSING']),
  f40: bad('indiranagar', null, ['RENT_MISSING']),
};

export function fixtureAdapter(rows: RawListing[] = fixtureRows()): SourceAdapter {
  return {
    id: FIXTURE_SOURCE,
    displayName: 'Fixture feed',
    license: { kind: 'licensed-feed', terms: 'test fixture', attributionRequired: false, imageRights: 'none' },
    async *fetch({ signal }) {
      for (const r of rows) {
        if (signal.aborted) return;
        yield r;
      }
    },
  };
}
