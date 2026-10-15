# Methodology

**Last Updated:** 2026-10-16
**Scope:** Roofline v1 ingestion pipeline (stages 1-5), the data-quality stage (stage 4) and the deduplication stage (stage 5) in detail
**Code:** `packages/engine/src/{normalize,locality,geo,stats,quality,dedup}/`, `packages/ingest/src/pipeline/`

Roofline keeps the engine pure. `@roofline/engine` has no I/O, no clock and no randomness; the pipeline in `@roofline/ingest` supplies the data. Every derived value is stamped with `ENGINE_VERSION` (`packages/engine/src/version.ts`, currently `0.0.1`).

## 1. Pipeline overview

```
fetch -> store raw -> normalize -> canonicalize locality -> quality -> persist -> dedup
 (1)        (1)          (2)              (3)               (4)         (persist)     (5)
```

| Stage | Implemented in | Summary |
|---|---|---|
| 1. Fetch and store raw | `ingest/src/pipeline/raw.ts`, `adapter.ts` | Adapters yield `RawListing`. Only payloads whose stable-JSON SHA-256 differs from the latest stored payload move on |
| 2. Normalize | `ingest/src/pipeline/normalize.ts`, `engine/src/normalize/` | Parse rent, deposit, area, BHK, furnishing, floor and PG text. Never throws; unparseable fields become null with a flag |
| 3. Canonicalize locality | `ingest/src/pipeline/locality.ts`, `engine/src/locality/` | Exact alias match, then Jaro-Winkler fuzzy match, then PostGIS nearest-centroid for rows whose text did not resolve or sits more than 3 km from its own geo |
| 4. Quality | `ingest/src/pipeline/quality.ts`, `engine/src/quality/` | Unit repair, deposit parse, hard rules, then robust outlier test. See section 2 |
| Persist | `ingest/src/pipeline/persist.ts` | `source_listings` with `quality_status`, `quality_reasons`, `quality_warnings`; accepted rows also become 1:1 placeholder `listings`; counts go to `ingest_runs.stats` |
| 5. Dedup, identity, clusters | `ingest/src/pipeline/dedup.ts`, `engine/src/dedup/` | Block, score pairs, cluster under chaining guards, assign stable listing ids and redirects. See section 6 |

Each weekly run is a single database transaction. All adapters' changed rows form one batch, so every source shares one statistical baseline. Stage 5 runs after persist and delisting, inside the same transaction.

Stages not yet built: fair-rent model, deals, alerts and analytics refresh. They are planned for later phases and are not described in this document.

## 2. Quality (stage 4)

Quality decides whether a row is `accepted` or `rejected`, and attaches reason codes (why it was rejected) and warning codes (kept, but flagged). Order of evaluation:

1. Unit repair (rent), then deposit parsing. Repair needs the rent band, built in section 2.3.
2. Hard rules on every row that has a rent and a unit kind. Hard rules are deterministic and need no baseline.
3. Outlier test on rows that passed the hard rules and have a resolved locality.

A row is `accepted` if and only if it has no reasons. Warnings never change status.

### 2.1 Unit repair

Implemented by `repairRent()` in `engine/src/normalize/money.ts`. Repairs are warnings, not rejections. Applied to parsed rent before the hard rules.

Band: P10 and P90 (type-7 quantiles) of rents in the locality x BHK cell, falling back to zone x BHK, then city x BHK. A cell is used only with at least 8 rows (locality and zone) or 4 rows (city). The band is built from the prior accepted set plus this batch's plausible rents at a resolved locality. `inBand(v)` means `p10 <= v <= p90`.

| Rule | Condition | Action | Flag |
|---|---|---|---|
| Thousands-unit | rent < 200 and rent x 1000 in band | rent := rent x 1000 | `RENT_UNIT_REPAIRED` |
| Annual as monthly | rent > 12 x cell median and rent / 12 in band | rent := rent / 12 | `RENT_ANNUAL_REPAIRED` |

