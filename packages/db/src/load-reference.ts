/** Idempotent upsert of packages/db/reference/*.json. `pnpm --filter @roofline/db load-reference` */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';

export const REFERENCE_DIR = resolve(import.meta.dirname, '../reference');

type Queryable = Pick<PoolClient, 'query'>;

interface LocalityRow { name: string; slug: string; zone: string; lat: number; lng: number; radiusM: number; base2bhkHint: number }
interface AliasRow { alias: string; locality: string }
interface StationRow { name: string; line: string; seq: number; lat: number; lng: number; status: string }
interface MetroFile {
  stations: StationRow[];
  interchanges: { station: string; lines: string[]; minutes: number }[];
}
interface PresetRow { slug: string; name: string; lat: number; lng: number }
interface SourceRow {
  id: string; display_name: string; license_kind: string; terms: string; attribution: string;
  is_synthetic: boolean; priority: number;
}

export interface ReferenceCounts {
  localities: number;
  aliases: number;
  metroStations: number;
  metroEdges: number;
  workPresets: number;
  sources: number;
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(resolve(REFERENCE_DIR, name), 'utf8')) as T;
}

/** Average metro speed ~ 35 km/h plus 0.5 min dwell, one decimal, never under 1.5 min. */
function rideMinutes(a: StationRow, b: StationRow): number {
  const R = 6371.0088;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(h));
  return Math.max(1.5, Math.round((km / 35) * 60 * 10 + 5) / 10);
}

const POINT = 'ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography';

/** Upsert everything in one transaction; safe to run any number of times. */
export async function loadReference(client: Queryable): Promise<ReferenceCounts> {
  const [localities, aliases, metro, presets, sources] = await Promise.all([
    readJson<LocalityRow[]>('localities.json'),
    readJson<AliasRow[]>('aliases.json'),
    readJson<MetroFile>('metro.json'),
    readJson<PresetRow[]>('presets.json'),
    readJson<SourceRow[]>('sources.json'),
  ]);

  await client.query('BEGIN');
  try {
    for (const s of sources) {
      await client.query(
        `INSERT INTO sources (id, display_name, license_kind, terms, attribution, is_synthetic, priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
           license_kind = EXCLUDED.license_kind, terms = EXCLUDED.terms,
           attribution = EXCLUDED.attribution, is_synthetic = EXCLUDED.is_synthetic,
           priority = EXCLUDED.priority`,
        [s.id, s.display_name, s.license_kind, s.terms, s.attribution, s.is_synthetic, s.priority],
      );
    }

    for (const l of localities) {
      await client.query(
        `INSERT INTO localities (slug, name, zone, centroid, radius_m, approx, base_2bhk_hint)
         VALUES ($3, $4, $5::locality_zone, ${POINT}, $6, true, $7)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, zone = EXCLUDED.zone,
           centroid = EXCLUDED.centroid, radius_m = EXCLUDED.radius_m,
           base_2bhk_hint = EXCLUDED.base_2bhk_hint`,
        [l.lng, l.lat, l.slug, l.name, l.zone, l.radiusM, l.base2bhkHint],
      );
    }

    const ids = await client.query<{ id: number; name: string }>('SELECT id, name FROM localities');
    const idByName = new Map(ids.rows.map((r) => [r.name, r.id]));
    for (const a of aliases) {
      const localityId = idByName.get(a.locality);
      if (localityId === undefined) throw new Error(`alias "${a.alias}" points at unknown locality "${a.locality}"`);
      await client.query(
        `INSERT INTO locality_aliases (alias_norm, locality_id, origin) VALUES ($1, $2, 'curated')
         ON CONFLICT (alias_norm) DO UPDATE SET locality_id = EXCLUDED.locality_id
           WHERE locality_aliases.origin = 'curated'`,
        [a.alias, localityId],
      );
    }

    for (const p of presets) {
      await client.query(
        `INSERT INTO work_presets (slug, name, geom, approx) VALUES ($3, $4, ${POINT}, true)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom`,
        [p.lng, p.lat, p.slug, p.name],
      );
    }

    for (const s of metro.stations) {
      await client.query(
        `INSERT INTO metro_stations (name, line, seq, geom, status, approx)
         VALUES ($3, $4::metro_line, $5, ${POINT}, $6::metro_status, true)
         ON CONFLICT (line, seq) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom,
           status = EXCLUDED.status`,
        [s.lng, s.lat, s.name, s.line, s.seq, s.status],
      );
    }
    const st = await client.query<{ id: number; line: string; seq: number }>(
      'SELECT id, line::text AS line, seq FROM metro_stations',
    );
    const stationId = new Map(st.rows.map((r) => [`${r.line}:${r.seq}`, r.id]));
    const idOf = (line: string, seq: number): number => {
      const id = stationId.get(`${line}:${seq}`);
      if (id === undefined) throw new Error(`metro station ${line}:${seq} was not loaded`);
      return id;
    };

    // Edges are derived data: rebuild them wholesale so removed stations leave no stale edges.
    await client.query('DELETE FROM metro_edges');
    const insertEdge = (from: number, to: number, minutes: number, kind: 'ride' | 'interchange') =>
      client.query(
        `INSERT INTO metro_edges (from_id, to_id, minutes, kind) VALUES ($1,$2,$3,$4::metro_edge_kind)`,
        [from, to, minutes, kind],
      );
    const byLine = new Map<string, StationRow[]>();
    for (const s of metro.stations) byLine.set(s.line, [...(byLine.get(s.line) ?? []), s]);
    for (const [line, list] of byLine) {
      const sorted = [...list].sort((a, b) => a.seq - b.seq);
      for (let i = 0; i + 1 < sorted.length; i++) {
        const a = sorted[i] as StationRow;
        const b = sorted[i + 1] as StationRow;
        const minutes = rideMinutes(a, b);
        await insertEdge(idOf(line, a.seq), idOf(line, b.seq), minutes, 'ride');
        await insertEdge(idOf(line, b.seq), idOf(line, a.seq), minutes, 'ride');
      }
    }
    for (const x of metro.interchanges) {
      const members = x.lines.map((line) => {
        const s = metro.stations.find((m) => m.name === x.station && m.line === line);
        if (!s) throw new Error(`interchange ${x.station} has no station on ${line}`);
        return idOf(line, s.seq);
      });
      for (const a of members) for (const b of members) if (a !== b) await insertEdge(a, b, x.minutes, 'interchange');
    }

    const n = async (table: string): Promise<number> =>
      Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n);
    const counts: ReferenceCounts = {
      localities: await n('localities'),
      aliases: await n('locality_aliases'),
      metroStations: await n('metro_stations'),
      metroEdges: await n('metro_edges'),
      workPresets: await n('work_presets'),
      sources: await n('sources'),
    };
    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  const { pool, close, describeTarget } = await import('./client.js');
  const client = await pool.connect();
  try {
    const counts = await loadReference(client);
    console.log(`load-reference: ${describeTarget()}`, counts);
  } finally {
    client.release();
    await close();
  }
}

// Run only as the package script (vite-node does not expose the entry path in argv).
if (process.env['npm_lifecycle_event'] === 'load-reference') {
  main().catch((error: unknown) => {
    console.error(`load-reference failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
