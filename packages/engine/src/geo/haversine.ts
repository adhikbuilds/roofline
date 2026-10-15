import type { LatLng } from './types';

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;

export function assertLatLng(p: LatLng, fn: string): void {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    throw new RangeError(`${fn}: coordinates must be finite`);
  }
  if (p.lat < -90 || p.lat > 90) throw new RangeError(`${fn}: lat out of range`);
  if (p.lng < -180 || p.lng > 180) throw new RangeError(`${fn}: lng out of range`);
}

/** Great-circle distance in kilometres (mean Earth radius 6371.0088 km). */
export function haversineKm(a: LatLng, b: LatLng): number {
  assertLatLng(a, 'haversineKm');
  assertLatLng(b, 'haversineKm');
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
