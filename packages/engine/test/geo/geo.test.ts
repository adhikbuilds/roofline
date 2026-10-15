import { describe, expect, it } from 'vitest';
import {
  BANGALORE_BBOX,
  bboxContains,
  bboxExpand,
  geohashDecode,
  geohashEncode,
  geohashNeighbors,
  haversineKm,
} from '../../src/geo';

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm({ lat: 12.97, lng: 77.59 }, { lat: 12.97, lng: 77.59 })).toBe(0);
  });
  it.each([
    // [a, b, expected km, tolerance]
    [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, 111.195, 0.01],
    [{ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 }, 343.5, 1],
    [{ lat: 12.9716, lng: 77.5946 }, { lat: 13.0827, lng: 80.2707 }, 290, 5], // Bengaluru-Chennai approx
    [{ lat: 90, lng: 0 }, { lat: -90, lng: 0 }, 20015.09, 0.5],
  ])('computes %j -> %j', (a, b, km, tol) => {
    expect(Math.abs(haversineKm(a, b) - km)).toBeLessThan(tol);
  });
  it('is symmetric and handles antimeridian', () => {
    const a = { lat: 10, lng: 179.5 };
    const b = { lat: 10, lng: -179.5 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
    expect(haversineKm(a, b)).toBeLessThan(120);
  });
  it('rejects NaN, infinite and out-of-range coordinates', () => {
    expect(() => haversineKm({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 })).toThrow(RangeError);
    expect(() => haversineKm({ lat: 0, lng: Infinity }, { lat: 0, lng: 0 })).toThrow(RangeError);
    expect(() => haversineKm({ lat: 91, lng: 0 }, { lat: 0, lng: 0 })).toThrow(RangeError);
    expect(() => haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 181 })).toThrow(RangeError);
  });
});

describe('geohashEncode', () => {
  it.each([
    [57.64911, 10.40744, 11, 'u4pruydqqvj'],
    [42.605, -5.603, 5, 'ezs42'],
    [0, 0, 5, 's0000'],
    [-25.382708, -49.265506, 8, '6gkzwgjz'],
    [90, 180, 4, 'zzzz'],
    [-90, -180, 4, '0000'],
  ])('encodes (%d,%d) p=%d', (lat, lng, p, expected) => {
    expect(geohashEncode(lat, lng, p)).toBe(expected);
  });
  it('defaults to precision 6', () => {
    expect(geohashEncode(12.9716, 77.5946)).toHaveLength(6);
  });
  it('places Bengaluru in the tdr cell', () => {
    expect(geohashEncode(12.9716, 77.5946, 3)).toBe('tdr');
  });
  it('prefixes are consistent across precisions', () => {
    const full = geohashEncode(12.9352, 77.6245, 9);
    for (let p = 1; p < 9; p++) expect(geohashEncode(12.9352, 77.6245, p)).toBe(full.slice(0, p));
  });
  it('rejects bad precision and coordinates', () => {
    expect(() => geohashEncode(0, 0, 0)).toThrow(RangeError);
    expect(() => geohashEncode(0, 0, 13)).toThrow(RangeError);
    expect(() => geohashEncode(0, 0, 2.5)).toThrow(RangeError);
    expect(() => geohashEncode(NaN, 0, 5)).toThrow(RangeError);
    expect(() => geohashEncode(0, 200, 5)).toThrow(RangeError);
  });
});

describe('geohashDecode', () => {
  it('returns a bbox containing the encoded point and its center', () => {
    const h = geohashEncode(12.9716, 77.5946, 7);
    const d = geohashDecode(h);
    expect(bboxContains(d.bbox, { lat: 12.9716, lng: 77.5946 })).toBe(true);
    expect(d.center.lat).toBeGreaterThan(d.bbox.south);
    expect(d.center.lat).toBeLessThan(d.bbox.north);
  });
  it('rejects empty or invalid characters', () => {
    expect(() => geohashDecode('')).toThrow(RangeError);
    expect(() => geohashDecode('abc')).toThrow(RangeError); // 'a' not in alphabet
    expect(() => geohashDecode('TDR')).toThrow(RangeError);
  });
});