If neither rule applies, the rent is left as parsed. A rent of 1 (`rent_one` in the seed) is not repaired because 1000 is far below the band, so it is rejected as too low.

### 2.2 Hard rules

Implemented by `hardRules()` in `engine/src/quality/rules.ts`. Bounds are in `QUALITY_BOUNDS` (`engine/src/quality/constants.ts`).

| Check | Condition | Result |
|---|---|---|
| Flat rent floor | rent < 1,500 (or NaN) | `RENT_TOO_LOW` |
| Flat rent ceiling | rent > 1,000,000 | `RENT_TOO_HIGH` |
| PG rent floor | rent < 2,000 (or NaN) | `RENT_TOO_LOW` |
| PG rent ceiling | rent > 60,000 | `RENT_TOO_HIGH` |
| Area range | area present and not in [120, 15,000] | `AREA_IMPLAUSIBLE` |
| Area missing (flats only) | area absent | warning `AREA_MISSING` |
| Price per sq ft (flats with valid area) | rent / area < 5 or > 300 | `PSF_IMPLAUSIBLE` |
| Locality unresolved, geo valid | no locality id, but lat/lng inside the Bangalore bounding box | warning `LOCALITY_FROM_GEO` (engine only; the pipeline rejects this case, see 2.4) |
| Locality unresolved, geo invalid | no locality id, geo missing, (0,0) or outside the box | `GEO_INVALID` and `LOCALITY_UNRESOLVED` |
| Locality resolved from geo | locality id present and `localityFromGeo` set | warning `LOCALITY_FROM_GEO` |
| BHK vs area | flat, BHK present, area >= 120 and area outside the BHK range | warning `BHK_AREA_MISMATCH` |

BHK area ranges (sq ft, index = BHK, 5 means 5+):

| BHK | 0 (RK) | 1 | 2 | 3 | 4 | 5+ |
|---|---|---|---|---|---|---|
| Min | 120 | 200 | 350 | 550 | 800 | 1,000 |
| Max | 900 | 1,800 | 3,000 | 5,000 | 8,000 | 15,000 |

Hard-rule reasons short-circuit the statistical stage: a row with any hard reason is never outlier-tested and never enters the baseline.

Price per sq ft is checked only for flats with a valid, positive area. PG rows are not checked for area.

### 2.3 Robust outlier test (RENT_OUTLIER_MAD / RENT_OUTLIER_IQR)

Implemented by `buildBaseline()`, `checkOutlier()` and `assessRow()` in `engine/src/quality/`.

**Adjusted log rent.** For each row:

```
r = ln(rent) - epsilon x ln(area / medianArea_cell)     epsilon = 0.35
```

If the row has no valid area, or the cell has no median area, the adjustment is skipped and `r = ln(rent)`.

**Groups (cells).** A row belongs to up to three cells. The suffix is `flat:<bhk>` for flats (`na` when BHK is unknown) or `pg:<sharing>` for PG beds (`na` when unknown).

| Level | Key | Used when |
|---|---|---|
| locality | `L<localityId>\|<suffix>` | row has a locality, and the cell has at least 8 rows |
| zone | `Z<zone>\|<suffix>` | row has a zone, and the cell has at least 8 rows |
| city | `C\|<suffix>` | cell has at least 4 rows, and the test uses Tukey fences |

Cell statistics: `n`, median area, `median(r)`, raw (unscaled) `MAD(r)`, and Q1 and Q3 of `r`.

**Modified z-score (MAD levels).** The first locality or zone cell with n >= 8 decides:

```
z = 0.6745 x (r - median(r)) / max(MAD(r), 0.10)
reject as RENT_OUTLIER_MAD if z < -4.0  or  z > +3.5
```

The asymmetry is deliberate: the lower tail is wider, so unusually cheap rows are rejected less eagerly than unusually expensive ones. Thresholds are in `OUTLIER_PARAMS` (`zLow = -4.0`, `zHigh = 3.5`, `zScale = 0.6745`, `madFloor = 0.10`).

