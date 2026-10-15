import type { PoolClient } from 'pg';
import { pool } from '../client.js';

export interface NearestLocality {
  id: number;
  slug: string;
  name: string;
  distanceM: number;
}

type Queryable = Pick<PoolClient, 'query'>;

/**
 * Nearest locality centroid to a point, by great-circle distance on the geography type.
 * `<->` drives the GIST KNN index; ST_Distance reports metres. Coordinates are bound parameters.
 */
export async function nearestLocality(
  lat: number,
  lng: number,
  db: Queryable = pool,
): Promise<NearestLocality | null> {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError('nearestLocality: lat must be a finite number between -90 and 90');
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new RangeError('nearestLocality: lng must be a finite number between -180 and 180');
  }
  const { rows } = await db.query<{ id: number; slug: string; name: string; distance_m: number }>(
    `WITH p AS (SELECT ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography AS g)
     SELECT l.id, l.slug, l.name, ST_Distance(l.centroid, p.g) AS distance_m
       FROM localities l, p
      ORDER BY l.centroid <-> p.g
      LIMIT 1`,
    [lat, lng],
  );
  const row = rows[0];
  return row ? { id: row.id, slug: row.slug, name: row.name, distanceM: Number(row.distance_m) } : null;
}
