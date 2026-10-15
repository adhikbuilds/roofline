import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SeedRefs } from '../../src/adapters/synthetic/generate';

const REF = resolve(import.meta.dirname, '../../../db/reference');

interface L { name: string; slug: string; zone: string; lat: number; lng: number; radiusM: number; base2bhkHint: number }

/** Reference data straight from the db package JSON (the same files db:reference loads). */
export function loadRefs(): SeedRefs {
  const ls = JSON.parse(readFileSync(resolve(REF, 'localities.json'), 'utf8')) as L[];
  const as = JSON.parse(readFileSync(resolve(REF, 'aliases.json'), 'utf8')) as { alias: string; locality: string }[];
  const slugByName = new Map(ls.map((l) => [l.name, l.slug]));
  return {
    localities: ls.map((l) => ({
      slug: l.slug, name: l.name, zone: l.zone, lat: l.lat, lng: l.lng, radiusM: l.radiusM, base2bhk: l.base2bhkHint,
    })),
    aliases: as.map((a) => ({ alias: a.alias, slug: slugByName.get(a.locality) as string })),
  };
}