**Floor.** The MAD floor of 0.10 stops tight cells from rejecting genuine deals. Expressed as a rent ratio, and ignoring the area adjustment:

| Case | Threshold on `r - median` | Rent ratio to median |
|---|---|---|
| Lower reject (MAD <= 0.10) | -0.593 | about 0.55 (about 45% below) |
| Upper reject (MAD <= 0.10) | +0.519 | about 1.68 (about 68% above) |

With the floor in place, a deal at x0.60 (log difference about -0.51) stays inside the lower fence of -0.59. A too-good row at x0.30 (log difference about -1.20) does not.

**Tukey fallback (RENT_OUTLIER_IQR).** If the city cell has at least 4 rows and no MAD level applied, the row is rejected when `r < Q1 - 3 x IQR` or `r > Q3 + 3 x IQR`. `iqrK = 3` (far-out fences). The city cell never uses MAD.

**No verdict.** If no cell qualifies (city cell has fewer than 4 rows), the row is accepted with level `none`.

**Baseline composition (pipeline).** Implemented in `assessDrafts()` (`ingest/src/pipeline/quality.ts`):

1. Prior accepted set: rows with `quality_status = 'accepted'` and `is_active`, excluding any row whose `(source, source_listing_id)` appears in this batch.
2. Plus this batch's survivors: rows that passed the hard rules and have a resolved locality.

Rejected junk therefore never shifts the baseline. A surviving row is part of the baseline it is judged against. With cells of 8 or more rows the effect is small, but it is present.

### 2.4 Reason codes

Reason codes are stable strings persisted in `source_listings.quality_reasons` (a GIN-indexed `text[]`). Never rename them.

| Code | Owner | Meaning |
|---|---|---|
| `RENT_TOO_LOW` | engine (`rules.ts`) | Rent below the flat or PG floor |
| `RENT_TOO_HIGH` | engine (`rules.ts`) | Rent above the flat or PG ceiling |
| `AREA_IMPLAUSIBLE` | engine (`rules.ts`) | Area outside 120 to 15,000 sq ft |
| `PSF_IMPLAUSIBLE` | engine (`rules.ts`) | Rent per sq ft outside 5 to 300 (flats) |
| `GEO_INVALID` | engine (`rules.ts`) | Locality unresolved and geo missing, zero or outside the box |
| `LOCALITY_UNRESOLVED` | engine and pipeline | No locality id |
| `RENT_OUTLIER_MAD` | engine (`outliers.ts`) | Modified z-score outside the asymmetric thresholds |
| `RENT_OUTLIER_IQR` | engine (`outliers.ts`) | Outside the city-level Tukey far-out fences |
| `RENT_MISSING` | pipeline only (`quality.ts`) | Rent absent after parsing and repair |
| `UNIT_KIND_MISSING` | pipeline only (`quality.ts`) | Unit kind could not be determined |

Pipeline-specific behaviour: when the locality is unresolved, the pipeline always adds `LOCALITY_UNRESOLVED` (even when geo is valid, because PostGIS found nothing close enough). It also removes `LOCALITY_FROM_GEO` from the warnings, since geo did not resolve the locality. A row with a valid geo but no resolved locality is therefore rejected in the pipeline, while the engine alone would only warn.

### 2.5 Warning codes

Warnings are kept on accepted rows, in `source_listings.quality_warnings`.

Engine (`WARNING_CODES`):

| Code | Meaning |
|---|---|
| `AREA_MISSING` | Flat without a usable area. Also emitted by the area parser for "0" or unparseable values |
| `LOCALITY_FROM_GEO` | Locality taken from geo, not from text |
| `BHK_AREA_MISMATCH` | Area outside the plausible range for the BHK |

Pipeline (`WARNING_FLAGS`, which also includes the normalize-stage flags): `FURNISHING_INVALID`, `DEPOSIT_MISSING`, `AREA_MISSING`, `RENT_UNIT_REPAIRED`, `RENT_ANNUAL_REPAIRED`, `LOCALITY_FUZZY`, `LOCALITY_FROM_GEO`, `LOCALITY_TEXT_GEO_CONFLICT`, `BHK_TITLE_MISMATCH`, `BHK_AREA_MISMATCH`, `FLOOR_INVALID`.

