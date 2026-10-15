/**
 * Compare the Drizzle schema with the live database (information_schema.columns and pg_enum).
 * Any mismatch exits 1 so `pnpm verify` fails: tables and columns missing from the database,
 * columns the Drizzle schema does not know about, type or nullability changes, enum label changes.
 */
import type { PoolClient } from 'pg';
import { getTableConfig, isPgEnum, type PgEnum } from 'drizzle-orm/pg-core';
import { is, Table } from 'drizzle-orm';
import * as publicSchema from './schema/index.js';
import * as seedTruthSchema from './schema/seed-truth.js';

const schema = { ...publicSchema, ...seedTruthSchema };

type Queryable = Pick<PoolClient, 'query'>;

interface DbColumn {
  table_schema: string;
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
  udt_name: string;
}

/** Map a Drizzle SQL type to the udt_name Postgres reports in information_schema.columns. */
export function expectedUdt(sqlType: string): string {
  const t = sqlType.trim().toLowerCase();
  if (t.endsWith('[]')) return `_${expectedUdt(t.slice(0, -2))}`;
  const base = t.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  const known: Record<string, string> = {
    smallint: 'int2', smallserial: 'int2', integer: 'int4', int: 'int4', serial: 'int4',
    bigint: 'int8', bigserial: 'int8', text: 'text', boolean: 'bool', char: 'bpchar',
    character: 'bpchar', varchar: 'varchar', numeric: 'numeric', real: 'float4',
    'double precision': 'float8', uuid: 'uuid', jsonb: 'jsonb', json: 'json', geography: 'geography',
    'timestamp with time zone': 'timestamptz', 'timestamp without time zone': 'timestamp',
    timestamp: 'timestamp', date: 'date', citext: 'citext', tsvector: 'tsvector',
  };
  return known[base] ?? base;
}

export async function findDrift(client: Queryable): Promise<string[]> {
  const problems: string[] = [];

  const cols = await client.query<DbColumn>(
    `SELECT table_schema, table_name, column_name, is_nullable, udt_name
       FROM information_schema.columns
      WHERE table_schema IN ('public', 'seed_truth')`,
  );
  const dbCols = new Map<string, DbColumn>();
  const dbTables = new Set<string>();
  for (const c of cols.rows) {
    dbCols.set(`${c.table_schema}.${c.table_name}.${c.column_name}`, c);
    dbTables.add(`${c.table_schema}.${c.table_name}`);
  }

  for (const value of Object.values(schema)) {
    if (!is(value, Table)) continue;
    const cfg = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    const schemaName = cfg.schema ?? 'public';
    const tableKey = `${schemaName}.${cfg.name}`;
    const label = schemaName === 'public' ? cfg.name : tableKey;
    if (!dbTables.has(tableKey)) {
      problems.push(`table ${label} is missing from the database`);
      continue;
    }
    const known = new Set<string>();
    for (const col of cfg.columns) {
      known.add(col.name);
      const db = dbCols.get(`${tableKey}.${col.name}`);
      if (!db) {
        problems.push(`${label}.${col.name} is missing from the database`);
        continue;
      }
      const want = expectedUdt(col.getSQLType());
      if (db.udt_name !== want) {
        problems.push(`${label}.${col.name} type mismatch: database ${db.udt_name}, drizzle ${want}`);
      }
      const dbNotNull = db.is_nullable === 'NO';
      if (dbNotNull !== col.notNull) {
        problems.push(
          `${label}.${col.name} nullability mismatch: database ${dbNotNull ? 'NOT NULL' : 'NULL'}, drizzle ${col.notNull ? 'NOT NULL' : 'NULL'}`,
        );
      }
    }
    for (const c of cols.rows) {
      if (`${c.table_schema}.${c.table_name}` === tableKey && !known.has(c.column_name)) {
        problems.push(`${label}.${c.column_name} exists in the database but is not in Drizzle`);
      }
    }
  }

  const labels = await client.query<{ typname: string; labels: string[] }>(
    `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
      GROUP BY t.typname`,
  );
  const dbEnums = new Map(labels.rows.map((r) => [r.typname, r.labels]));
  const drizzleEnums = new Map<string, readonly string[]>();
  for (const value of Object.values(schema)) {
    if (isPgEnum(value)) {
      const e = value as PgEnum<[string, ...string[]]>;
      drizzleEnums.set(e.enumName, e.enumValues);
    }
  }
  for (const [name, values] of drizzleEnums) {
    const db = dbEnums.get(name);
    if (!db) problems.push(`enum ${name} is missing from the database`);
    else if (db.join(',') !== values.join(',')) {
      problems.push(`enum ${name} labels differ: database [${db.join(', ')}], drizzle [${values.join(', ')}]`);
    }
  }
  for (const name of dbEnums.keys()) {
    if (!drizzleEnums.has(name)) problems.push(`enum ${name} exists in the database but is not in Drizzle`);
  }

  return problems;
}

async function main(): Promise<void> {
  const { withAdmin, close, describeTarget } = await import('./client.js');
  try {
    const problems = await withAdmin((client) => findDrift(client));
    if (problems.length > 0) {
      console.error(`check-drift: ${problems.length} problem(s) against ${describeTarget()}`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exitCode = 1;
    } else {
      const tables = Object.values(schema).filter((v) => is(v, Table)).length;
      console.log(`check-drift: ${tables} tables match ${describeTarget()}`);
    }
  } finally {
    await close();
  }
}

// Run only as the package script (vite-node does not expose the entry path in argv).
if (process.env['npm_lifecycle_event'] === 'check-drift') {
  main().catch((error: unknown) => {
    console.error(`check-drift failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