describe('geohashNeighbors', () => {
  it('returns 8 distinct neighbours of same length, none equal to self', () => {
    const h = geohashEncode(12.9716, 77.5946, 6);
    const n = geohashNeighbors(h);
    expect(n).toHaveLength(8);
    expect(new Set(n).size).toBe(8);
    expect(n).not.toContain(h);
    for (const x of n) expect(x).toHaveLength(6);
  });
  it('matches known neighbours of ezs42 (N,NE,E,SE,S,SW,W,NW)', () => {
    expect(geohashNeighbors('ezs42')).toEqual([
      'ezs48', 'ezs49', 'ezs43', 'ezs41', 'ezs40', 'ezefp', 'ezefr', 'ezefx',
    ]);
  });
  it('neighbours are adjacent: centers are about one cell apart', () => {
    const h = geohashEncode(12.9716, 77.5946, 6);
    const c = geohashDecode(h).center;
    for (const n of geohashNeighbors(h)) {
      const km = haversineKm(c, geohashDecode(n).center);
      expect(km).toBeGreaterThan(0.5);
      expect(km).toBeLessThan(1.8);
    }
  });
  it('wraps across the antimeridian', () => {
    const h = geohashEncode(10, 179.999, 5);
    const n = geohashNeighbors(h);
    expect(n).toHaveLength(8);
    expect(n.some((x) => geohashDecode(x).center.lng < 0)).toBe(true);
  });
  it('drops off-pole neighbours at the north edge', () => {
    const n = geohashNeighbors(geohashEncode(89.99999, 10, 4));
    expect(n.length).toBe(5);
    expect(new Set(n).size).toBe(n.length);
  });
  it('drops off-pole neighbours at the south edge', () => {
    expect(geohashNeighbors(geohashEncode(-89.99999, 10, 4)).length).toBe(5);
  });
  it('handles precision 1', () => {
    expect(geohashNeighbors('s').length).toBeGreaterThanOrEqual(5);
  });
  it('rejects invalid hash', () => {
    expect(() => geohashNeighbors('')).toThrow(RangeError);
    expect(() => geohashNeighbors('a1')).toThrow(RangeError);
  });
});

describe('bbox', () => {
  const box = { west: 0, south: 0, east: 10, north: 10 };
  it('BANGALORE_BBOX matches PLAN', () => {
    expect(BANGALORE_BBOX).toEqual({ west: 77.35, south: 12.7, east: 77.85, north: 13.25 });
  });
  it.each([
    [{ lat: 5, lng: 5 }, true],
    [{ lat: 0, lng: 0 }, true],
    [{ lat: 10, lng: 10 }, true],
    [{ lat: 10.0001, lng: 5 }, false],
    [{ lat: 5, lng: -0.0001 }, false],
  ])('contains %j -> %s', (p, expected) => {
    expect(bboxContains(box, p)).toBe(expected);
  });
  it('is false for NaN points', () => {
    expect(bboxContains(box, { lat: NaN, lng: 5 })).toBe(false);
    expect(bboxContains(box, { lat: 5, lng: NaN })).toBe(false);
  });
  it('contains Koramangala but not (0,0) or Mysuru', () => {
    expect(bboxContains(BANGALORE_BBOX, { lat: 12.9352, lng: 77.6245 })).toBe(true);
    expect(bboxContains(BANGALORE_BBOX, { lat: 0, lng: 0 })).toBe(false);
    expect(bboxContains(BANGALORE_BBOX, { lat: 12.2958, lng: 76.6394 })).toBe(false);
  });
  it('expands to include an outside point without mutating', () => {
    const copy = { ...box };
    expect(bboxExpand(box, { lat: 12, lng: -3 })).toEqual({ west: -3, south: 0, east: 10, north: 12 });
    expect(bboxExpand(box, { lat: -1, lng: 20 })).toEqual({ west: 0, south: -1, east: 20, north: 10 });
    expect(box).toEqual(copy);
  });
  it('leaves bbox unchanged for an inside point', () => {
    expect(bboxExpand(box, { lat: 5, lng: 5 })).toEqual(box);
  });
  it('rejects NaN point on expand', () => {
    expect(() => bboxExpand(box, { lat: NaN, lng: 1 })).toThrow(RangeError);
  });
});