Only the warnings in this list are stored in `quality_warnings`. Other normalize flags are not stored.

### 2.6 Worked example

A 2 BHK flat in a locality with 40 rows, median area 1,100 sq ft, and `median(r)` = ln(45,000) with MAD = 0.04 (so the floor applies, MAD becomes 0.10).

- A row at rent 22,000 and area 1,100: `r - median(r)` = ln(22,000 / 45,000) = -0.716. `z = 0.6745 x -0.716 / 0.10` = -4.83. Below -4.0, so `RENT_OUTLIER_MAD`.
- A row at rent 30,000 and area 1,100: `r - median(r)` = -0.405. `z` = -2.73. Accepted.

These numbers illustrate the mechanism. They are not from the seed.

### 2.7 Where the thresholds are tested

- `packages/engine/test/quality/quality.test.ts` covers hard rules, MAD, the floor, the asymmetry and the IQR fallback.
- `packages/ingest/test/pipeline.integration.test.ts` runs stages 1-4 on a 40-row fixture and asserts exact counts (33 accepted, 7 rejected).
- `pnpm --filter @roofline/ingest eval:quality` checks the planted seed against these rules (see `data-provenance.md`, section 8).

## 3. Locality canonicalization (stage 3, summary)

Implemented in `engine/src/locality/`.

- `normLocality()` applies NFKC, lower-cases, turns punctuation into spaces, removes a trailing city name (Bangalore, Bengaluru, Karnataka, India and spelling variants) and trailing phase, sector, stage, block, cross or main suffixes. `isStopLocality()` rejects generic placeholders such as "From", "Bangalore", "Near" and "Other", so they never resolve. Stop-list entries never enter the index.
- Lookup order: exact match on name or alias (`exact`), then Jaro-Winkler fuzzy match with threshold 0.92 and a margin of 0.03 over the best other locality (`fuzzy`). A tie is `ambiguous`.
- Then PostGIS nearest centroid (`ingest/src/pipeline/locality.ts`, query in `db/src/queries/locality.ts`) for unresolved rows, and for rows whose text-resolved locality is more than 3 km from the row's geo. The accept radius is `max(1.5 x locality radius, 1,500 m)`.
- Unresolved raw strings are recorded in `locality_unmatched` for curation.

## 4. Normalization (stage 2, summary)

Implemented in `engine/src/normalize/`. Each parser returns a value and flags, never throws, and returns null with a flag when the input is absent or unparseable. Table-driven tests in `engine/test/normalize/` cover, among others, "1.5 lakhs" (rent), "116 sqm" and "139 sq yd" (area), "0", "N/A" and "0 sqft" (area, treated as missing), and furnishing values including the invalid "11901".

## 5. Determinism and provenance

- The engine is pure. The same inputs give the same outputs, and every derived row carries `ENGINE_VERSION`.
- Synthetic data is generated from a fixed seed. See `data-provenance.md`.
- Persisted quality results can be traced to their reason codes, warnings and the run that produced them through `ingest_runs.stats` (jsonb: counts per reason, warning and locality method, plus repair counts).

## 6. Dedup (stage 5)

Stage 5 groups accepted listings that describe the same unit, then gives each group a stable listing id. Code: `packages/engine/src/dedup/` (pure) and `packages/ingest/src/pipeline/dedup.ts` (reads and writes). The codemap is in `architecture.md`, section 2.

### 6.1 Population and modes

- A member is a `source_listings` row with `quality_status = 'accepted'` and `is_active`. Rejected and delisted rows never enter dedup.
- Unit kinds: `rk` and `studio` share class `f0`; `bhk` maps to `f0`..`f5` (BHK capped at 5); `pg_bed` maps to `pg`. A `bhk` row without a BHK count has no class and is unblockable (never compared).
- Incremental mode (default) scores only the blocks touched by dirty rows. A row is dirty if it is new, its content changed, or it was not a member before. Clusters touched by a dirty row, plus the stored raw-match edges they depend on, are re-clustered together. The result equals a full rebuild.
- Full mode (`roofline-ingest run --full`, or any run after `ENGINE_VERSION` changes) rescores every block and re-assigns every identity.

