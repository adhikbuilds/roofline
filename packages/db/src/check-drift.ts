/**
 * Skeleton. From Phase 1: migrate a scratch DB, then compare information_schema.columns and enum
 * labels to Drizzle getTableConfig() output; a mismatch exits 1 and fails `pnpm verify`.
 */
import * as schema from './schema/index.js';

const tables = Object.keys(schema).length;
console.log(`check-drift: ${tables} Drizzle table(s) registered; nothing to compare yet.`);
