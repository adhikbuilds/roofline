import { describe, expect, it } from 'vitest';
import {
  areaSimilarity,
  featuresJson,
  gate,
  geoSimilarity,
  hamming64,
  jaccard,
  minHamming,
  parsePhotoHash,
  photoSimilarity,
  rentSimilarity,
  scorePair,
} from '../../src/dedup';
import { destination, hashAt, rec } from './helpers';

const base = { lat: 12.9352, lng: 77.6245 };
const at = (d: number) => destination(base, 0, d);

describe('hash helpers', () => {
  it('hamming64 counts differing bits', () => {
    expect(hamming64(0n, 0n)).toBe(0);
    expect(hamming64(0n, (1n << 64n) - 1n)).toBe(64);
    expect(hamming64(0b1010n, 0b0110n)).toBe(2);
  });
  it('minHamming takes min over pairs, null when empty', () => {
    expect(minHamming([hashAt(10), hashAt(3)], [0n])).toBe(3);
    expect(minHamming([], [0n])).toBeNull();
    expect(minHamming([0n], [])).toBeNull();
  });
  it('parsePhotoHash handles signed decimal, hex and junk', () => {
    expect(parsePhotoHash('-1')).toBe((1n << 64n) - 1n);
    expect(parsePhotoHash('5')).toBe(5n);
    expect(parsePhotoHash('00000000000000ff')).toBe(255n);
    expect(parsePhotoHash('-9223372036854775808')).toBe(1n << 63n);
    expect(parsePhotoHash('abc')).toBeNull();
    expect(parsePhotoHash('')).toBeNull();
    expect(parsePhotoHash('99999999999999999999999')).toBeNull();
  });
});

describe('feature functions', () => {
  it('photoSimilarity', () => {
    expect(photoSimilarity(null)).toBeNull();
    expect(photoSimilarity(6)).toBe(1);
    expect(photoSimilarity(16)).toBe(0);
    expect(photoSimilarity(8)).toBeCloseTo(0.8, 12);
  });
  it('geoSimilarity', () => {
    expect(geoSimilarity(150)).toBe(1);
    expect(geoSimilarity(800)).toBe(0);
    expect(geoSimilarity(200)).toBeCloseTo(600 / 650, 12);
  });
  it('rentSimilarity', () => {
    expect(rentSimilarity(30000, 30000)).toBe(1);
    expect(rentSimilarity(30000, 31500)).toBeCloseTo(1 - 1500 / 3150, 12);
    expect(rentSimilarity(10000, 20000)).toBe(0);
  });
  it('areaSimilarity', () => {
    expect(areaSimilarity(null, 1000)).toBe(0.5);
    expect(areaSimilarity(1000, 1030)).toBe(1);
    expect(areaSimilarity(1000, 1200)).toBe(0);
    expect(areaSimilarity(1000, 1100)).toBeCloseTo((0.15 - 100 / 1100) / 0.12, 12);
  });
  it('jaccard', () => {
    expect(jaccard([], ['a'])).toBeNull();
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 12);
    expect(jaccard(['a', 'a'], ['a'])).toBe(1);
  });
});

describe('gate', () => {
  it('rejects each gated reason', () => {
    const a = rec();
    expect(gate(a, a)).toEqual({ ok: false, reason: 'SAME_ROW' });
    expect(gate(a, rec({ bhk: 3 }))).toEqual({ ok: false, reason: 'CLASS' });
    expect(gate(a, rec({ bhk: null }))).toEqual({ ok: false, reason: 'CLASS' });
    const pg = rec({ unitKind: 'pg_bed', bhk: null, pgSharing: 'double', pgGender: 'male' });
    expect(gate(pg, rec({ unitKind: 'pg_bed', bhk: null, pgSharing: 'single', pgGender: 'male' }))).toEqual({
      ok: false,
      reason: 'PG_SHARING',
    });
    expect(gate(pg, rec({ unitKind: 'pg_bed', bhk: null, pgSharing: 'double', pgGender: 'female' }))).toEqual({
      ok: false,
      reason: 'PG_GENDER',
    });
    expect(gate(pg, rec({ unitKind: 'pg_bed', bhk: null, pgSharing: null, pgGender: null })).ok).toBe(true);
    expect(gate(a, rec({ geo: null, localityId: 2 }))).toEqual({ ok: false, reason: 'LOCALITY' });
    expect(gate(a, rec({ geo: null })).ok).toBe(true);
    expect(gate(a, rec({ geo: at(1001) }))).toEqual({ ok: false, reason: 'GEO_FAR' });
    expect(gate(a, rec({ geo: at(990) })).ok).toBe(true);
    expect(gate(a, rec({ rentInr: 37501 }))).toEqual({ ok: false, reason: 'RENT_FAR' });
    expect(gate(a, rec({ rentInr: 37500 })).ok).toBe(true);
  });
  it('studio and rk share a class', () => {
    expect(gate(rec({ unitKind: 'rk', bhk: null }), rec({ unitKind: 'studio', bhk: null })).ok).toBe(true);
  });
});

