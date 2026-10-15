import { assertLatLng } from './haversine';
import type { BBox, LatLng } from './types';

const ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';
const MAX_PRECISION = 12;

/** Encode a point as a geohash of `precision` characters (1-12, default 6). */
export function geohashEncode(lat: number, lng: number, precision = 6): string {
  assertLatLng({ lat, lng }, 'geohashEncode');
  if (!Number.isInteger(precision) || precision < 1 || precision > MAX_PRECISION) {
    throw new RangeError('geohashEncode: precision must be an integer 1-12');
  }
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let out = '';
  let bit = 0;
  let idx = 0;
  let evenBit = true; // even bits encode longitude
  while (out.length < precision) {
    if (evenBit) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) {
        idx = idx * 2 + 1;
        lngLo = mid;
      } else {
        idx = idx * 2;
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latLo = mid;
      } else {
        idx = idx * 2;
        latHi = mid;
      }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      out += ALPHABET[idx];
      bit = 0;
      idx = 0;
    }
  }
  return out;
}

function validate(hash: string, fn: string): void {
  if (hash.length === 0) throw new RangeError(`${fn}: empty geohash`);
  for (const ch of hash) {
    if (!ALPHABET.includes(ch)) throw new RangeError(`${fn}: invalid character '${ch}'`);
  }
}

/** Decode a geohash to its cell bbox and center. */
export function geohashDecode(hash: string): { bbox: BBox; center: LatLng } {
  validate(hash, 'geohashDecode');
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let evenBit = true;
  for (const ch of hash) {
    const v = ALPHABET.indexOf(ch);
    for (let b = 4; b >= 0; b--) {
      const on = (v >> b) & 1;
      if (evenBit) {
        const mid = (lngLo + lngHi) / 2;
        if (on) lngLo = mid;
        else lngHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (on) latLo = mid;
        else latHi = mid;
      }
      evenBit = !evenBit;
    }
  }
  return {
    bbox: { west: lngLo, south: latLo, east: lngHi, north: latHi },
    center: { lat: (latLo + latHi) / 2, lng: (lngLo + lngHi) / 2 },
  };
}

/**
 * The up-to-8 adjacent cells in order N, NE, E, SE, S, SW, W, NW.
 * Longitude wraps across the antimeridian; neighbours beyond a pole are omitted.
 */
export function geohashNeighbors(hash: string): string[] {
  validate(hash, 'geohashNeighbors');
  const { bbox, center } = geohashDecode(hash);
  const dLat = bbox.north - bbox.south;
  const dLng = bbox.east - bbox.west;
  const steps: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];
  const out: string[] = [];
  for (const [vy, vx] of steps) {
    const lat = center.lat + vy * dLat;
    if (lat > 90 || lat < -90) continue;
    let lng = center.lng + vx * dLng;
    if (lng > 180) lng -= 360;
    else if (lng < -180) lng += 360;
    out.push(geohashEncode(lat, lng, hash.length));
  }
  return out;
}
