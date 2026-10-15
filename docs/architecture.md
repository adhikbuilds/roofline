# Architecture (v1)

**Last Updated:** 2026-10-16
**Status:** v1 = Phase 0 (scaffold, shell) and Phase 1 (data foundation). Items marked *planned* are in PLAN.md and do not exist in the code yet.

Roofline is a pnpm monorepo: one Next.js app, three libraries. The engine is pure domain logic, the database package owns schema and access, and the ingest package turns sources into accepted listings.

## 1. Context

```
                 SourceAdapter[]                       (v1: synthetic only)
  +-----------------------------------------------+
  | synthetic (seeded, 5 fictional sources)        |
  | csv-feed, owner-submission          (planned)  |
  +----------------------+------------------------+
                         | fetch (AsyncIterable<RawListing>)
  +----------------------v------------------------+        +----------------------------+
  | @roofline/ingest                              |        | @roofline/engine           |
  |  cli.ts  seed.ts  eval/  pipeline/            |<------>| pure: normalize, locality, |
  |  raw -> normalize -> locality -> quality      |  pure  | geo, stats, quality, trace,|
  |  -> persist                                   |  calls | flags, money, version      |
  +----------------------+------------------------+        +-------------^--------------+
                         | writes (admin role)                          | imports pure fns
  +----------------------v------------------------+                       |
  | @roofline/db                                  |                       |
  |  Postgres 16 + PostGIS (docker, :5432)        |                       |
  |  migrations/*.sql, Drizzle schema, pool,      |                       |
  |  withAdmin / withUser, queries/, reference    |                       |
  +----------------------^------------------------+                       |
                         | reads (shared pool today)                    |
  +----------------------+------------------------+-----------------------+
  | apps/web (Next.js 15, :3000)                  |
  |  app/ (RSC pages, route handlers), lib/, components/shell/
  +-----------------------------------------------+
```

## 2. Packages and codemap

Every path below is relative to the repository root. The table lists what exists today.

### `@roofline/engine` (`packages/engine`)

Pure TypeScript. No I/O, no clock (`asOf` is an input), no randomness, no dependencies. Enforced by ESLint and dependency-cruiser.

| Module | Files | Exports (main) | Used by |
|---|---|---|---|
| root | `src/index.ts`, `src/version.ts`, `src/trace.ts`, `src/flags.ts`, `src/money.ts` | `ENGINE_VERSION`, `createTrace`, `formatTrace`, `readFlags`, `formatINR`, `formatINRShort` | web, ingest |
| `geo/` | `bbox.ts`, `geohash.ts`, `haversine.ts`, `types.ts` | `haversineKm`, `geohashEncode/Decode/Neighbors`, `BANGALORE_BBOX`, `bboxContains`, `bboxExpand` | ingest, quality |
| `stats/` | `descriptive.ts`, `theil-sen.ts`, `weighted.ts`, `validate.ts` | `median`, `quantile(s)`, `mad`, `iqr`, `theilSenSlope`, `weightedMedian` | quality, repair |
| `normalize/` | `money.ts`, `area.ts`, `unit.ts`, `furnishing.ts`, `pg.ts`, `other.ts`, `tokens.ts`, `types.ts` | `parseMoney`, `parseRent`, `parseDeposit`, `repairRent`, area, unit, furnishing and PG parsers | ingest |
| `locality/` | `norm.ts`, `jaro-winkler.ts`, `resolve.ts` | `normLocality`, `isStopLocality`, `jaroWinkler`, `buildLocalityIndex`, `resolveLocality` | ingest |
| `quality/` | `constants.ts`, `types.ts`, `rules.ts`, `outliers.ts`, `assess.ts` | `REASON_CODES`, `WARNING_CODES`, `QUALITY_BOUNDS`, `OUTLIER_PARAMS`, `hardRules`, `buildBaseline`, `checkOutlier`, `assessRow`, `assessBatch` | ingest, synthetic generator |

Tests live in `packages/engine/test/` (one folder per module). Coverage reports exist under `packages/engine/coverage/` (generated, not maintained).