### 6.2 Blocking

Blocking limits which pairs are scored. Implemented in `blocking.ts`, with the constants in `BLOCKING`.

- **Geo cell.** Rows with coordinates use a geohash of precision 6 (roughly 1.2 km by 0.6 km).
- **Rent band.** `floor(ln(rent) / ln(1.25))`, so bands are 25% wide on a log scale.
- **Index keys.** Every row is indexed under its locality key `la:<locality>|<class>|<band>`, plus `g:<cell>|<class>|<band>` if it has coordinates, or `l0:<locality>|<class>|<band>` if it does not.
- **Probe keys.** A row with coordinates probes its cell and its 8 neighbours across the bands at -1, 0 and +1 (27 keys), plus 3 locality keys. A row without coordinates probes its 3 locality keys only.
- A pair is a candidate when the two rows share at least one key. Candidate pairs are de-duplicated and sorted, so runs are reproducible.

### 6.3 Gates (hard exclusions)

`gate()` in `similarity.ts` rules a pair out before scoring. The first failing gate is the reason.

| Gate | Condition |
|---|---|
| `SAME_ROW` | Same `source_id` and `source_listing_id` |
| `CLASS` | Unit class missing on either side, or classes differ |
| `PG_SHARING` | Both PG rows have sharing and they differ |
| `PG_GENDER` | Both PG rows have a gender and they differ |
| `LOCALITY` | One side has no coordinates and the localities differ |
| `GEO_FAR` | Distance above 1,000 m |
| `RENT_FAR` | Higher rent > 1.25 x lower rent (`4 x hi > 5 x lo`, in integers) |

### 6.4 Features and weights

Each feature is in [0, 1]. Constants are in `SIMILARITY`.

| Feature | Formula | Missing value |
|---|---|---|
| `geo` | 1 at or below 150 m, 0 at or above 800 m, linear between | Feature absent (see below) |
| `rent` | `1 - min(1, abs(a - b) / (0.10 x max(a, b)))` | Not missing (both rents are required) |
| `area` | 1 at relative difference 3% or less, 0 at 15% or more, linear between | 0.5 |
| `title` | Jaccard of title tokens | 0.5 |
| `photos` | 1 at minimum Hamming distance 6 or less, 0 at 16 or more, linear between | 0.5 |

Photos are 64-bit dHash values (`dhash.ts`). The distance is the minimum Hamming distance over all cross pairs of photos.

Weights: geo 0.20, rent 0.15, area 0.15, title 0.15, photos 0.35.

- With coordinates on both sides, the score is the weighted sum (weights sum to 1).
- Without coordinates on either side, the geo term is dropped and the other four weights are renormalised over 0.80.
- Penalties subtract 0.15 each for a floor mismatch and a furnishing mismatch (only when both values are known). The score is clamped to [0, 1].

### 6.5 Thresholds and caps

| Score | Raw decision |
|---|---|
| >= 0.70 | `match` |
| >= 0.62 and < 0.70 | `possible` |
| < 0.62 | none (not stored) |

Caps limit a pair to `possible` even above 0.70:

- `NO_PHOTOS`: neither side has a usable photo hash.
- `SAME_SOURCE_PHOTOS`: both rows come from the same source and their photo similarity is below 0.90. One source rarely lists the same unit twice, so a same-source match needs strong photo evidence.

Scored pairs are written to `dedup_pairs` (admin role only) with their score, features and decision. Only `match` edges go into clustering. `possible` pairs are kept for review and are not merged.

### 6.6 Chaining guards

Single-link clustering can chain distinct units: A matches B and B matches C, so A, B and C merge even when A and C are far apart. The guards in `cluster.ts` (`GUARDS`) stop that.

