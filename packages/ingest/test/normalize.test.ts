import { describe, expect, it } from 'vitest';
import type { RawListing } from '../src/adapter';
import { normalizeRaw, toSignedHash } from '../src/pipeline/normalize';

const ctx = { runId: 1, sourceId: 'nestlane', isSynthetic: true, asOf: new Date('2026-04-09T00:00:00Z') };
const n = (raw: Partial<RawListing>) => normalizeRaw({ sourceListingId: 'x', ...raw }, ctx);

describe('normalizeRaw', () => {
  it('parses a complete flat row', () => {
    const d = n({
      title: '2 BHK flat for rent in Indiranagar', rentText: '₹42K', depositText: '3 months', maintenanceText: '₹2,500',
      areaText: '1,100 sq.ft', bhkText: '2 BHK', furnishingText: 'Semi-Furnished', localityText: 'Indiranagar',
      lat: 12.97, lng: 77.64, tags: ['Lift', 'Gated'],
      description: 'Nice. Floor: 3/5; Facing: north east; Parking: bike & car.',
    });
    expect(d).toMatchObject({
      kind: 'flat', unitKind: 'bhk', bhk: 2, rentParsed: 42000, depositText: '3 months', maintenanceInr: 2500, areaSqft: 1100,
      furnishing: 'semi', floor: 3, totalFloors: 5, facing: 'north_east', parking: 'both', geoValid: true, extractedBy: null,
    });
    expect(d.tags).toEqual(['lift', 'gated']);
    expect([...d.flags]).toEqual([]);
  });

  it('parses a PG row', () => {
    const d = n({ title: 'Boys PG in HSR Layout', bhkText: 'PG', rentText: '9,500', pg: { sharingText: '2 sharing', foodText: 'Food included', genderText: 'Gents' } });
    expect(d).toMatchObject({ kind: 'pg', unitKind: 'pg_bed', bhk: 0, pgSharing: 'double', pgFood: true, pgGender: 'male', rentParsed: 9500 });
    expect(d.flags.has('AREA_MISSING')).toBe(false);
  });

  it('flags the planted junk without throwing', () => {
    expect(n({ rentText: '₹1', bhkText: '2 BHK' }).rentParsed).toBe(1);
    expect(n({ rentText: 'Negotiable', bhkText: '2 BHK' })).toMatchObject({ rentParsed: null });
    expect(n({ bhkText: '2 BHK', furnishingText: '11901' }).flags.has('FURNISHING_INVALID')).toBe(true);
    expect(n({ bhkText: '2 BHK', areaText: '0' })).toMatchObject({ areaSqft: null });
    expect(n({ bhkText: '2 BHK', areaText: '0' }).flags.has('AREA_MISSING')).toBe(true);
  });

  it('does not flag a missing furnishing as invalid', () => {
    expect(n({ bhkText: '2 BHK' }).flags.has('FURNISHING_INVALID')).toBe(false);
    expect(n({ bhkText: '2 BHK', furnishingText: '' }).flags.has('FURNISHING_INVALID')).toBe(false);
  });

  it('treats (0,0) and out-of-bbox coordinates as invalid geo and drops them', () => {
    expect(n({ bhkText: '1 RK', lat: 0, lng: 0 })).toMatchObject({ geoValid: false, lat: null, lng: null });
    expect(n({ bhkText: '1 RK', lat: 28.6, lng: 77.2 })).toMatchObject({ geoValid: false });
    expect(n({ bhkText: '1 RK' })).toMatchObject({ geoValid: false });
  });

  it('adds BHK_TITLE_MISMATCH when title and field disagree and the field wins', () => {
    const d = n({ bhkText: '3 BHK', title: '2 BHK flat' });
    expect(d.bhk).toBe(3);
    expect(d.flags.has('BHK_TITLE_MISMATCH')).toBe(true);
  });

  it('falls back to description segments for owner rows and marks extracted_by', () => {
    const d = n({
      title: '3 BHK flat for rent in Whitefield',
      description: 'Great. Rent: ₹55,000 per month; Deposit: 5 months; Area: 1,600 sq.ft; Furnishing: Furnished; Locality: Whitefield; Floor: 2/6.',
    });
    expect(d).toMatchObject({ rentParsed: 55000, areaSqft: 1600, furnishing: 'furnished', localityText: 'Whitefield', depositText: '5 months', extractedBy: 'rules', bhk: 3 });
  });

  it('rejects nothing here: unit kind missing yields null', () => {
    expect(n({ rentText: '10000' })).toMatchObject({ unitKind: null, bhk: null });
  });

  it('converts 64-bit dhashes to signed bigint strings', () => {
    expect(toSignedHash('ffffffffffffffff')).toBe('-1');
    expect(toSignedHash('0000000000000001')).toBe('1');
    expect(toSignedHash('8000000000000000')).toBe('-9223372036854775808');
    expect(toSignedHash('nothex')).toBeNull();
    const d = n({ bhkText: '1 RK', photos: [{ seed: 'a-1', dhash: 'ffffffffffffffff' }, { seed: 'b' }, { dhash: 'zz' }] });
    expect(d.photoHashes).toEqual(['-1']);
    expect(d.photoSeeds).toEqual(['a-1', 'b']);
  });
});