*Planned:* `dedup/`, `fairrent/`, `deals/`, `commute/`, `tco/`, `filters/`, `alerts/`, `query/` (PLAN.md section 3).

### `@roofline/db` (`packages/db`)

Owns the schema, the connection pool, the role model and reference data. May import the engine for types and enums. Must not import ingest or web.

| Path | Purpose |
|---|---|
| `migrations/0001_extensions_roles.sql` | Extensions (`postgis`, `pg_trgm`, `citext`, `pgcrypto`), role `roofline_app` (NOLOGIN), schema `seed_truth` (revoked from public and app) |
| `migrations/0002_reference.sql` | `localities`, `locality_aliases`, `locality_unmatched`, `metro_stations`, `metro_edges`, `work_presets`, `sources`; app SELECT grants |
| `migrations/0003_ingest.sql` | Enums (`unit_kind`, `furnishing`, `pg_sharing`, `pg_gender`, `parking_kind`, `quality_status`, `ingest_run_status`), `ingest_runs`, `raw_listings`, `source_listings`, `price_observations`, `seed_truth.{units, source_rows, true_rent, true_deals}` |
| `migrations/0004_listings.sql` | `listings`, `listing_redirects`, `dedup_pairs` (admin only), `model_runs`, `fair_rent_estimates`; app SELECT grants |
| `src/client.ts` | `pool`, `withAdmin(fn)`, `withUser(userId, fn)`, `close()`, dotenv loader, TLS for non-localhost |
| `src/migrator.ts`, `src/migrate.ts` | Checksum migrator with `schema_migrations`; refuses edited migrations |
| `src/reset.ts` | Drops and recreates `public` and `seed_truth`; refuses non-local URLs |
| `src/load-reference.ts` | Idempotent upsert of `reference/*.json` (69 localities, 136 aliases, metro, 12 presets, sources) |
| `src/check-drift.ts` | Compares `information_schema.columns` and `pg_enum` in the live database with the Drizzle `getTableConfig()` output |
| `src/schema/` | Drizzle definitions: `custom.ts` (geography `customType`, EWKB parsing), `enums.ts`, `reference.ts`, `ingest.ts`, `listings.ts` |
| `src/queries/locality.ts` | `nearestLocality()`: PostGIS nearest-centroid lookup (used by ingest stage 3) |
| `reference/*.json` | Localities, aliases, metro data, work presets, sources |
| `docker/` | `Dockerfile` (PostGIS fallback build), `init/01-test-db.sql` (creates `roofline_test`) |

Tests: `packages/db/test/`. Integration tests share one database and run serially (`fileParallelism: false`).

### `@roofline/ingest` (`packages/ingest`)

Sources, pipeline and the synthetic seed. May import engine and db. Must not import web.

| Path | Purpose |
|---|---|
| `src/adapter.ts` | `SourceAdapter` and `RawListing` contracts |
| `src/ids.ts` | `uuidFor` (deterministic UUIDs), `stableStringify`, `sha256Hex`, source listing and listing ids |
| `src/adapters/synthetic/` | `generate.ts`, `params.ts`, `render.ts`, `rng.ts`, `truth.ts`, `adapter.ts`, `index.ts`: the fictional-data generator (see `data-provenance.md`) |
| `src/pipeline/run.ts` | `runWeek()`: one weekly run in one transaction |
| `src/pipeline/raw.ts` | Stage 1: store changed raw payloads |
| `src/pipeline/normalize.ts`, `extract.ts` | Stage 2: engine parsers; rule-based extraction from free-text descriptions |
| `src/pipeline/locality.ts` | Stage 3: alias and fuzzy match, then PostGIS for unresolved or geo-distant rows |
| `src/pipeline/quality.ts` | Stage 4: repair, deposit, hard rules, outlier baseline (see `methodology.md`) |
| `src/pipeline/persist.ts` | Upserts `source_listings`, placeholder `listings`, `price_observations`; delists missing rows |
| `src/pipeline/db.ts`, `types.ts` | `Db` interface, draft and stats types |
| `src/seed.ts` | `loadSeedRefs()`, `seedSynthetic()`: ground truth first, then 26 weekly runs |
| `src/eval/quality.ts` | `evalQuality()`: planted rejects vs. pipeline rejects |
| `src/cli.ts` | `roofline-ingest` commander CLI: `run [--week n]`, `seed`, `eval quality` |
| `test/` | Unit tests, fixture adapter, pipeline integration test (40-row fixture), generator snapshot |

