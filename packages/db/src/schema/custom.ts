import { customType } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Decode the hex (E)WKB PostGIS returns for a Point. Handles both byte orders and an optional SRID. */
export function parseEwkbPoint(hex: string): GeoPoint {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length < 21) throw new Error('Invalid EWKB point: too short');
  const little = buf.readUInt8(0) === 1;
  const type = little ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  if ((type & 0xff) !== 1) throw new Error(`Invalid EWKB: geometry type ${type & 0xff} is not a Point`);
  let offset = 5;
  if (type & 0x20000000) offset += 4;
  if (buf.length < offset + 16) throw new Error('Invalid EWKB point: truncated');
  const lng = little ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
  const lat = little ? buf.readDoubleLE(offset + 8) : buf.readDoubleBE(offset + 8);
  return { lat, lng };
}

/**
 * geography(Point, 4326). Reads decode to {lat, lng}; writes bind lng/lat as parameters and build
 * the point server-side, so no user text ever reaches the SQL string.
 */
export const geographyPoint = customType<{ data: GeoPoint; driverData: string | SQL }>({
  dataType: () => 'geography(Point,4326)',
  toDriver: (value): SQL => sql`ST_SetSRID(ST_MakePoint(${value.lng}, ${value.lat}), 4326)::geography`,
  fromDriver: (value) => parseEwkbPoint(value as string),
});

export const citext = customType<{ data: string }>({ dataType: () => 'citext' });
export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
