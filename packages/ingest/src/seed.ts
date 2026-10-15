/** `pnpm db:seed`: reference data, then the 26 weekly synthetic runs and the seed_truth tables. */
import { createSyntheticAdapters, generateSeed, writeTruth, SOURCES, WEEKS, weekAsOf, summarize } from './adapters/synthetic';
import type { SeedRefs } from './adapters/synthetic';
import type { Db } from './pipeline/db';
import { loadRefData } from './pipeline/locality';
import { runWeek } from './pipeline/run';

export async function loadSeedRefs(db: Db): Promise<{ refs: SeedRefs; localityIdBySlug: Map<string, number> }> {
  const locs = await db.query<{ id: number; slug: string; name: string; zone: string; lat: number; lng: number; radius_m: number; hint: number | null }>(
    `SELECT id, slug, name, zone::text AS zone, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng,
            radius_m, base_2bhk_hint AS hint FROM localities ORDER BY slug`,
  );
  const aliases = await db.query<{ alias_norm: string; slug: string }>(
    `SELECT a.alias_norm, l.slug FROM locality_aliases a JOIN localities l ON l.id = a.locality_id ORDER BY a.alias_norm`,
  );
  return {
    refs: {
      localities: locs.rows.map((r) => ({ slug: r.slug, name: r.name, zone: r.zone, lat: Number(r.lat), lng: Number(r.lng), radiusM: r.radius_m, base2bhk: r.hint })),
      aliases: aliases.rows.map((a) => ({ alias: a.alias_norm, slug: a.slug })),
    },
    localityIdBySlug: new Map(locs.rows.map((r) => [r.slug, r.id])),
  };
}

export interface SeedOutcome {
  weeks: number;
  runs: number;
  units: number;
  rows: number;
}

export async function seedSynthetic(db: Db, log: (line: string) => void = () => {}): Promise<SeedOutcome> {
  const existing = await db.query<{ n: string }>(
    'SELECT count(*) AS n FROM ingest_runs WHERE source_id = ANY($1::text[])',
    [SOURCES.map((s) => s.sourceId)],
  );
  if (Number(existing.rows[0]?.n) > 0) {
    throw new Error('synthetic seed is already loaded; run `pnpm db:fresh` to rebuild from scratch');
  }
  const { refs, localityIdBySlug } = await loadSeedRefs(db);
  const ds = generateSeed(refs);
  const s = summarize(ds);
  log(`generated ${s.rows} source rows for ${s.units} units (${s.flatUnits} flats/houses, ${s.pgUnits} PG offerings)`);

  await db.query('BEGIN');
  try {
    const t = await writeTruth(db, ds, localityIdBySlug);
    await db.query('COMMIT');
    log(`seed_truth: ${t.units} units, ${t.sourceRows} source rows, ${t.trueRent} true-rent points, ${t.trueDeals} planted deals`);
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }

  const adapters = createSyntheticAdapters(ds);
  const ref = await loadRefData(db);
  let runs = 0;
  for (let w = 0; w < WEEKS; w++) {
    const asOf = weekAsOf(w);
    log(`week ${String(w).padStart(2, '0')} as_of ${asOf.toISOString().slice(0, 10)}`);
    const results = await runWeek(db, adapters, asOf, { ref, log: w === 0 || w === WEEKS - 1 ? log : undefined });
    runs += results.length;
  }
  return { weeks: WEEKS, runs, units: s.units, rows: s.rows };
}