*Planned:* `adapters/csv-feed/`, `adapters/owner-submission/` (schema only in v1), `llm/` (optional LLM extraction), pipeline stages 5 to 8.

### `@roofline/web` (`apps/web`)

Next.js 15 App Router, React 19, Tailwind v4 (planned tokens in `@theme`).

| Path | Purpose |
|---|---|
| `app/layout.tsx`, `app/globals.css` | Root layout, shell, design-direction comment block |
| `app/page.tsx` | Home: ledger header counts and a listing table (`getLedger`, `getListings`) |
| `app/localities/page.tsx` | Table of localities with active listing counts and median 2 BHK rent (`getLocalities`) |
| `app/img/plate/[seed]/route.ts` | Deterministic SVG floor-plan plate. The seed must match `^[a-z0-9-]{1,64}$` |
| `app/api/health/route.ts` | `GET /api/health` returns `{ ok, engine, dataMode }` |
| `app/not-found.tsx` | 404 page |
| `lib/queries.ts` | Server-side reads (parameterized) through the shared pool |
| `lib/plate.ts` | Plate SVG generator and seed validation regex |
| `lib/env.ts` | `DATA_MODE` from `ROOFLINE_DATA_MODE` |
| `components/shell/` | `Header`, `Footer`, `Logo`, `DisclosureBar`, `NavLinks`, `nav.ts` |
| `e2e/` | Playwright specs (`smoke`, `listings`) and a map style fixture |

*Planned routes (PLAN.md section 7):* `/pgs`, `/deals`, `/compare`, `/analytics`, `/analytics/quality`, `/listing/[id]`, `/localities/[slug]`, `/activity`, `/signin`, `/about`, `/methodology`, `/api-docs`, `/dev/mail`, `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/api/v1/**`, `/api/me/**`, `/api/auth/**`.

### Scripts (`scripts/`)

| File | Purpose |
|---|---|
| `preflight.ts` | `pnpm preflight`: Node, pnpm, Docker, and ports 5432 and 3000 |
| `brand-guard.ts` | `pnpm brand-guard`: fails on banned reference-product names outside exempt files |
| `screens.ts` | `pnpm screens`: headless Chrome screenshots into `docs/screens/` |
| `test/` | Vitest suite for the scripts (`pnpm test:scripts`) |

## 3. Package boundaries

Enforced by `pnpm check:boundaries` (dependency-cruiser, `.dependency-cruiser.cjs`):

| Rule | From | To | Severity |
|---|---|---|---|
| Engine imports nothing internal | `packages/engine/src` | `packages/db`, `packages/ingest`, `apps/` | error |
| Engine has no workspace dependency | `packages/engine` | `@roofline/*` | error |
| Engine is pure (no Node core modules) | `packages/engine/src` | core modules | error |
| DB does not import ingest or web | `packages/db` | `packages/ingest`, `apps/web` | error |
| Ingest does not import web | `packages/ingest` | `apps/web`, `@roofline/web` | error |
| Web does not import ingest | `apps/web` | `packages/ingest`, `@roofline/ingest` | error |
| No circular dependencies | any | any | error |

`pnpm verify` runs the boundary check. Note that `check-drift` (`pnpm db:check-drift`) is a separate command; it is not part of `verify`.

## 4. Data flow

### Weekly ingest (`runWeek`)

One transaction per week. All adapters are fetched first, so every source shares one statistical baseline.

