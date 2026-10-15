export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** Axis-aligned box in degrees. Does not model antimeridian-crossing boxes. */
export interface BBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}