| Guard | Violation |
|---|---|
| `GEO_SPAN` | Two members more than 1,000 m apart |
| `RENT_SPREAD` | Max rent > 1.25 x min rent across members |
| `SOURCE_DUP` | Two members from the same source with no strong edge (photo similarity >= 0.90) between them |
| `SIZE` | More than 8 members |

Clustering runs in two phases:

1. Connected components over the `match` edges (union-find, de-duplicated edges, highest score first).
2. For a component that violates any guard, a guarded Kruskal rebuild: edges are added in score order, and an edge is kept only if the merged set passes every guard. A rejected edge is recorded as a `guard_split` with the first failing guard. The stored decision becomes `guard_split` with `features.guard` set.

Components that pass all guards are kept as they are.

### 6.7 Identity and redirects

Each cluster gets one `listings.id`. `assignIdentities()` in `canonical.ts` matches clusters to the previous listings.

- **Inheritance.** For each (previous listing, new cluster) pair, count the previous members that now sit in the cluster (overlap). Pairs are taken greedily by overlap, then by the earlier `first_seen_at` of the previous listing, then by id. A previous listing is inherited by at most one cluster, and a cluster inherits at most one listing.
- **Minting.** A cluster with no inherited listing gets a new id from `uuidFor('listing', '<sourceId>:<sourceListingId>')` of its seed row. If the id is taken, the attempt number increases.
- **Redirects.** A previous listing that is not inherited is redirected to the cluster that takes most of its members (ties: earlier cluster `first_seen_at`, then lower id). Redirects go to `listing_redirects`. A previous listing with no surviving member is orphaned.
- **Canonical row.** Within a cluster, the canonical source row is the most complete: completeness is the sum of min(photos, 3), area, deposit, maintenance, furnishing and valid geo (0 to 8). Ties go to the incumbent (the current canonical row), then the latest `last_seen_at`, then the lower source priority, then id.

### 6.8 Measured metrics

`pnpm --filter @roofline/ingest eval:dedup` compares the stored clustering with `seed_truth.source_rows.unit_id`. The population is accepted and active members with a truth row. Predicted clusters are `source_listings.listing_id`.

| Metric | Definition | Threshold |
|---|---|---|
| Pairwise precision | Same-listing pairs that are also same-unit, over all same-listing pairs | >= 0.98 |
| Pairwise recall | Same-unit pairs that share a listing, over all same-unit pairs | >= 0.92 |
| B-cubed F1 | Harmonic mean of per-row B-cubed precision and recall | >= 0.95 |
| Hard-negative merges | Planted hard negatives sharing a listing with a different unit | must be 0 (150 evaluated) |
| Blocking recall | Share of gate-eligible true pairs that share a blocking key | >= 0.995 |

Measured output on the local seeded database (run 2026-10-16, seed `20261001`):

```
members=3898 true_pairs=831 predicted_pairs=784 tp=784
pairwise_precision=1.0000 (>= 0.98)
pairwise_recall=0.9434 (>= 0.92)
bcubed_precision=1.0000 bcubed_recall=0.9883 bcubed_f1=0.9941 (>= 0.95)
hard_negatives_evaluated=150 (must be 150) hard_negative_merges=0 (must be 0)
blocking_recall=1.0000 over 825 gate-eligible true pairs (>= 0.995); blocking_recall_all_pairs=0.9988 over 831 gated_away=6 possible_pairs=41
eval:dedup OK
```

Reading the numbers:

- Precision is perfect on this seed: no two different units share a listing. The hard negatives (distinct units that look alike) are never merged.
- Recall is 0.9434, so 47 of the 831 true pairs are not clustered together. The eval does not attribute these to a cause. They are split by a gate or guard, or scored below 0.70, and the eval output does not say which.
- Blocking loses no gate-eligible true pair. The 6 true pairs that a gate rules out are reported apart (`gated_away`) and are not counted against blocking.
- 41 pairs sit in the `possible` band and are not merged.