1. For each adapter: insert an `ingest_runs` row, collect `RawListing`s, store changed payloads in `raw_listings` (stage 1), bump `last_seen_at` on unchanged rows.
2. Normalize every changed payload with engine parsers (stage 2).
3. Canonicalize locality (stage 3): alias or fuzzy match, then PostGIS for unresolved rows.
4. Quality (stage 4): repair, deposit, hard rules, outlier test against the prior accepted set plus this batch's survivors.
5. Persist: upsert `source_listings` with status, reasons and warnings; accepted rows become 1:1 placeholder `listings`; write `price_observations` on price change.
6. Delist rows the source no longer returns (kept, `is_active = false`).
7. Write counts to `ingest_runs.stats` and mark each run `ok`. Record unmatched locality strings in `locality_unmatched`.

### Seed (`pnpm db:fresh`)

1. `db:reset` drops `public` and `seed_truth`.
2. `db:migrate` applies `0001` to `0004`.
3. `db:seed` (`seedSynthetic`): loads reference data, generates the dataset from `SEED = 20261001`, writes `seed_truth` in one transaction, then runs weeks 0 to 25 through `runWeek`.

### Read path (v1)

`apps/web` reads through `pool` from `@roofline/db` (`lib/queries.ts`). See section 5 for the access gap this creates.

## 5. Database roles and access

| Role | Used by | Access |
|---|---|---|
| Owner (`roofline` in `DATABASE_URL`) | migrations, reset, seed, eval, and the web reads today | Owner of all objects, so it bypasses the grants below |
| `roofline_app` (NOLOGIN) | intended for web requests via `withUser()` (`SET LOCAL ROLE roofline_app`) | SELECT on reference tables, `ingest_runs`, `source_listings`, `price_observations`, `listings`, `listing_redirects`, `model_runs`, `fair_rent_estimates`. No access to `raw_listings`, `dedup_pairs` or `seed_truth` |

Gaps to resolve before the web app handles user data:

- `withUser()` has no callers yet. The web reads (`apps/web/lib/queries.ts`) run through the shared owner pool, so the `roofline_app` grants are not exercised by any v1 request. This is acceptable for public, read-only synthetic data, but must change before user-scoped tables (accounts, favourites) exist.
- `seed_truth` is revoked from `roofline_app` and the web never queries it, so the isolation holds for v1 code paths.

## 6. Conventions

- Engine values are pure functions. Every derived row carries `ENGINE_VERSION` (`0.0.1`).
- Synthetic data is generated from a fixed seed and is deterministic end to end. See `data-provenance.md`.
- Reason codes (`REASON_CODES`) are persisted in `source_listings.quality_reasons`. They are stable and must not be renamed.
- Migrations are numbered SQL files. Edited migrations are refused by the checksum migrator. Drizzle is the typed query layer, not the migration tool.
- Ports are fixed: web 3000, Postgres 5432. Postgres image: `postgis/postgis:16-3.5` (fallback: `packages/db/docker/Dockerfile`).
- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- Scripts run via `tsx` or `vite-node`. There is no build step for the libraries; `main`/`types` point at `src/index.ts`.

## 7. External dependencies

| Package | Where | Purpose |
|---|---|---|
| `next` 15, `react` / `react-dom` 19 | `apps/web` | Web app |
| `lucide-react` | `apps/web` | Icons |
| `drizzle-orm` 0.36, `pg` 8 | `packages/db` | Typed queries, Postgres driver |
| `dotenv` | `packages/db` | `.env.local` loader |
| `commander` | `packages/ingest` | CLI |
| `vitest` 2, `typescript` 5, `eslint` 9, `typescript-eslint` 8 | root and packages | Tests, types, lint |
| `dependency-cruiser` 16 | root | Boundary enforcement |
| `@playwright/test` 1.64 | root, `apps/web` | E2E |
| `tsx`, `vite-node` | root, `packages/db` | Script runners |

Deliberately absent in v1: `@anthropic-ai/sdk` (LLM extraction is optional and planned), MapLibre and map tiles (planned), Auth.js (planned).

## 8. Related documents

- [README.md](../README.md): quick start and commands
- [methodology.md](methodology.md): ingestion stages and the quality stage in detail
- [data-provenance.md](data-provenance.md): synthetic generator, sources, ground truth, defects
- [PLAN.md](../PLAN.md): scope and acceptance criteria
- `docs/recon/`: reference teardown notes (local only, gitignored in part)
