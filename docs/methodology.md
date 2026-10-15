# Methodology

**Last Updated:** 2026-10-16
**Scope:** Roofline v1 ingestion pipeline (stages 1-4) and the data-quality stage in detail
**Code:** `packages/engine/src/{normalize,locality,geo,stats,quality}/`, `packages/ingest/src/pipeline/`

Roofline keeps the engine pure. `@roofline/engine` has no I/O, no clock and no randomness; the pipeline in `@roofline/ingest` supplies the data. Every derived value is stamped with `ENGINE_VERSION` (`packages/engine/src/version.ts`, currently `0.0.1`).

## 1. Pipeline overview

```
fetch -> store raw -> normalize -> canonicalize locality -> quality -> persist
 (1)        (1)          (2)              (3)               (4)         (persist)
```

| Stage | Implemented in | Summary |
|---|---|---|
| 1. Fetch and store raw | `ingest/src/pipeline/raw.ts`, `adapter.ts` | Adapters yield `RawListing`. Only payloads whose stable-JSON SHA-256 differs from the latest stored payload move on |
| 2. Normalize | `ingest/src/pipeline/normalize.ts`, `engine/src/normalize/` | Parse rent, deposit, area, BHK, furnishing, floor and PG text. Never throws; unparseable fields become null with a flag |
| 3. Canonicalize locality | `ingest/src/pipeline/locality.ts`, `engine/src/locality/` | Exact alias match, then Jaro-Winkler fuzzy match, then PostGIS nearest-centroid for rows whose text did not resolve or sits more than 3 km from its own geo |
| 4. Quality | `ingest/src/pipeline/quality.ts`, `engine/src/quality/` | Unit repair, deposit parse, hard rules, then robust outlier test. See section 2 |
| Persist | `ingest/src/pipeline/persist.ts` | `source_listings` with `quality_status`, `quality_reasons`, `quality_warnings`; accepted rows also become 1:1 placeholder `listings`; counts go to `ingest_runs.stats` |

Each weekly run is a single database transaction. All adapters' changed rows form one batch, so every source shares one statistical baseline.

Stages not yet built: deduplication, fair-rent model, deals, alerts and analytics refresh. They are planned for later phases and are not described in this document.

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
