import type { BBox, LatLng } from './types';

/** Bangalore service area (PLAN.md section 3: 12.70-13.25 N, 77.35-77.85 E). */
export const BANGALORE_BBOX: BBox = Object.freeze({
  west: 77.35,
  south: 12.7,
  east: 77.85,
  north: 13.25,
});

/** Inclusive containment. Non-finite points are never contained. */
export function bboxContains(box: BBox, p: LatLng): boolean {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  return p.lat >= box.south && p.lat <= box.north && p.lng >= box.west && p.lng <= box.east;
}

/** Smallest box containing `box` and `p`. Returns a new object. */
export function bboxExpand(box: BBox, p: LatLng): BBox {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    throw new RangeError('bboxExpand: point must be finite');
  }
  return {
    west: Math.min(box.west, p.lng),
    south: Math.min(box.south, p.lat),
    east: Math.max(box.east, p.lng),
    north: Math.max(box.north, p.lat),
  };
}
