/**
 * Stage 3: canonicalize locality. Alias/exact, then fuzzy (engine), then PostGIS nearest centroid.
 * PostGIS is only called for rows whose text did not resolve, or whose text is > 3 km from its own geo.
 */
import { buildLocalityIndex, haversineKm, normLocality, resolveLocality } from '@roofline/engine';
import { nearestLocality } from '@roofline/db/queries/locality';
import type { Db } from './db';
import type { Draft, LocalityInfo, RefData } from './types';

export const CONFLICT_KM = 3;
export const geoAcceptM = (l: LocalityInfo): number => Math.max(l.radiusM * 1.5, 1500);

export async function loadRefData(db: Db): Promise<RefData> {
  const locs = await db.query<{ id: number; slug: string; name: string; zone: string; lat: number; lng: number; radius_m: number }>(
    `SELECT id, slug, name, zone::text AS zone, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng, radius_m
       FROM localities ORDER BY id`,
  );
  const aliases = await db.query<{ alias_norm: string; locality_id: number }>(
    'SELECT alias_norm, locality_id FROM locality_aliases ORDER BY alias_norm',
  );
  const localities: LocalityInfo[] = locs.rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, zone: r.zone, lat: Number(r.lat), lng: Number(r.lng), radiusM: r.radius_m,
  }));
  const byAlias = new Map<number, string[]>();
  for (const a of aliases.rows) byAlias.set(a.locality_id, [...(byAlias.get(a.locality_id) ?? []), a.alias_norm]);
  const index = buildLocalityIndex(localities.map((l) => ({ id: String(l.id), name: l.name, aliases: byAlias.get(l.id) ?? [] })));
  return { localities, byId: new Map(localities.map((l) => [l.id, l])), index };
}

export interface UnmatchedSample {
  sample: string;
  count: number;
}

/** Resolve every draft in place. Returns the unresolved raw strings (keyed by normLocality) for curation. */
export async function canonicalizeLocality(drafts: Draft[], ref: RefData, db: Db): Promise<Map<string, UnmatchedSample>> {
  const unmatched = new Map<string, UnmatchedSample>();
  for (const d of drafts) {
    const text = resolveLocality(d.localityText, ref.index);
    const textId = text.id === null ? null : Number(text.id);
    const textLoc = textId === null ? undefined : ref.byId.get(textId);

    if (textLoc) {
      d.localityId = textLoc.id;
      d.localityMethod = text.method === 'fuzzy' ? 'fuzzy' : 'exact';
      text.flags.forEach((f) => d.flags.add(f));
      if (d.geoValid && haversineKm({ lat: d.lat as number, lng: d.lng as number }, textLoc) > CONFLICT_KM) {
        const near = await nearestLocality(d.lat as number, d.lng as number, db);
        const nearLoc = near ? ref.byId.get(near.id) : undefined;
        d.flags.add('LOCALITY_TEXT_GEO_CONFLICT');
        if (near && nearLoc && near.distanceM <= geoAcceptM(nearLoc)) {
          d.localityId = nearLoc.id;
          d.localityMethod = 'conflict_geo';
        } else {
          d.localityMethod = 'conflict_text';
        }
      }
      continue;
    }

    if (d.geoValid) {
      const near = await nearestLocality(d.lat as number, d.lng as number, db);
      const nearLoc = near ? ref.byId.get(near.id) : undefined;
      if (near && nearLoc && near.distanceM <= geoAcceptM(nearLoc)) {
        d.localityId = nearLoc.id;
        d.localityMethod = 'geo';
        d.localityFromGeo = true;
        d.flags.add('LOCALITY_FROM_GEO');
        continue;
      }
    }

    d.localityId = null;
    d.localityMethod = 'unresolved';
    const key = normLocality(d.localityText);
    if (key !== '') {
      const prev = unmatched.get(key);
      if (prev) prev.count += 1;
      else unmatched.set(key, { sample: d.localityText, count: 1 });
    }
  }
  return unmatched;
}