describe('hand-computed pairs (design 2.5)', () => {
  const same = { titleTokens: ['a', 'b', 'c'], furnishing: 'semi' as const, floor: 2 };

  it('1: exact cross-source duplicate -> 1.0 match', () => {
    const a = rec({ ...same, sourceId: 'x', geo: base, photoHashes: [0n] });
    const b = rec({ ...same, sourceId: 'y', geo: at(40), photoHashes: [hashAt(2)] });
    const s = scorePair(a, b)!;
    expect(s.score).toBeCloseTo(1, 9);
    expect(s.decision).toBe('match');
    expect(s.cap).toBeNull();
  });

  it('2: typical cross-source -> 0.853571 match', () => {
    const a = rec({ sourceId: 'x', geo: base, rentInr: 30000, areaSqft: 1100, titleTokens: ['spacious', '2', 'koramangala'], photoHashes: [0n] });
    const b = rec({ sourceId: 'y', geo: at(95), rentInr: 31500, areaSqft: 1130, titleTokens: ['2', 'available', 'koramangala'], photoHashes: [hashAt(4)] });
    const s = scorePair(a, b)!;
    expect(s.score).toBeCloseTo(0.853571, 5);
    expect(s.decision).toBe('match');
  });

  it('3: same-building hard negative -> 0.475410 none', () => {
    const a = rec({ ...same, sourceId: 'x', geo: base, rentInr: 30000, areaSqft: 1100, floor: 3, photoHashes: [0n] });
    const b = rec({ ...same, sourceId: 'x', geo: at(25), rentInr: 30500, areaSqft: 1115, floor: 7, photoHashes: [hashAt(22)] });
    const s = scorePair(a, b)!;
    expect(s.score).toBeCloseTo(0.47541, 5);
    expect(s.decision).toBe('none');
    expect(s.features.floorMismatch).toBe(true);
  });

  it('3b: floor unknown -> 0.625410 possible, capped, never match', () => {
    const a = rec({ ...same, sourceId: 'x', geo: base, rentInr: 30000, areaSqft: 1100, floor: 3, photoHashes: [0n] });
    const b = rec({ ...same, sourceId: 'x', geo: at(25), rentInr: 30500, areaSqft: 1115, floor: null, photoHashes: [hashAt(22)] });
    const s = scorePair(a, b)!;
    expect(s.score).toBeCloseTo(0.62541, 5);
    expect(s.decision).toBe('possible');
    expect(s.cap).toBe('SAME_SOURCE_PHOTOS');
  });

  it('4: geo-less duplicate -> 0.8125 match', () => {
    const a = rec({ sourceId: 'x', geo: null, rentInr: 25000, areaSqft: 1000, titleTokens: ['a', 'b'], photoHashes: [0n] });
    const b = rec({ sourceId: 'y', geo: base, rentInr: 25000, areaSqft: null, titleTokens: ['a'], photoHashes: [hashAt(3)] });
    const s = scorePair(a, b)!;
    expect(s.features.title).toBeCloseTo(0.5, 12);
    expect(s.features.geoUnknown).toBe(true);
    expect(s.score).toBeCloseTo(0.8125, 9);
    expect(s.decision).toBe('match');
  });

  const relist = (h: number) => {
    const a = rec({ sourceId: 'x', geo: base, rentInr: 22000, areaSqft: 900, titleTokens: ['a'], photoHashes: [0n] });
    const b = rec({ sourceId: 'x', geo: base, rentInr: 21000, areaSqft: 900, titleTokens: ['a'], photoHashes: [hashAt(h)] });
    return scorePair(a, b)!;
  };
  it('5: same-source relisting H=5 -> 0.931818 match', () => {
    const s = relist(5);
    expect(s.score).toBeCloseTo(0.931818, 5);
    expect(s.decision).toBe('match');
  });
  it('5b: H=8 -> 0.861818 possible, capped', () => {
    const s = relist(8);
    expect(s.score).toBeCloseTo(0.861818, 5);
    expect(s.decision).toBe('possible');
    expect(s.cap).toBe('SAME_SOURCE_PHOTOS');
  });

  it('6: borderline -> 0.643187 possible', () => {
    const a = rec({ sourceId: 'x', geo: base, rentInr: 20000, areaSqft: null, titleTokens: ['a', 'b', 'c'], photoHashes: [0n] });
    const b = rec({ sourceId: 'y', geo: at(200), rentInr: 21000, areaSqft: 900, titleTokens: ['a', 'b', 'd', 'e'], photoHashes: [hashAt(9)] });
    const s = scorePair(a, b)!;
    expect(s.features.title).toBeCloseTo(0.4, 12);
    expect(s.score).toBeCloseTo(0.643187, 5);
    expect(s.decision).toBe('possible');
  });
});

describe('scorePair properties', () => {
  it('returns null when gated and orders ids', () => {
    const a = rec();
    expect(scorePair(a, rec({ bhk: 4 }))).toBeNull();
    const b = rec({ sourceId: 'y' });
    expect(scorePair(b, a)!.a < scorePair(b, a)!.b).toBe(true);
  });
  it('no photos caps a high score to possible', () => {
    const a = rec({ sourceId: 'x', photoHashes: [] });
    const b = rec({ sourceId: 'y', photoHashes: [] });
    const s = scorePair(a, b)!;
    expect(s.cap).toBe('NO_PHOTOS');
    expect(s.score).toBeGreaterThanOrEqual(0.78);
    expect(s.decision).toBe('possible');
  });
  it('furnishing mismatch subtracts 0.15', () => {
    const a = rec({ sourceId: 'x' });
    const s0 = scorePair(a, rec({ sourceId: 'y' }))!;
    const s1 = scorePair(a, rec({ sourceId: 'y', furnishing: 'furnished' }))!;
    expect(s0.score - s1.score).toBeCloseTo(0.15, 9);
  });
  it('featuresJson is JSON-safe (no bigint)', () => {
    const s = scorePair(rec({ sourceId: 'x' }), rec({ sourceId: 'y' }))!;
    const j = featuresJson(s);
    expect(() => JSON.stringify(j)).not.toThrow();
    expect(j.raw_decision).toBe(s.decision);
    expect(j.min_hamming).toBe(0);
  });
});
