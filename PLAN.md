# Implementation Plan: Nivaas

> Nivaas (निवास, "dwelling") is a rental intelligence platform for Bangalore. It replicates what the reference product (CasaSetu, recon 2026-10-15) does well and adds the engineering depth that product lacks. The reference product's name and branding appear **only in this planning document and `docs/recon/`**. They never appear in product code, copy, seed data or UI. `pnpm brand-guard` enforces this.

---

## 1. Product summary

**One line:** Every rental in Bangalore, counted once, priced honestly, and measured against your commute.

**Who it is for:** People renting in Bangalore. The main groups are tech workers relocating to an office cluster (Manyata, ORR, Whitefield, Electronic City), students and early-career renters choosing PGs, and families comparing 2–3BHKs on total monthly cost rather than headline rent.

**What it does:**
1. One search across many sources. Duplicates are merged, and the counts are reported honestly, with "duplicates merged" kept separate from "rejected for bad data."
2. Every listing shows **move-in cost**, **fair rent** (with a plain-language explanation and confidence level), **price history** and the **sources it appears on**.
3. A **Deals** feed: listings at least 20% below fair rent that pass quality gates. Each deal shows why it qualified.
4. A **Map + list** split view with clustered markers, URL-synced filters, a mobile bottom-sheet filter, and saved searches with new-match alerts.
5. **Compare** for 2–4 listings: commute estimates from a work location (bike, car or metro) and a total-cost-of-living breakdown.
6. **Analytics** that are correct: KPIs, rent distributions, a locality heatmap, ₹/sqft, trends, source comparison, and a data-quality panel that shows what was rejected and why.

**Data stance:** No scraping or hot-linking of any portal. v1 runs on a **deterministic synthetic Bangalore seed**: at least 6,400 raw source rows producing at least 5,000 canonical listings across 69 real localities. The seed records **ground truth** (true clusters, true expected rents, true deals), so dedup, fair-rent and deal quality are *measured* rather than asserted. Real data arrives later through the documented `SourceAdapter` interface (licensed feeds or owner submissions). Every page carries a visible synthetic-data disclosure while `NIVAAS_DATA_MODE=synthetic`.

**Assumptions:**
- A new repository named `nivaas/`, a sibling of `solum/`. Node ≥ 20, pnpm 9, Docker Desktop.
- Single city (Bangalore). Currency is INR stored as integer rupees.
- Time zone is Asia/Kolkata for display. Storage is `timestamptz`.
- The fixed "as-of" date for the seed is **2026-10-01**. The engine never reads the clock.
- LLM features are optional. Everything works with `ANTHROPIC_API_KEY` unset.

---

## 2. What we keep from CasaSetu

| Keep | Why it works | How Nivaas does it (and fixes the bug next to it) |
|---|---|---|
| One search across many sources with a "N hidden" count | Saves renters from juggling tabs, and the honesty builds trust | The header reads **"5,214 listings · 1,183 duplicates merged · 191 rejected (why?)"**. Duplicates and quality rejections are counted **separately** (the reference lumps them into "17,841 hidden"). Per-query results show `matched` and `duplicatesMerged = Σ(member_count−1)` for that query. |
| Move-in cost on the card (rent + deposit) | It is the number renters actually budget for | Always shown. If the deposit is unknown, the card says **"Move-in ≥ ₹34K · deposit not listed"** instead of silently dropping the line, which is what the reference does on "Deposit: N/A" cards. |
| Deals feed of below-market listings | High-intent entry point | Uses an explicit formula with a reason on every deal ("23% below fair rent · ₹9.1K/mo · 52 comps · listed 3 days ago"). It never claims to be "verified." |
| Commute-aware Compare | People choose homes by office | Commute estimates for bike, car and metro, plus a side-by-side table for 2–4 listings and a TCO breakdown. Match scores use **one 0–100 scale**. The reference shows "Score 8" on cards next to "Median match score 1." |
| Analytics (KPI tiles, top localities, furnishing split, ₹/sqft, source comparison, locality table) | Market context sells the product | The same panels plus trends, distributions, heatmap and data quality. Every chart and its table render **from the same data object**, so values cannot disagree. |
| Homes / PGs / Deals / Compare / Analytics / Activity / Sign in IA | Clear and familiar | Kept, plus Localities and Methodology. On mobile, a 4-tab bottom bar (Homes, PGs, Deals, Compare) with the rest under "More". |
| Dense, scannable cards and fast prerendered pages | Renters scan hundreds of listings | Rows are denser than cards at desktop. Public GETs use `s-maxage=300, stale-while-revalidate=600` with an ETag tied to the data version. |
| Outbound "go to source" model, zero brokerage | No middleman | Kept. In synthetic mode, outbound links go to a "Demo source, no live listing" interstitial. |

**Recon bugs that become regression assertions** (tested in the phases noted):
- A locality named "From" appears in charts → Phase 1 SQL check and Phase 6 e2e.
- Minimum rent of ₹1 → Phase 1 SQL check and Phase 6 e2e.
- Furnishing value "11901" → Phase 1 enum and flag.
- Axis label "₹N/A" → Phase 6 formatter unit test and e2e text scan.
- Bar values disagreeing with table values → Phase 6 e2e asserts identical `data-value` attributes.
- Match-score scale mismatch → Phase 5 e2e.
- Mobile H1 and search bar overflowing at 390px (visible in the mobile screenshot) → a `scrollWidth ≤ 390` assertion in every phase from Phase 0.
- About page with a mostly empty first viewport → Phase 8 e2e checks that the above-the-fold content height is at least 60% filled.

---

## 3. What we add (depth)

### 3.1 Ingestion pipeline

Stages: `fetch → store raw → normalize → canonicalize locality → quality (hard rules + robust outliers) → dedup → fair-rent → deals → alerts → refresh analytics`.

Each stage is a pure engine function, except raw storage, PostGIS KNN and persistence, which belong to ingest and db. Each stage writes counts to `ingest_runs.stats` (jsonb) and reason codes to rows.

**Normalize** (`engine/src/normalize/*`). All parsers return `{ value, flags[] }` and never throw.
- **Rent and deposit:** handles `"₹42K"`, `"42,000"`, `"42000/-"`, `"1.2L"`, `"1.5 Lac"`, `"1,25,000"`, `"N/A"`, `""` and `"Negotiable"` → `null`.
- **Unit repair:**
  - If rent < 200 and `rent × 1000` falls inside the locality×BHK P10–P90 band, repair it and add flag `RENT_UNIT_REPAIRED`.
  - If rent > 12× the cell median and `rent / 12` falls inside the band, repair it and add flag `RENT_ANNUAL_REPAIRED`.
  - Repairs are warnings, not rejections.
- **Area:** handles `"1,250 sq.ft"`, `"1250 sqft"`, `"116 sqm"` (×10.7639), `"139 sq yd"` (×9) and `"0"` → `null` with flag `AREA_MISSING`.
- **Unit kind:** `unit_kind ∈ {rk, bhk, studio, pg_bed}`. `bhk` is a smallint, with 0 for RK and studio. Parsing order is field first, then title regex (`/(\d)\s*bhk/i`, `/1\s*rk/i`). A mismatch between field and title adds flag `BHK_TITLE_MISMATCH`, and the field wins.
- **Furnishing:** maps to the `furnishing` enum `{furnished, semi, unfurnished}`. Accepted inputs include `full|fully|ff|furnished`, `semi|sf|semi-furnished` and `un|uf|unfurnished|bare|none`. Anything else (for example `"11901"`) becomes `null` with flag `FURNISHING_INVALID`.
- **PG fields:**
  - `sharing ∈ {single, double, triple, quad}`, parsed from "2 sharing", "twin" and similar.
  - `food_included` is a boolean.
  - `gender ∈ {male, female, coed}`, parsed from "gents", "boys", "ladies", "girls", "unisex", "co-living".
- **Other fields:** tags (non-veg OK, corporation water, borewell, power backup, lift, gated), parking (bike, car, both, none), facing, floor and total floors.
- **Title tokens:** lowercased, stripped of stopwords (`for rent, bhk, flat, apartment, in, at, near, bangalore, bengaluru, sale, fully, semi, furnished`) and stored as `text[]` for dedup.

**Canonicalize locality** (`engine/src/locality/*` + `db/src/queries/locality.ts`):
1. `normLocality(s)`: NFKC, lowercase, strip `", bangalore|bengaluru"` and punctuation, collapse whitespace, strip suffixes like "phase 1/2", "sector N", "Nth stage/block/cross/main".
2. **Stop-list:** `from, bangalore, bengaluru, near metro, prime location, n/a, -, other, india, karnataka`. These are treated as "no locality text" and never matched.
3. **Exact alias lookup** in `locality_aliases` (curated seed list in §5).
4. **Fuzzy match:** Jaro-Winkler ≥ 0.92 against names and aliases, with a margin of ≥ 0.03 over the runner-up, else ambiguous. Adds flag `LOCALITY_FUZZY`.
5. **PostGIS nearest centroid** when lat/lng is valid (inside the Bangalore bbox `12.70–13.25 N, 77.35–77.85 E`):
   ```sql
   ORDER BY centroid <-> point LIMIT 2
   ```
   Accept if the nearest centroid is within `max(radius_m × 1.5, 1500 m)`. If text matching also succeeded and disagrees with geo by more than 3 km, flag `LOCALITY_TEXT_GEO_CONFLICT` and prefer geo. A geo-only resolution adds flag `LOCALITY_FROM_GEO`.
6. **Unresolved:** reject with `LOCALITY_UNRESOLVED` and upsert the raw string into `locality_unmatched` (count, first seen, sample) for alias curation.

**Quality** (`engine/src/quality/*`).

Hard rejects, with all bounds in `engine/src/quality/constants.ts`:

| Code | Rule |
|---|---|
| `RENT_IMPLAUSIBLE` | Flats: rent < ₹1,500 or > ₹10,00,000. PG: rent < ₹2,000 or > ₹60,000. Applied after repair. |
| `AREA_IMPLAUSIBLE` | Area < 120 or > 15,000 sqft |
| `PSF_IMPLAUSIBLE` | ₹/sqft < 5 or > 300 (flats with area only) |
| `GEO_INVALID` | (0,0) or outside the bbox, *and* no locality text resolved |
| `LOCALITY_UNRESOLVED` | See canonicalization step 6 |

Robust statistical outliers (`RENT_OUTLIER_MAD`):
- Computed on `r = ln(rent) − ε_bhk·ln(area/median_area_cell)`, an area-adjusted log rent.
- Uses the **modified z-score** `z = 0.6745·(r − median)/max(MAD, 0.10)`, with an asymmetric threshold: reject if `z < −4.0` or `z > 3.5`.
- Cell = locality × unit kind × BHK (flats) or locality × sharing (PG), when n ≥ 8.
- Falls back to zone × BHK when n ≥ 8, else city × BHK using **Tukey far-out fences** (`Q1 − 3·IQR`, `Q3 + 3·IQR`) on `r`, which is code `RENT_OUTLIER_IQR`.
- The MAD floor of 0.10 stops tight cells from rejecting genuine deals of about 35% below market.
- Statistics come from the **previous run's accepted set plus the current batch**, so one bad batch cannot shift its own baseline.

Warnings (kept, shown in the quality panel): `FURNISHING_INVALID, DEPOSIT_MISSING, AREA_MISSING, RENT_UNIT_REPAIRED, RENT_ANNUAL_REPAIRED, LOCALITY_FUZZY, LOCALITY_FROM_GEO, BHK_TITLE_MISMATCH`.

**Dedup** (`engine/src/dedup/*`):
- **Blocking** (`blocking.ts`):
  - Key = `(geohash6, unit_kind, bhk, rentBand)` where `rentBand = floor(ln(rent)/ln(1.15))`.
  - A record is compared with candidates in its own and the 8 neighbouring geohash6 cells and rent bands ±1.
  - The engine has its own geohash encode and neighbours implementation (no dependency).
  - Expected about 15 comparisons per record. The count is logged in run stats.
- **Pair features** (`similarity.ts`), each in [0,1]:

  | Feature | Weight | Definition |
  |---|---|---|
  | Geo | 0.20 | 1 if ≤ 150 m, linear to 0 at 800 m |
  | Rent | 0.15 | 1 − min(1, \|Δ\|/(0.10·max)) |
  | Area | 0.15 | 1 if \|Δ\|/max ≤ 3%, linear to 0 at 15%. Missing counts as 0.5, neutral. |
  | Title | 0.15 | Jaccard of token sets |
  | Photos | 0.35 | min Hamming distance across 64-bit dHash pairs: ≤ 6 → 1, ≥ 16 → 0 |

  - Floor and furnishing mismatch subtract 0.15 each when both are known.
  - **Match** if score ≥ 0.78. **Possible** if 0.62 ≤ score < 0.78, recorded but not merged.
  - Same source with a different `source_listing_id` merges only if photos score ≥ 0.9 (a relisting).
- **Clustering** (`cluster.ts`):
  - Union-find with path compression and union by rank over matched pairs.
  - **Chaining guard:** a cluster is valid only if its max pairwise geo distance is ≤ 1,000 m, its rent spread `(max−min)/min` is ≤ 25%, and it has at most one member per source unless photos match.
  - A violating cluster is split by dropping the weakest edges (ascending score) until the guards pass. Split events are logged as `GUARD_SPLIT`.
- **Canonical pick** (`canonical.ts`):
  - Highest completeness wins: photos ×3, area, deposit, maintenance, furnishing, geo precision.
  - Ties go to the most recent `last_seen_at`, then the lowest source priority.
  - The cluster exposes `sources[]` with per-source rent, for example "₹1.5K cheaper on Banyan (demo)".
- **Identity stability:**
  - A cluster's public `listings.id` is inherited from the member with the oldest `first_seen_at`.
  - Merges write `listing_redirects(old_id → new_id)`, so favorites, URLs and notifications survive re-clustering.
- **Incremental runs:** only new or changed source rows are compared against their blocks. `--full` re-clusters everything.

**Photo hashes:** the engine consumes `photo_hashes: bigint[]` and does not compute them. A `PhotoHasher` interface in ingest (dHash via `sharp`) is documented for real feeds. The synthetic adapter emits hashes directly (see §4.4).

### 3.2 Fair-rent model (`engine/src/fairrent/*`)

There are two models, both pure TS and deterministic. They are fitted per run on accepted canonical listings as of `asOf`, stored as a versioned `model_runs.artifact`, and the active one is chosen by holdout metric.

**v1 `robust-median` (default, most explainable):**
- **Hierarchy** for flats: cell L1 = locality × BHK × furnishing → L2 = locality × BHK × furnishing factor → L3 = zone × BHK × furnishing factor → L4 = city × BHK × furnishing factor.
- **Furnishing factor:** the city-wide median ratio `furnished/semi` and `unfurnished/semi` within each BHK.
- **Shrinkage:** `ln(m̂) = w·ln(m_cell) + (1−w)·ln(m_parent)` with `w = n/(n+10)`, applied recursively up the hierarchy.
- **Area adjustment:** `× (area/median_area_cell)^ε_bhk`, where `ε_bhk` is the Theil–Sen slope of `ln(rent)` on `ln(area)` within BHK, clamped to [0.2, 0.8]. Skipped when area is missing (confidence drops one level).
- **Leave-one-out:** a listing never prices itself. LOO medians are computed for cells with n < 30.
- **Interval:** `[m̂·exp(−1.4826·MAD_log), m̂·exp(+1.4826·MAD_log)]`.
- **Confidence:**
  - `high`: n_eff ≥ 20 and MAD_log ≤ 0.25.
  - `medium`: n_eff ≥ 8.
  - Otherwise `low`, which means **no badge**. The card shows "Not enough comparable listings," following solum's "refuse to give a verdict" rule.
- **PG** uses a separate hierarchy: locality × sharing × food → zone × sharing × food → city × sharing (+ food delta).

**v2 `hedonic`:**
- Model: `ln(rent) = α_locality + β_bhk + γ_furnishing + δ·ln(area) + Σ η·{parking_car, gated, lift, floor_band, kind}`.
- Fitted by **Huber-loss IRLS with ridge** (λ = 1.0 on locality effects, shrunk toward the zone mean).
- About 95 columns. Solved by Cholesky on the normal equations in `engine/src/stats/linalg.ts`, with no dependency.

**Selection:**
- 5-fold CV on the run's data. Metric is **MdAPE** against observed rents, and in synthetic mode also against `seed_truth.true_expected_rent`.
- The lower MdAPE becomes `is_active`. Ties go to v1.
- Metrics are stored in `model_runs.metrics` and shown on `/methodology` and the quality panel.

**Badge** (`badge.ts`), with `delta = (rent − expected)/expected`:

| Badge | Delta range |
|---|---|
| `great_deal` | ≤ −20% |
| `good_price` | −20% to −8% |
| `fair` | −8% to +8% |
| `above_market` | +8% to +20% |
| `overpriced` | > +20% |
| *(none)* | when confidence is `low` |

**Explanation** (`explain.ts`) produces deterministic strings from the trace, using the same formatter everywhere:
- v1: "₹4.2K below the Koramangala 2BHK semi-furnished median (₹42K, 46 listings). Adjusted for 1,100 sq ft."
- v2: "Expected ₹38.2K for a 1,100 sq ft semi-furnished 2BHK in Koramangala; listed ₹34K (11% below). Locality median ₹42K across 46 listings."
- Every estimate stores `basis` (level used, n, MAD, ε, model run id, engine version).

### 3.3 Deals (`engine/src/deals/*`)

**Eligibility.** All of these must hold:
- `delta ≤ −0.20` and `delta ≥ −0.55`. Anything below −0.55 is quarantined as `DEAL_TOO_GOOD_TO_VERIFY`, shown in the quality panel and never in Deals.
- Confidence is `medium` or `high`.
- Quality is `accepted` with no warnings except `DEPOSIT_MISSING`, which is allowed but lowers completeness.
- At least 3 photos, area known, and `last_seen_at` within 14 days of `asOf`.
- Cluster rent spread across sources ≤ 15%.

**Score:** `score = (−delta) × conf_w (high 1.0, medium 0.75) × freshness (max(0.5, 1 − age_days/30)) × completeness (0.8–1.0)`.

**Reason line:** "23% below fair rent · saves ₹9.1K/mo · high confidence (52 comps) · listed 3 days ago · on 2 sources". It is stored in `listings.deal_reason`. Ranking is by score, with the score itself available on hover.

**Copy:** "Estimated below fair rent." Never "verified" and never "handpicked."

### 3.4 Map, search and alerts

- **Map:** MapLibre GL JS v5, client-only (`next/dynamic` with `ssr:false`).
  - Default style is the OpenFreeMap "positron" vector style (no key; host `tiles.openfreemap.org`), restyled at runtime to Nivaas tokens (water, parks and roads desaturated).
  - Attribution "© OpenStreetMap contributors · OpenFreeMap" is always visible.
  - Markers come from a GeoJSON source with `cluster: true, clusterRadius: 50, clusterMaxZoom: 15`. Cluster bubbles show count. Unclustered pins show "₹34K" labels coloured by badge.
  - The heatmap layer (analytics) is a hex fill from `/api/v1/analytics/heatmap`.
  - Polish phase adds a self-hosted Protomaps PMTiles Bangalore extract (env switch) so no third-party tile host is needed.
- **Split view:**
  - Desktop ≥ 1024px: 56% list and 44% sticky map. "Search this area" applies the bbox filter. Hovering a row pulses its pin; clicking a pin scrolls to its row.
  - 390–1023px: a list/map toggle (FAB) and a filter bottom sheet with snap points 35/90%, focus trap, Esc/drag to close and `inert` on the background.
- **URL-synced filters** (`engine/src/filters/*` + `apps/web/lib/url-state.ts`):
  - The canonical `Filters` type has `serialize()` and `parse()`. Unknown params are dropped and order is stable, so `filters_hash = sha256(serialize(f))` deduplicates saved searches.
  - Every filter change does `router.replace` with debounce 250 ms. Back and forward restore state. Shareable URLs.
  - Params: `q, kind, bhk, rent, dep, furn, loc, area, badge, sharing, food, gender, parking, bbox, sort, work, mode, maxc`.
- **Saved searches and alerts:**
  - `saved_searches(filters jsonb, filters_hash, cadence instant|daily|off)`.
  - `pnpm alerts:run` runs after every ingest. It uses `engine/src/alerts/match.ts` to select new canonical listings (`first_seen_at > last_checked_at`) and inserts `notifications` with a `UNIQUE(saved_search_id, listing_id)` guard, so re-runs are idempotent.
  - Emails go to the `email_outbox` table (stub). In dev they are viewable at `/dev/mail`.
  - In-app: a bell with an unread count, plus a list on `/activity`.
- **Price history:**
  - `price_observations` gets one row per source listing per ingest run *when values changed*, plus the first and last observation.
  - The detail page shows a step chart per source and "Price dropped ₹2K on 14 Sep."
  - The seed runs 26 weekly backdated ingests (2026-04-09 → 2026-10-01), so history and trends are populated.

### 3.5 Compare, commute and TCO (`engine/src/commute/*`, `engine/src/tco/*`)

`CommuteProvider` interface: `estimate(from, to, mode, opts) → { minutes, low, high, distanceKm, legs[], costPerTrip, method }`.
- v1 is `HeuristicCommuteProvider`.
- `OsrmCommuteProvider` is a documented stub, swappable later by env var `NIVAAS_COMMUTE_PROVIDER`.

Constants live in `commute/constants.ts`, each with a unit and an "approx, as of 2026-10" comment:

| Mode | Detour × haversine | Speed | Overhead | Cost |
|---|---|---|---|---|
| Bike | 1.30 | 22 km/h | +4 min | ₹2.3/km (petrol ₹103/L ÷ 45 km/L) |
| Car | 1.40 | peak 16 km/h, off-peak 26 km/h | +6 min | ₹8.9/km (14 km/L + ₹1.5/km wear) |
| Metro | see below | in-vehicle 32 km/h incl. dwell | wait 5 min, interchange 6 min | BMRCL slab fare (approx) + access auto fare |

Metro details:
- **Access and egress:** walk at 4.5 km/h when ≤ 0.8 km. Otherwise auto at 15 km/h + 5 min hail, fare ₹36 for the first 2 km + ₹18/km (approx).
- **Eligibility:** access ≤ 2.5 km at *both* ends, else `null` with reason "No operational metro station within 2.5 km of X."
- **Routing:** Dijkstra over the station graph (`metro_stations`, `metro_edges`), operational lines only (`status='operational'` is a data field).
- **Fare slabs** (approx, config): 0–2 km ₹10, 2–4 ₹20, 4–6 ₹30, 6–8 ₹40, 8–10 ₹50, 10–12 ₹60, 12–15 ₹70, 15–20 ₹80, > 20 ₹90.

Every estimate shows a ±20% band and the label "estimate."

Worked example (becomes a unit test). Koramangala centroid (12.9352, 77.6245) → Manyata Tech Park (13.0475, 77.6210):
- Haversine distance ≈ 12.49 km.
- Car (peak): 12.49 × 1.4 = 17.49 km; at 16 km/h that is 65.6 min, + 6 min = **72 min**.
- Bike: 12.49 × 1.3 = 16.24 km; at 22 km/h that is 44.3 min, + 4 min = **48 min**.
- Metro: **null**, because no operational station is within 2.5 km of Manyata in the fixture.

**Match score** (Compare assistant): 0–100 with **one scale everywhere**. It is a weighted sum of budget fit (30), deposit fit (10), commute fit (30), BHK/furnishing/parking match (20) and fair-rent badge (10). Each component is shown, and the "median match score" is computed from the same displayed values.

**TCO per month** (`tco/compute.ts`), returning a breakdown with a trace:

```
TCO = rent + maintenance + deposit_opportunity + one_time_amortized + commute + pg_food_adjustment
```
- `maintenance`: the listed value, else ₹3/sqft for apartments (flag `ESTIMATED`), else 0.
- `deposit_opportunity`: deposit × 7%/12. If the deposit is unknown, use the locality median deposit months × rent and flag it.
- `one_time_amortized`: (movers ₹8,000 + painting deduction of 0.5× rent) / 11-month lease. User-editable.
- `commute`: cost per trip × 2 × 22 working days.
- `pg_food_adjustment`: ₹4,500 if `food_included = false`.

Worked test: rent ₹34,000, deposit ₹1,70,000, maintenance ₹3,000, movers ₹8,000 only (painting 0), metro ₹50/trip → 34,000 + 992 + 3,000 + 727 + 2,200 = **₹40,919**.

Property test (fast-check): the components always sum to the total, and no component is negative.

**Side-by-side:** 2–4 columns with a sticky label column. Rows: rent, deposit, move-in, fair-rent badge, ₹/sqft, area, furnishing, PG sharing/food/gender, commute per mode, TCO and each component. Best value per row is highlighted. At 390px the columns scroll horizontally with scroll-snap and the labels stay pinned.

### 3.6 Analytics that are correct

- **Universe:** active, accepted, canonical listings, each cluster counted once. This is stated in the page header.
- **Rendering:** every panel uses a single server-side query module returning one `Panel<T>` object. The chart *and* its table render from it, with values in `data-value` attributes for testing.
- **Number formatting:** `formatINR(null) → "—"`. Never "N/A", "NaN" or "₹N/A".
- **Small samples:** a minimum n of 15 per bar or cell. Below that the bar is greyed and labelled "low sample (n=9)".

Panels:
1. **KPI tiles:** active listings, median rent (mean shown secondary), median ₹/sqft, localities covered (canonical count), duplicates merged, rejected.
2. **Rent distribution:** log-binned histogram, toggled by BHK.
3. **Top localities:** median rent with P25–P75 whiskers and n.
4. **₹/sqft by locality:** dot plot plus sortable table.
5. **Trends:** monthly median by BHK over 6 months from `price_observations`, with n per month.
6. **Source comparison:** listings, % unique vs duplicated, and median delta vs fair rent ("Tamarind lists 4% above fair on average").
7. **Furnishing split.**
8. **Locality heatmap:** `ST_HexagonGrid` at about 750 m. Metric toggle: median ₹/sqft or median fair-delta.

**Data-quality panel** (`/analytics/quality`):
- Funnel: raw → accepted → canonical, with `raw = accepted + rejected` and `accepted = canonical + duplicates merged` shown as equations.
- Rejections by code, with counts and up to 3 anonymized examples each (for example `LOCALITY_UNRESOLVED: "From" ×40`).
- Warnings by code, the unmatched-locality queue, dedup stats (pairs evaluated, matches, possibles, guard splits) and model metrics (MdAPE, interval coverage, active model).

Charts are **server-rendered SVG** primitives (`components/charts/*`, using `d3-scale` and `d3-array` only). No client chart library is needed: they are fast and accessible, each with a `<table>` fallback.

### 3.7 Platform

- **Auth:** Auth.js v5 (`next-auth@5`, exact version pinned) with `@auth/drizzle-adapter` and database sessions.
  - Email magic link via a custom `sendVerificationRequest` that writes to `email_outbox`. No passwords are stored.
  - Sessions are checked in Node server components and route handlers, **not** in edge middleware.
  - Anonymous favorites in localStorage merge on first sign-in.
- **Rate limiting:** Postgres fixed-window counter in Node route handlers (`withRateLimit`):
  ```sql
  INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count
  ```
  - Keys are `sha256(IP_HASH_SALT + ip)` plus the route group. `X-Forwarded-For` is trusted only when `TRUST_PROXY=1`.
  - Limits: public 120/min/IP, `/search/parse` 10/min, auth 5 per 15 min per email-hash and IP, `/api/me/*` 60/min/user.
  - Over the limit returns `429` with `Retry-After` and `X-RateLimit-*` headers.
- **Validation:** Zod 4 on every query, body and param. A route registry `defineRoute({ method, path, query, params, body, response, auth, rateLimit })` drives both the handler wrapper and the OpenAPI document.
- **OpenAPI 3.1:** built from `z.toJSONSchema()` per registered route and served at `/api/v1/openapi.json`. `/api-docs` renders it server-side. Contract tests validate real responses against it.
- **SEO:**
  - `sitemap.ts` covers static pages and 69 `/localities/[slug]` pages. Listing pages are excluded in synthetic mode.
  - Per-locality landing pages are ISR (revalidate 3600) and include JSON-LD `Place` + `Dataset`.
  - OG images via `next/og` for listings and localities, with fonts bundled locally.
  - `llms.txt` describes the site, API, methodology and data provenance.
  - **While `NIVAAS_DATA_MODE=synthetic`:** `robots.txt` is `Disallow: /` and every page carries `<meta name="robots" content="noindex">`. The machinery is built and tested but does not index synthetic data.
- **Optional LLM:** `@anthropic-ai/sdk`.
  - (a) Natural-language search parse ("2bhk near manyata under 35k furnished" → `Filters`) using **claude-sonnet-5-5** with tool-use JSON schema, a Zod-validated result, a 3 s timeout, and fallback to the engine rules parser.
  - (b) Bulk extraction of structured fields from free-text descriptions during ingest using **claude-haiku-5-5**. It never overrides structured fields, adds flag `EXTRACTED_LLM`, and caches in `llm_cache` by input hash.
  - With no key, the rules parser and regex extractor run, and the response reports `parser: "rules"`. No PII is sent; only listing text or the user's query.

---

## 4. Architecture

### 4.1 Diagram

```
                         ┌─────────────────────────── packages/ingest ───────────────────────────┐
  SourceAdapter[]        │  cli.ts  (ingest:run · db:seed · alerts:run · model:fit · eval:*)     │
  ├ synthetic (seeded)   │                                                                       │
  ├ csv-feed (licensed)  │  fetch ─► raw_listings ─► normalize ─► canonicalize ─► quality ─►     │
  └ owner-submission     │           (jsonb, hash)    (engine)     (engine + PostGIS KNN) (engine) │
    (documented stub)    │  ─► dedup ─► fair-rent fit/predict ─► deals ─► alerts ─► REFRESH MVs  │
                         │     (engine)   (engine, model_runs)    (engine) (engine)              │
                         └──────────────┬────────────────────────────────────────────────────────┘
                                        │ writes (admin role)
                         ┌──────────────▼──────────── packages/db ───────────────────────────────┐
                         │ Postgres 16 + PostGIS (docker, host :5432)                             │
                         │ migrations/*.sql (source of truth) · Drizzle schema (typed queries)    │
                         │ queries/* (repositories) · roles: nivaas (owner), nivaas_app (web)     │
                         │ schema seed_truth (no grant to nivaas_app)                             │
                         └──────────────▲────────────────────────────────────────────────────────┘
                                        │ reads + user-table DML (nivaas_app, RLS by user)
                         ┌──────────────┴──────────── apps/web (Next 15, :3000) ──────────────────┐
  Browser ◄─────────────►│ RSC pages · route handlers /api/v1/* (public) /api/me/* (session)      │
  MapLibre (client-only) │ defineRoute(Zod) → validate · rate-limit (pg) · OpenAPI · Auth.js       │
  tiles: OpenFreeMap     │ server-rendered SVG charts · next/og · sitemap/robots/llms.txt          │
                         └──────────────▲────────────────────────────────────────────────────────┘
                                        │ imports pure functions (format, filters, commute, tco, badge text)
                         ┌──────────────┴──────────── packages/engine ────────────────────────────┐
                         │ Pure TS. No I/O, no clock (asOf is input), no randomness, zero deps.   │
                         │ normalize · locality · geo · stats · quality · dedup · fairrent ·       │
                         │ deals · commute · tco · filters · alerts · query · trace · version     │
                         └────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Package boundaries

These are enforced by `dependency-cruiser` through `pnpm check:boundaries`.

| Package | May import | Must not import | Owns |
|---|---|---|---|
| `@nivaas/engine` | nothing (devDeps: vitest, fast-check) | any package, `node:*`, `Date.now`, `Math.random` (ESLint `no-restricted-properties`) | all domain logic, `ENGINE_VERSION`, `Trace`, `Flag` |
| `@nivaas/db` | engine (types and enums) | ingest, web | migrations, migrator, Drizzle schema, client (`withAdmin`, `withUser`), query modules, reference data loader, drift check |
| `@nivaas/ingest` | engine, db, `@anthropic-ai/sdk` (optional) | web | `SourceAdapter`, adapters, pipeline, CLI, seed, evals |
| `@nivaas/web` | engine, db, `@anthropic-ai/sdk` (optional) | ingest | UI, API, auth, rate limits, OpenAPI, SEO |

### 4.3 Conventions mirrored from solum (and deliberate deviations)

**Mirrored:**
- Package scope and module format: `@nivaas/*`, `"type": "module"`, `main`/`types` pointing at `./src/index.ts` (no build step).
- Scripts run via `vite-node`.
- Strict tsconfig flags: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `noImplicitOverride`.
- `next.config.mjs` with `transpilePackages: ['@nivaas/engine','@nivaas/db']`, webpack `extensionAlias {'.js': ['.ts','.tsx','.js']}` and `serverExternalPackages: ['pg']`.
- `db/src/client.ts` dotenv walk-up loader, TLS for non-localhost, and `withAdmin`/`withUser` (solum's `withTenant` pattern: `SET LOCAL ROLE nivaas_app` + `set_config('nivaas.user_id', …, true)`).
- Numbered SQL migrations applied by a checksum migrator (`schema_migrations`) that **refuses edited migrations**.
- Root scripts `db:up/db:down/db:migrate/db:seed/db:reset/db:fresh/verify`.
- Deterministic LCG/mulberry32 seed. Every synthetic row is tagged `is_synthetic`. Aggregates are derived, never stated.
- Engine purity, `ENGINE_VERSION` stamped on every derived row, `Trace` and `Flag {code, severity, message, evidence}`.
- `docs/architecture.md`, and a design-direction comment block at the top of `globals.css`.

**Deviations, stated so nobody mirrors the wrong value:**

| Area | solum | Nivaas | Why |
|---|---|---|---|
| Web port | 3100 | **3000** | Fixed decision |
| Postgres host port | 5433 | **5432** | Fixed decision. `pnpm preflight` **fails loudly** if 5432 is held by anything other than `nivaas-postgres`. It never silently remaps. |
| DB image | `postgres:16-alpine` | `postgis/postgis:16-3.5` | PostGIS. If no arm64 manifest exists, fall back to `packages/db/docker/Dockerfile`: `FROM postgres:16-bookworm` + `apt-get install postgresql-16-postgis-3`. Selected by `NIVAAS_PG_BUILD=local`. |
| Data access | raw `pg` | `pg` Pool + **Drizzle** (`drizzle-orm/node-postgres`) as typed query layer | SQL files remain the source of truth. Drizzle Kit is **not** used to apply migrations. `pnpm db:check-drift` migrates a scratch DB and compares `information_schema.columns` and enum labels to Drizzle `getTableConfig()` output. A mismatch fails `verify`. Geography columns use a Drizzle `customType`; spatial SQL via the `sql` template. |
| Styling | plain CSS variables | Tailwind v4 (`@tailwindcss/postcss`) with tokens in `@theme` | Keeps the direction comment block. Tokens are CSS variables, so the solum habit carries over. |
| Lint | none | ESLint flat config + dependency-cruiser | Engine purity and package boundaries need machine enforcement |

### 4.4 Data flow and the synthetic seed

`pnpm db:fresh` = reset → migrate → `db:reference` (localities, aliases, metro, presets) → `db:seed` (26 weekly ingest runs). The synthetic adapter lives in `packages/ingest/src/adapters/synthetic/`.

**Seed constants** (in `adapters/synthetic/params.ts`; `SEED=20261001`):

| Item | Value |
|---|---|
| True units | ~5,350: ~4,150 flats/houses and ~1,200 PG offerings |
| Sources per unit | 1 source 80%, 2 sources 16%, 3 sources 4% → ~6,450 source rows |
| Planted hard negatives | 150 pairs of distinct units in the same building: ≤ 30 m apart, same BHK, rent within 5%, *different* photos and floors |

Fictional sources, all `is_synthetic=true` and displayed as "Name (demo)":

| id | Display | Mix |
|---|---|---|
| `tamarind` | Tamarind (demo) | flats, 40%, complete fields |
| `banyan` | Banyan (demo) | flats, owner-heavy, 30%, deposit missing 25% |
| `peepal` | Peepal (demo) | PG/coliving 100% |
| `jacaranda` | Jacaranda (demo) | flats + PG, premium skew (+6%), 15% |
| `gulmohar` | Gulmohar Owners (demo) | owner submissions, 5%, details in free text only (exercises extraction) |

**True expected rent** (flats): `base2BHK[locality] × bhkMult × furnMult × (area/typArea[bhk])^0.35 × buildingEffect × drift`.
- `bhkMult`: RK 0.42, 1 0.60, 2 1.00, 3 1.45, 4 2.00, 5+ 2.60.
- `furnMult`: unfurnished 0.90, semi 1.00, furnished 1.18.
- `typArea` (sqft): RK 350, 1 600, 2 1,100, 3 1,550, 4 2,300, 5+ 3,200. Actual area ~ N(typArea, 12%).
- `buildingEffect` ~ lognormal(0, 0.06). This is not modelled by either fair-rent model, on purpose.
- `drift` = +0.4% per month.
- Observed rent = truth × lognormal(0, 0.10), rounded to ₹500.

**PG pricing:** per bed = `pgBaseSingle[zone]` × sharing (single 1.00, double 0.68, triple 0.55, quad 0.48) + food ₹2,000 if included.
- `pgBaseSingle`: Central 17K, East 14K, South-East 14K, South 12K, West 11K, North 12K, North-East 12K.
- Gender mix: male 45%, female 35%, coed 20%. Food included 70%.

**Deposits** in months of rent: {2: 15%, 3: 25%, 5: 25%, 6: 20%, 10: 15%}. PG uses 1–2 months. 8% of rows have the deposit missing.

**Location:** Gaussian jitter around the centroid with σ = radius/2, clipped to the radius.

**Cross-source variants of the same unit:**
- Rent ±0–5% (re-rounded), title rewritten from templates, area ±0–3% or missing, lat/lng jitter ≤ 120 m.
- Photo hashes: the same base 64-bit hashes with 0–4 random bit flips, plus a different count and order.

**Planted deals:** 2% of flats get rent = truth × U(0.60, 0.78), with complete data. 10 rows at ×0.30 test quarantine and outlier rejection.
- **Truth deal** := observed rent ≤ 0.80 × true expected rent. This includes natural noise cases, so precision and recall measure model error only.

**Dirty rows** (~3%):

| Defect | Rows | Expected outcome |
|---|---|---|
| Rent ₹1 | 30 | rejected |
| Annual rent entered as monthly | 20 | repaired |
| Lakh confusion ("4.2") | 15 | repaired |
| Locality "From" | 40 | rejected unless geo resolves; 25 of these have null geo |
| Locality "Bangalore" | 15 | as above |
| Empty locality with valid lat/lng | 20 | **must resolve via PostGIS**, not reject |
| Furnishing "11901" | 25 | flagged |
| Area 0 or 99,999 | 15 | — |
| (0,0) coordinates | 10 | — |

**Time:** 26 weekly runs, `as_of` 2026-04-09 → 2026-10-01. Each week: +4% new listings, 3% delisted, 2% price changes (mostly −3% to −10% drops after 3+ weeks listed).

**Photos:** 3–9 per listing, each `{ seed, dhash }`. They are rendered by `/img/plate/[seed]` as deterministic SVG "plates": a procedural floor-plan illustration from BHK plus a palette. **No external images at all.**

**Ground truth:** written to schema `seed_truth` (`units`, `source_rows`, `true_rent`, `true_deals`). The `nivaas_app` role has **no grant** on it. Evals read it via the admin role only.

### 4.5 SourceAdapter contract (`packages/ingest/src/adapter.ts`, documented in `docs/source-adapters.md`)

```ts
export interface SourceAdapter {
  readonly id: string;                       // 'tamarind' | 'csv:<feed>' | 'owner'
  readonly displayName: string;
  readonly license: {
    kind: 'synthetic' | 'licensed-feed' | 'owner-submitted';
    terms: string;                           // human-readable licence summary
    attributionRequired: boolean;
    imageRights: 'none' | 'licensed-copy' | 'owner-uploaded';  // never 'hotlink'
  };
  fetch(ctx: { asOf: Date; since?: Date; signal: AbortSignal }): AsyncIterable<RawListing>;
}
export interface RawListing {
  sourceListingId: string; url?: string; postedAt?: string; title?: string; description?: string;
  rentText?: string; depositText?: string; maintenanceText?: string; areaText?: string;
  bhkText?: string; furnishingText?: string; localityText?: string; lat?: number; lng?: number;
  pg?: { sharingText?: string; foodText?: string; genderText?: string };
  tags?: string[]; photos?: { seed?: string; storageKey?: string; dhash?: string }[];
}
```

Rules:
- Adapters must not fetch from any site without a written licence.
- `imageRights: 'hotlink'` does not exist as a type.
- `csv-feed` is the reference implementation for licensed feeds, with a test fixture of 40 rows.
- `owner-submission` reads from the `owner_submissions` table (schema only in v1).

### 4.6 Repository layout

```
nivaas/
├─ apps/web/  app/{page.tsx,pgs,deals,compare,analytics/{page,quality},listing/[id],localities/{page,[slug]},
│             activity,signin,about,methodology,api-docs,dev/mail,img/plate/[seed]/route.ts,
│             sitemap.ts,robots.ts,llms.txt/route.ts,api/{health,v1/**,me/**,auth/[...nextauth]}}
│             components/{shell,listing,filters,map,compare,charts,analytics} lib/{api,auth,rate-limit,url-state,llm}
│             e2e/*.spec.ts e2e/fixtures/map-style.json playwright.config.ts
├─ packages/engine/src/{normalize,locality,geo,stats,quality,dedup,fairrent,deals,commute,tco,filters,alerts,query}/ test/
├─ packages/db/{migrations,reference/*.json,docker/{Dockerfile,init/01-test-db.sql},src/{client,migrate,reset,
│               check-drift,load-reference,schema/*,queries/*}.ts,test/}
├─ packages/ingest/src/{adapter.ts,adapters/{synthetic,csv-feed,owner-submission},pipeline/*,eval/*,llm/*,cli.ts} test/
├─ scripts/{preflight.ts,screens.ts,brand-guard.ts,perf-api.ts}
├─ docs/{PLAN.md,architecture.md,methodology.md,data-provenance.md,source-adapters.md,screens/,codemaps/,recon/}
├─ docker-compose.yml  .env.example  package.json  pnpm-workspace.yaml  tsconfig.base.json  .dependency-cruiser.cjs
```

**`.env.example`:**

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgres://nivaas:nivaas@localhost:5432/nivaas` |
| `DATABASE_URL_TEST` | `…/nivaas_test` |
| `AUTH_SECRET` | — |
| `AUTH_URL` | `http://localhost:3000` |
| `NIVAAS_DATA_MODE` | `synthetic` |
| `NIVAAS_DEV_MAILBOX` | `1` |
| `IP_HASH_SALT` | — |
| `TRUST_PROXY` | `0` |
| `RATE_LIMIT_PUBLIC_PER_MIN` | `120` |
| `NEXT_PUBLIC_MAP_STYLE_URL` | — |
| `NIVAAS_COMMUTE_PROVIDER` | `heuristic` |
| `ANTHROPIC_API_KEY` | (empty; optional) |
| `NIVAAS_LLM_MODEL` | `claude-sonnet-5-5` |
| `NIVAAS_LLM_BULK_MODEL` | `claude-haiku-5-5` |

---

## 5. Data model

All tables are in schema `public` unless noted. Money is `integer` rupees. Geo is `geography(Point,4326)`. Extensions: `postgis`, `pg_trgm`, `citext`.

**Migrations** (numbered SQL):

| File | Contents |
|---|---|
| `0001_extensions_roles.sql` | extensions, roles `nivaas_app`, schema `seed_truth` |
| `0002_reference.sql` | localities, aliases, metro, presets, sources |
| `0003_ingest.sql` | runs, raw, source listings, observations |
| `0004_listings.sql` | listings, dedup, redirects, models, estimates |
| `0005_users.sql` | Auth.js tables, favorites, activity, saved searches, notifications, outbox, work locations |
| `0006_ops.sql` | rate limits, llm cache, owner submissions |
| `0007_analytics_mvs.sql` | materialized views |
| `0008_rls.sql` | RLS policies and grants |

### Reference

| Table | Key columns | Indexes / constraints |
|---|---|---|
| `localities` | `id smallserial`, `slug text`, `name text`, `zone text` (central/east/south_east/south/west/north/north_east), `centroid geography`, `radius_m int`, `approx bool default true`, `base_2bhk_hint int` (seed only) | `UNIQUE(slug)`, GIST(centroid), GIN(name gin_trgm_ops) |
| `locality_aliases` | `alias_norm text PK`, `locality_id`, `origin` (curated/approved) | FK |
| `locality_unmatched` | `raw_norm text PK`, `sample_raw`, `count int`, `first_seen_at`, `last_seen_at` | |
| `metro_stations` | `id`, `name`, `line` (purple/green/yellow/pink/blue), `seq int`, `geom geography`, `status` (operational/planned), `approx bool` | GIST(geom), `UNIQUE(line, seq)` |
| `metro_edges` | `from_id`, `to_id`, `minutes numeric`, `kind` (ride/interchange) | PK(from_id, to_id) |
| `work_presets` | `slug`, `name`, `geom`, `approx` | UNIQUE(slug) |
| `sources` | `id text PK`, `display_name`, `license_kind`, `terms`, `attribution`, `is_synthetic bool`, `priority smallint` | |

**Locality reference data** (`packages/db/reference/localities.json`). All centroids are approximate (±500 m) and must be verified against OpenStreetMap before real-data launch. Format: name: lat, lng, zone, base 2BHK semi ₹K, radius km.

- **Central:** MG Road 12.9756, 77.6067, central, 55, 0.8 · Richmond Town 12.9650, 77.6000, central, 50, 0.8 · Shivajinagar 12.9857, 77.6050, central, 32, 0.8 · Frazer Town 12.9986, 77.6150, central, 36, 1.0 · Ulsoor 12.9810, 77.6200, central, 42, 0.8 · Sadashivanagar 13.0070, 77.5800, central, 60, 1.0 · Malleshwaram 13.0035, 77.5709, central, 34, 1.2 · Wilson Garden 12.9480, 77.5970, central, 30, 0.8
- **East:** Indiranagar 12.9784, 77.6408, 48, 1.4 · Domlur 12.9610, 77.6387, 40, 0.9 · Murugeshpalya 12.9580, 77.6560, 34, 0.8 · CV Raman Nagar 12.9850, 77.6630, 30, 1.2 · Kaggadasapura 12.9830, 77.6800, 27, 0.9 · Marathahalli 12.9591, 77.6974, 30, 1.4 · Brookefield 12.9667, 77.7167, 32, 1.0 · Kundalahalli 12.9585, 77.7148, 31, 0.9 · Whitefield 12.9698, 77.7500, 32, 2.0 · Hoodi 12.9915, 77.7160, 26, 1.0 · Mahadevapura 12.9900, 77.6930, 27, 1.2 · KR Puram 13.0076, 77.6950, 22, 1.4 · Kadugodi 12.9970, 77.7600, 22, 1.4 · Varthur 12.9406, 77.7469, 25, 1.6 · Panathur 12.9380, 77.7160, 27, 1.0 · Bellandur 12.9304, 77.6784, 36, 1.4 · Kasavanahalli 12.9030, 77.6770, 30, 1.0 · Iblur 12.9220, 77.6630, 33, 0.8 · Sarjapur Road 12.9120, 77.6960, 33, 1.6 · Haralur 12.9070, 77.6640, 31, 1.0 · Sarjapur 12.8600, 77.7860, 20, 2.0
- **South-East:** Koramangala 12.9352, 77.6245, 42, 1.6 · HSR Layout 12.9116, 77.6474, 38, 1.6 · BTM Layout 12.9166, 77.6101, 27, 1.4 · Bommanahalli 12.9030, 77.6240, 22, 1.0 · Electronic City 12.8452, 77.6602, 20, 2.0 · Hosa Road 12.8780, 77.6600, 21, 1.0 · Begur 12.8790, 77.6300, 20, 1.2 · Bommasandra 12.8170, 77.6950, 15, 1.6 · Jigani 12.7860, 77.6400, 14, 1.6
- **South:** Jayanagar 12.9250, 77.5938, 34, 1.6 · JP Nagar 12.9063, 77.5857, 30, 1.8 · Basavanagudi 12.9406, 77.5738, 32, 1.2 · Banashankari 12.9255, 77.5468, 24, 1.6 · Kumaraswamy Layout 12.9080, 77.5620, 22, 1.0 · Uttarahalli 12.9050, 77.5450, 19, 1.2 · Arekere 12.8850, 77.6020, 25, 1.4 · Bilekahalli 12.8960, 77.6050, 26, 1.0 · RR Nagar 12.9270, 77.5170, 20, 1.6 · Kengeri 12.9080, 77.4830, 16, 1.6
- **West:** Vijayanagar 12.9719, 77.5350, 26, 1.4 · Nagarbhavi 12.9600, 77.5100, 20, 1.4 · Rajajinagar 12.9910, 77.5525, 30, 1.4 · Basaveshwara Nagar 12.9900, 77.5380, 26, 1.0 · Yeshwanthpur 13.0285, 77.5400, 28, 1.2 · Peenya 13.0280, 77.5190, 18, 1.4 · Mathikere 13.0330, 77.5640, 24, 0.9 · Jalahalli 13.0450, 77.5480, 20, 1.2
- **North:** Hebbal 13.0358, 77.5970, 36, 1.4 · RT Nagar 13.0213, 77.5960, 28, 1.0 · Sahakara Nagar 13.0620, 77.5870, 28, 1.2 · Yelahanka 13.1005, 77.5963, 22, 2.0 · Vidyaranyapura 13.0770, 77.5590, 20, 1.2 · Jakkur 13.0780, 77.6060, 26, 1.0 · Thanisandra 13.0560, 77.6330, 28, 1.4
- **North-East:** Hennur 13.0400, 77.6400, 27, 1.2 · Kalyan Nagar 13.0280, 77.6400, 30, 1.0 · Banaswadi 13.0141, 77.6518, 26, 1.0 · Kammanahalli 13.0150, 77.6380, 28, 1.0 · Ramamurthy Nagar 13.0120, 77.6770, 22, 1.2 · Horamavu 13.0270, 77.6600, 24, 1.2

That is **69 localities**.

**Curated aliases** (examples; ~120 total):

| Alias | Canonical |
|---|---|
| rajaji nagar | Rajajinagar |
| kundanahalli, kundalahalli gate | Kundalahalli |
| ibbaluru, iblur village | Iblur |
| channasandra whitefield, itpl, hope farm | Whitefield |
| electronics city, e city, electronic city phase 1 | Electronic City |
| hsr, hsr sector 2 | HSR Layout |
| btm 2nd stage | BTM Layout |
| jp nagar 7th phase | JP Nagar |
| rajarajeshwari nagar | RR Nagar |
| krishnarajapuram, k r puram | KR Puram |
| basaweshwara nagar | Basaveshwara Nagar |
| halasuru | Ulsoor |
| c v raman nagar | CV Raman Nagar |
| doddakannelli, wipro sarjapur road | Sarjapur Road |
| yelahanka new town | Yelahanka |
| hebbal kempapura | Hebbal |
| kengeri upanagara, kengeri satellite town | Kengeri |
| ramamurthi nagar | Ramamurthy Nagar |
| bannerghatta road | Arekere (coarse road alias, flagged `LOCALITY_FUZZY`) |

**Metro reference** (`reference/metro.json`): ordered station subsets, coordinates approximate (±500 m), `status` is a data field.
- **Purple (operational):** Kengeri 12.9077, 77.4870 · Mysore Road 12.9466, 77.5300 · Vijayanagar 12.9710, 77.5370 · Magadi Road 12.9757, 77.5550 · **Majestic** 12.9757, 77.5728 · Vidhana Soudha 12.9797, 77.5907 · MG Road 12.9755, 77.6066 · Halasuru 12.9760, 77.6265 · Indiranagar 12.9784, 77.6386 · Baiyappanahalli 12.9907, 77.6526 · KR Puram 13.0000, 77.6750 · Hoodi 12.9888, 77.7114 · Kundalahalli 12.9776, 77.7158 · Pattandur Agrahara 12.9877, 77.7380 · Whitefield (Kadugodi) 12.9956, 77.7577
- **Green (operational):** Nagasandra 13.0480, 77.5000 · Jalahalli 13.0394, 77.5198 · Peenya 13.0331, 77.5332 · Yeshwanthpur 13.0233, 77.5500 · Rajajinagar 13.0005, 77.5496 · Mantri Square Sampige Road 12.9907, 77.5707 · **Majestic** · KR Market 12.9610, 77.5746 · Lalbagh 12.9465, 77.5800 · Jayanagar 12.9295, 77.5801 · **RV Road** 12.9216, 77.5802 · Banashankari 12.9152, 77.5736 · JP Nagar 12.9073, 77.5731 · Yelachenahalli 12.8961, 77.5701 · Silk Institute 12.8618, 77.5300
- **Yellow (operational):** **RV Road** · Jayadeva Hospital 12.9180, 77.5995 · BTM Layout 12.9165, 77.6105 · Central Silk Board 12.9175, 77.6230 · Hongasandra 12.8990, 77.6290 · Kudlu Gate 12.8920, 77.6400 · Hosa Road 12.8770, 77.6560 · Electronic City 12.8480, 77.6680 · Hebbagodi 12.8230, 77.6880 · Bommasandra 12.8150, 77.6950
- **Interchanges:** Majestic (Purple↔Green) and RV Road (Green↔Yellow), each with a 6-minute interchange edge.
- Pink and Blue lines are added as `status='planned'` with no stations routed until verified.

**Work presets** (`reference/work-presets.json`, approximate): Manyata Tech Park 13.0475, 77.6210 · Embassy Tech Village (ORR) 12.9310, 77.6950 · RMZ Ecospace 12.9260, 77.6800 · Prestige Tech Park 12.9400, 77.6960 · Bagmane Tech Park 12.9800, 77.6630 · ITPL Whitefield 12.9870, 77.7370 · Infosys Electronic City 12.8450, 77.6640 · Embassy Golf Links 12.9540, 77.6440 · Global Village Tech Park 12.9230, 77.4980 · MG Road CBD 12.9750, 77.6070.

### Ingest

| Table | Key columns | Indexes |
|---|---|---|
| `ingest_runs` | `id bigserial`, `source_id`, `as_of timestamptz`, `started_at`, `finished_at`, `status` (running/ok/failed), `engine_version`, `stats jsonb` | (source_id, as_of DESC) |
| `raw_listings` | `id bigserial`, `run_id`, `source_id`, `source_listing_id`, `content_hash char(64)`, `payload jsonb`, `fetched_at` | `UNIQUE(source_id, source_listing_id, content_hash)` (idempotent) |
| `source_listings` | `id uuid`, `source_id`, `source_listing_id`, `listing_id uuid` (cluster), `unit_kind`, `bhk smallint`, `rent_inr int`, `deposit_inr int`, `maintenance_inr int`, `area_sqft int`, `furnishing`, `locality_id`, `geom geography`, `geohash6 char(6)`, `title`, `title_tokens text[]`, `description`, `photo_hashes bigint[]`, `photo_seeds text[]`, `pg_sharing`, `pg_food_included bool`, `pg_gender`, `parking`, `facing`, `floor smallint`, `total_floors smallint`, `tags text[]`, `posted_at`, `first_seen_at`, `last_seen_at`, `is_active bool`, `quality_status` (accepted/rejected), `quality_reasons text[]`, `quality_warnings text[]`, `extracted_by text`, `is_synthetic bool` | `UNIQUE(source_id, source_listing_id)`, (geohash6, unit_kind, bhk), (listing_id), (locality_id, bhk) WHERE accepted, GIST(geom), GIN(quality_reasons) |
| `price_observations` | `source_listing_id`, `observed_at`, `rent_inr`, `deposit_inr`, `run_id` | PK(source_listing_id, observed_at), (observed_at) |

### Listings and models

| Table | Key columns | Indexes |
|---|---|---|
| `listings` (canonical clusters, the public entity) | `id uuid`, `canonical_source_listing_id`, `member_count smallint`, `source_count smallint`, `source_ids text[]`, `rent_min_inr`, `rent_max_inr`; denormalized from canonical: `unit_kind`, `bhk`, `rent_inr`, `deposit_inr`, `move_in_inr` (GENERATED `rent_inr + deposit_inr`; null if deposit null), `area_sqft`, `furnishing`, `locality_id`, `geom`, PG fields, `photo_seeds`; fair-rent: `fair_rent_inr`, `fair_low_inr`, `fair_high_inr`, `fair_delta_pct real`, `badge`, `confidence`, `fair_explanation`; deals: `is_deal`, `deal_score real`, `deal_reason`; `first_seen_at`, `last_price_change_at`, `is_active`, `search_tsv tsvector` | GIST(geom), (is_active, unit_kind, bhk, rent_inr), (locality_id, bhk, furnishing), partial (deal_score DESC) WHERE is_deal, (first_seen_at DESC, id), GIN(search_tsv) |
| `listing_redirects` | `old_id PK`, `new_id`, `at` | |
| `dedup_pairs` | `run_id`, `a_id`, `b_id`, `score real`, `decision` (match/possible/guard_split), `features jsonb` | PK(a_id, b_id), (decision) |
| `model_runs` | `id`, `kind` (robust_median/hedonic), `engine_version`, `as_of`, `artifact jsonb`, `metrics jsonb`, `is_active bool` | Exactly one active row: `UNIQUE ((true)) WHERE is_active` |
| `fair_rent_estimates` | `listing_id`, `model_run_id`, `expected_inr`, `low_inr`, `high_inr`, `delta_pct`, `badge`, `confidence`, `basis jsonb`, `explanation` | PK(listing_id, model_run_id) |

### Users (Auth.js tables via Drizzle adapter: `users`, `accounts`, `sessions`, `verification_tokens`)

| Table | Key columns | Indexes / RLS |
|---|---|---|
| `users` | `id uuid`, `email citext UNIQUE`, `email_verified`, `name`, `created_at` | |
| `favorites` | `user_id`, `listing_id`, `created_at` | PK(user_id, listing_id). RLS `user_id = current_setting('nivaas.user_id')::uuid` |
| `activity_events` | `id bigserial`, `user_id`, `kind` (view/favorite/unfavorite/search/compare/save_search/alert_open), `listing_id`, `payload jsonb` (≤ 4 KB check), `created_at` | (user_id, created_at DESC). RLS. 180-day retention job. |
| `saved_searches` | `id`, `user_id`, `name`, `filters jsonb`, `filters_hash char(64)`, `cadence`, `last_checked_at`, `created_at` | UNIQUE(user_id, filters_hash). RLS. Max 20 per user. |
| `notifications` | `id`, `user_id`, `saved_search_id`, `listing_id`, `kind`, `created_at`, `read_at` | UNIQUE(saved_search_id, listing_id), (user_id, read_at NULLS FIRST). RLS. |
| `email_outbox` | `id`, `to_email`, `kind` (magic_link/alert), `subject`, `body_text`, `created_at`, `sent_at` | (created_at DESC). Admin-only grant. |
| `work_locations` | `user_id PK`, `label`, `geom`, `preset_slug` | RLS |

### Ops

| Table | Purpose |
|---|---|
| `rate_limit_hits(key text, window_start timestamptz, count int)` | PK(key, window_start). Rows older than 1 h purged by `withRateLimit` on 1% of calls. |
| `llm_cache(input_hash char(64) PK, model, output jsonb, created_at)` | Optional LLM cache |
| `owner_submissions(id, payload jsonb, status, created_at)` | Schema only in v1 |
| `seed_truth.units / source_rows / true_rent / true_deals` | Eval ground truth. **No grant to `nivaas_app`.** |

### Materialized views (refreshed `CONCURRENTLY` at the end of each ingest)

| View | Contents | Unique index |
|---|---|---|
| `mv_locality_stats` | (locality_id, unit_kind, bhk, furnishing) → n, p25, median, p75 rent, median psf, median deposit months | yes |
| `mv_monthly_trends` | (month, locality_id NULL = city, bhk) → median rent, n, built from price_observations joined to accepted canonical members | yes |
| `mv_source_stats` | (source_id) → listings, unique share, median rent, median fair delta | yes |
| `mv_quality_summary` | (run_id, code, severity) → count | yes |

---

## 6. API surface

### Shared behaviour

- **Envelope:** success returns the resource. Errors return `{ "error": { "code": "VALIDATION"|"NOT_FOUND"|"RATE_LIMITED"|"UNAUTHORIZED"|"FORBIDDEN"|"INTERNAL", "message": string, "details"?: ZodIssue[] } }`.
- **Pagination:** keyset `cursor` (opaque base64 of sort key + id). `limit` ≤ 50, default 24.
- **Caching:** public GETs send `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` and `ETag: W/"<latest ingest_run id>-<model_run id>"`.
- **Mutations** require a session and a same-origin `Origin` header (else 403).
- All handlers run in the Node runtime.

### Public read API (`/api/v1`, in OpenAPI, rate limit 120/min/IP)

| Method | Path | Params / body | Returns |
|---|---|---|---|
| GET | `/api/v1/listings` | `q, kind, bhk[], rent=min-max, dep=max, furn[], loc[], area=min-max, badge[], sharing[], food, gender, parking, bbox=w,s,e,n, sort (newest/rent_asc/rent_desc/fair_delta/deal/commute), work=lat,lng\|preset, mode, maxc, cursor, limit` | `{ items: ListingCard[], counts: { matched, duplicatesMerged }, nextCursor }` |
| GET | `/api/v1/listings/map` | same filters, required `bbox` | GeoJSON FeatureCollection (`id, rent, badge, kind`), ≤ 5,000 features, `truncated` flag |
| GET | `/api/v1/listings/{id}` | — | `ListingDetail` (sources[], fairRent{expected, low, high, deltaPct, badge, confidence, explanation, basis}, photos, PG fields, tags). Returns 308 + `{ redirectTo }` if the id was merged. |
| GET | `/api/v1/listings/{id}/history` | — | `{ observations: [{ at, rent, deposit, sourceId }], events: [{ at, from, to, sourceId }] }` |
| GET | `/api/v1/deals` | `loc[], bhk[], kind, cursor, limit` | `{ items: DealCard[] (with score, reason), counts }` |
| GET | `/api/v1/localities` | — | `[{ slug, name, zone, centroid, activeListings, median2bhk }]` |
| GET | `/api/v1/localities/{slug}` | — | stats by BHK × furnishing, trend series, psf, top deals, commute to presets |
| GET | `/api/v1/analytics/summary` | `kind, bhk[], furn[]` | KPI tiles + panels (distribution, top localities, psf, furnishing) |
| GET | `/api/v1/analytics/trends` | `loc, bhk` | monthly series with n |
| GET | `/api/v1/analytics/sources` | — | per-source stats |
| GET | `/api/v1/analytics/quality` | `run` | funnel, rejections by code (anonymized examples), warnings, dedup stats, model metrics |
| GET | `/api/v1/analytics/heatmap` | `metric=psf\|delta, bhk` | hex GeoJSON with value and n (cells with n < 5 omitted) |
| GET | `/api/v1/commute` | `from=lat,lng\|listing=id, to=lat,lng\|preset=slug, mode, peak=bool` | `CommuteEstimate` (minutes, low, high, km, legs, cost, method) |
| GET | `/api/v1/compare` | `ids` (2–4), `work`, `mode`, `assumptions` (movers, painting, oppRate) | columns with commute, TCO breakdown, match score components, best-per-row |
| GET | `/api/v1/work-presets` | — | presets |
| GET | `/api/v1/search/parse` | `q` (≤ 200 chars), **10/min/IP** | `{ filters, parser: "rules"\|"claude-sonnet-5-5" }` |
| GET | `/api/v1/openapi.json` | — | OpenAPI 3.1 |

### Session API (`/api/me`, 60/min/user, not in the public OpenAPI)

| Method | Path | Purpose |
|---|---|---|
| GET/POST/DELETE | `/api/me/favorites` (`{ listingId }`) | list, add or remove favorites. Writes activity. |
| POST | `/api/me/favorites/merge` (`{ listingIds[] ≤ 200 }`) | merge anonymous localStorage favorites |
| GET | `/api/me/activity?cursor` | activity log |
| GET/POST/PATCH/DELETE | `/api/me/saved-searches[/{id}]` | CRUD. Filters are validated and canonicalized server-side. |
| GET | `/api/me/notifications` · POST `/api/me/notifications/read` | in-app alerts |
| GET/PUT | `/api/me/work-location` | saved work location |
| GET | `/api/me/export` | JSON export of all user data (DPDP) |
| DELETE | `/api/me` | deletes the user and all user rows (DPDP) |

### Other routes

- **Auth:** `/api/auth/[...nextauth]`. Sign-in is limited to 5 per 15 min per email-hash and IP.
- **Infra:** `GET /api/health` → `{ ok, db, dataVersion, engineVersion, dataMode }`.
- **Non-API:** `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/listing/[id]/opengraph-image`, `/localities/[slug]/opengraph-image`, `/img/plate/[seed]` (SVG, immutable cache).
- **Dev only:** `/dev/mail`. It returns `notFound()` unless `NODE_ENV !== 'production' && NIVAAS_DEV_MAILBOX === '1'`, and `scripts/assert-prod-env.ts` fails `next build` if `NIVAAS_DEV_MAILBOX` is set while `NODE_ENV=production`.

### CLI (not HTTP)

`pnpm ingest:run --source <id> --as-of YYYY-MM-DD [--full]` · `pnpm alerts:run` · `pnpm model:fit --as-of` · `pnpm eval:dedup|eval:fairrent|eval:deals` · `pnpm db:reference`

---

## 7. UI direction + page list

### Direction: "The new classifieds"

This is a modern resetting of the newspaper *To-Let* column: dense ruled columns, editorial headlines, figures in monospace, and one highlighter colour marking what matters. It deliberately rejects the soft-green card-grid template. There are **no drop shadows and no gradient blobs**. Hierarchy comes from type, rules and numbers.

**Typography.** All fonts via `next/font/google`, self-hosted at build, OFL licences:

| Role | Font | Settings |
|---|---|---|
| Display | **Fraunces** (variable) | opsz auto, weight 600, SOFT 30. H1, section titles, locality names on landing pages. |
| UI and body | **IBM Plex Sans** | 14/20 desktop, 15/22 mobile; 500 for labels |
| Figures | **IBM Plex Mono** | tabular numerals for every rupee, delta, minute and count |
| Future Kannada UI | **Noto Sans Kannada** | reserved |

**Palette** (tokens in `@theme`, with a "night edition" variant in polish):

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F3EEE3` | page background (newsprint) |
| `--sheet` | `#FBF8F2` | raised surfaces (rows, sheets) |
| `--ink` | `#16181D` | primary text, active nav |
| `--ink-2` | `#4A4F5A` | secondary text |
| `--rule` | `#D9D1C1` | 1px hairlines between rows and columns |
| `--marigold` | `#E8A317` | the only brand accent: logo dot, focus ring, deal highlighter, selected pin |
| `--deal` | `#0B6E69` | great_deal (diverging scale, colour-blind safe) |
| `--good` | `#5FA39A` | good_price |
| `--fair` | `#8A8F98` | fair |
| `--above` | `#C9782F` | above_market |
| `--over` | `#9E3B22` | overpriced |

The status colours are the only other colours, and each one reports something.

**Shape and density:**
- 2px radius everywhere; only the bottom sheet uses a 16px top radius.
- Desktop list rows are 104px tall (8–9 visible beside the map).
- Filters are a **single horizontal chip bar** (BHK, budget, furnishing, badge, "More") rather than a long accordion. Mobile filters live in a bottom sheet.

**Signature elements:**
- **Fairness ruler:** a 120px micro-scale under the price, showing comps P10–P90, a fair-rent tick and the listing's position.
- **Plates:** procedural floor-plan placeholders instead of photos.
- **Highlighter:** a marigold underline stroke on deal reasons.
- **Ledger counts:** in the header, set in mono.

**Motion:**
- 150 ms ease-out for state changes.
- Bottom sheet 220 ms `cubic-bezier(.2,.8,.2,1)`.
- Map `flyTo` 600 ms.
- Pin pulse on row hover.
- The highlighter sweeps once (400 ms) when a deal first enters the viewport.
- `prefers-reduced-motion` reduces everything to opacity-only.

**Brand:**
- Wordmark: lowercase "nivaas" in Fraunces 600.
- Mark: a doorway arch (rounded-top rectangle outline) with a marigold dot at the threshold (the lamp at the door). SVGs in `apps/web/public/brand/`.
- Voice: plain, numerate and Bangalore-specific. Hero: "Every rental in Bangalore, counted once." Subline: "5,214 homes and PG beds from 5 demo sources. 1,183 duplicates merged, 191 rejected for bad data. See why."

**Global elements:**
- Disclosure bar on every page in synthetic mode: "Demo data: synthetic listings generated for Bangalore. Not real offers."
- Footer: OSM attribution, methodology, data provenance, API, privacy.

**390px rules:**
- No horizontal page overflow (asserted).
- Bottom tab bar: Homes, PGs, Deals, Compare.
- Tap targets ≥ 44px.
- The H1 wraps; the counts move to a second line.

### Pages

| Route | Purpose / key components |
|---|---|
| `/` | Homes search: ledger header with counts, `FilterBar`, `ListingRow` list + `MapView` split (desktop) or list/map toggle + `FilterSheet` (mobile), sort, "Search this area", save-search button |
| `/pgs` | PG search: sharing, food and gender filters, per-bed rent, PG fair-rent badge |
| `/listing/[id]` | Plates gallery; rent, deposit and move-in; fairness ruler + explanation + interval + confidence; "Also on N sources" table with per-source rent; price-history step chart; commute chips from the work location; TCO teaser; similar listings; outbound/demo interstitial |
| `/deals` | Ranked deals with reason lines, locality and BHK filters, "how deals are chosen" disclosure |
| `/compare` | Assistant (budget, deposit, BHK, work preset/locality/map click, mode, max commute, furnished, parking) → shortlist with 0–100 match scores; side-by-side 2–4 table with TCO and commute |
| `/analytics` | KPI tiles, distribution, top localities, ₹/sqft, trends, sources, furnishing, heatmap map |
| `/analytics/quality` | Funnel equations, rejections and warnings by code, unmatched localities, dedup stats, model metrics |
| `/localities` | Index of 69 localities with median 2BHK, n and zone |
| `/localities/[slug]` | SEO landing page: medians by BHK × furnishing, trend sparkline, top deals, commute to presets, OG image |
| `/activity` | Favorites, recent views, saved searches (cadence toggle), notifications |
| `/signin`, `/signin/check-email` | Magic link |
| `/methodology` | Dedup, quality and fair-rent models (live metrics), deal formula, commute assumptions with constants |
| `/about` | Product story (original copy), no empty hero |
| `/api-docs` | Rendered OpenAPI |
| `/dev/mail` | Dev-only outbox viewer |

---

## 8. Phased build plan

**Agent roster and rules:**
- **Read-only:** `planner` (re-plans a phase when acceptance fails), `architect` (design review at phase start), `code-explorer` (audits conventions and current state).
- **Writes code:** `tdd-guide` is the **only** agent that writes code, including UI, migrations, seed, scripts and config. It always writes failing tests first.
- **Review:** `security-reviewer` reviews the diff **before every push**.
- **Docs:** `doc-updater` updates `docs/architecture.md`, `docs/methodology.md`, `docs/codemaps/*` and README at the end of each phase.
- `python-reviewer` is **not applicable**: there is no Python in this stack.

**Phase order:** `architect` → `tdd-guide` tasks → `code-explorer` audit → `security-reviewer` → push/PR → `doc-updater`. One branch and PR per phase (`phase-N-<slug>`).

**Standard acceptance block** (applies to every phase in addition to the phase's own criteria):
- `pnpm verify` exits 0: typecheck + lint + check:boundaries + brand-guard + db:check-drift + unit/integration tests + e2e.
- `pnpm preflight` exits 0.
- `curl -sf localhost:3000/api/health | jq -e '.ok == true'` succeeds while `pnpm dev` is running.
- `pnpm e2e --grep @overflow` passes: every route has `document.scrollingElement.scrollWidth <= 390` at 390×844.
- `pnpm screens N` exits 0 and writes `docs/screens/phase-N.png` (1440×900 full page) and `docs/screens/phase-N-mobile.png` (390×844).
- `security-reviewer` report has no CRITICAL or HIGH findings open.

### Phase 0: Scaffold and brand shell

**Goal:** A runnable monorepo with PostGIS on :5432, a migrator, a Next app on :3000 showing the Nivaas shell, all test harnesses, the screenshot script and the guards.

**Tasks:**
1. `architect`: confirm the layout in §4.6, the boundaries in §4.2 and the solum deviations table in §4.3. Output an ADR in the PR description.
2. `code-explorer`: read `/Users/aagarwal/solum` (`package.json`, `pnpm-workspace.yaml`, `docker-compose.yml`, `packages/db/src/{client,migrate}.ts`, `apps/web/next.config.mjs`, tsconfig) and produce a checklist of conventions to mirror.
3. `tdd-guide`: root workspace files.
   - `package.json` scripts: `dev, build, test, typecheck, lint, e2e, screens, verify, preflight, brand-guard, check:boundaries, db:*, ingest:run, alerts:run, model:fit, eval:*`.
   - `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `tsconfig.base.json` with solum strict flags, ESLint flat config (engine bans `Date.now`, `Math.random`, `node:*`), `.dependency-cruiser.cjs`, `.env.example` (§4.6).
4. `tdd-guide`: `docker-compose.yml`.
   - Service `postgres`, image `postgis/postgis:16-3.5` (with the `NIVAAS_PG_BUILD=local` Dockerfile fallback), container `nivaas-postgres`, `5432:5432`, volume `nivaas-pgdata`, `pg_isready` healthcheck.
   - `docker/init/01-test-db.sql` creates `nivaas_test`.
5. `tdd-guide`: `scripts/preflight.ts`. It checks Node ≥ 20, the pnpm version, the Docker daemon, port 5432 (free, or owned by `nivaas-postgres`, else exit 1 with the holder's details) and port 3000. Tests mock `net.createServer`.
6. `tdd-guide`: `packages/db`. Port solum's `client.ts` (walk-up dotenv, `withAdmin`, `withUser`) and `migrate.ts` (checksum, refuses edits), plus `reset.ts`. Migration `0001_extensions_roles.sql`. `check-drift.ts` skeleton. Vitest integration test against `nivaas_test`: migrations are idempotent, and an edited migration is refused.
7. `tdd-guide`: `packages/engine` with `version.ts`, `trace.ts`, `flags.ts` and `money.ts`. `formatINR` tests: `125000 → "₹1,25,000"`, short forms `42000 → "₹42K"`, `150000 → "₹1.5L"`, `null → "—"`.
8. `tdd-guide`: `packages/ingest` skeleton with `adapter.ts` types and `cli.ts` (commander) printing help.
9. `tdd-guide`: `apps/web`.
   - Next 15, React 19, Tailwind v4 with the `@theme` tokens from §7 and the direction comment block, and the three fonts.
   - Shell: header with logo, nav, disclosure bar, footer with OSM attribution placeholder, and the mobile tab bar.
   - `/` shows the empty-state ledger header "0 listings". `/api/health`.
10. `tdd-guide`: Playwright config (chromium; `webServer` = `pnpm dev` on 3000; projects desktop-1440 and mobile-390), smoke spec `@overflow`, and `scripts/screens.ts`.
    - `screens.ts` uses `reducedMotion:'reduce'`, waits for `[data-ready="true"]` and intercepts `**/tiles.openfreemap.org/**` with `e2e/fixtures/map-style.json` (a background-only style) so later map screenshots are deterministic.
11. `tdd-guide`: `scripts/brand-guard.ts` fails on `/casasetu|nobroker|magicbricks|nestaway|rentmystay|99acres|housing\.com|staticmb/i` anywhere outside `docs/PLAN.md` and `docs/recon/`.
12. `security-reviewer`: env handling, docker credentials (dev-only), headers baseline (`X-Content-Type-Options`, `Referrer-Policy`, a CSP draft allowing `tiles.openfreemap.org`).
13. `doc-updater`: README quick start and `docs/architecture.md` v0.

**Acceptance:**
- [ ] `pnpm install && pnpm preflight` → exit 0. With another container bound to 5432, `pnpm preflight` → exit 1 and the message names the conflicting process.
- [ ] `pnpm db:up && docker exec nivaas-postgres psql -U nivaas -d nivaas -tAc "SELECT postgis_full_version()"` → output starts with `POSTGIS="3.`
- [ ] `pnpm db:migrate` twice → the second run prints only `=` lines and "Schema up to date".
- [ ] `pnpm --filter @nivaas/engine test` → formatINR tests pass. `pnpm typecheck` → 0 errors.
- [ ] `curl -s localhost:3000/ | grep -c "Demo data"` ≥ 1, and `<title>` contains "Nivaas".
- [ ] `pnpm brand-guard` → exit 0. Adding the word to a scratch file in `apps/` makes it exit 1.
- [ ] app runs on :3000 and a screenshot is saved to docs/screens/phase-0.png

### Phase 1: Data foundation (reference data, normalize, canonicalize, quality, synthetic seed)

**Goal:** A deterministic synthetic seed flows through normalize → locality canonicalization (alias, fuzzy, PostGIS) → quality. Accepted rows become 1:1 placeholder listings (dedup comes in Phase 2), and `/` shows them with honest counts.

**Tasks:**
1. `architect`: review migrations 0002–0004, the `listings` denormalization, enums and the `seed_truth` isolation. Confirm the Drizzle `customType` for geography.
2. `tdd-guide`: migrations `0002_reference.sql`, `0003_ingest.sql`, `0004_listings.sql` (tables in §5), plus the Drizzle schema and the `db:check-drift` comparison test.
3. `tdd-guide`: `reference/*.json` (69 localities, ~120 aliases, metro, presets, sources) and `load-reference.ts` (idempotent upsert). Tests: 69 localities, all inside the bbox, slugs unique.
4. `tdd-guide` (test-first): engine `geo/` (haversine, geohash encode and neighbours, bbox).
5. `tdd-guide` (test-first): engine `stats/` (median, type-7 quantiles, MAD, IQR, Theil–Sen, weighted median).
6. `tdd-guide` (test-first): engine `normalize/` with table-driven tests for every input listed in §3.1, including `"11901"`, `"₹1"`, `"1.5 Lac"`, `"N/A"`, sqm and sqyd.
7. `tdd-guide` (test-first): engine `locality/` (`normLocality`, stop-list, alias lookup, Jaro-Winkler with margin). "From" and "Bangalore" must yield `null`.
8. `tdd-guide` (test-first): engine `quality/` (hard rules, area-adjusted MAD with floor 0.10 and thresholds −4.0/+3.5, IQR fallback, reason codes).
9. `tdd-guide`: ingest `adapters/synthetic/`.
   - The generator follows §4.4 and is deterministic via mulberry32 with `SEED`. Snapshot test: the first 5 rows and the aggregate counts are stable.
   - It writes `seed_truth.*`.
10. `tdd-guide`: ingest `pipeline/` stages 1–4.
    - The PostGIS nearest-centroid step is in `db/queries/locality.ts`.
    - Accepted rows become 1:1 placeholder `listings`.
    - Stats go to `ingest_runs.stats`.
    - Integration test with a 40-row fixture adapter checks exact counts.
11. `tdd-guide`: `pnpm db:seed` (26 weekly runs) and `pnpm db:fresh`.
12. `tdd-guide`: `/` lists listings (simple rows: rent, move-in, locality, BHK) with the ledger header counts from the DB. `/localities` shows a table of 69. `/img/plate/[seed]` SVG placeholder route.
13. `code-explorer`: audit that the engine has no I/O, that `seed_truth` is not referenced by web, and that the solum conventions held.
14. `security-reviewer`: SQL in `queries/*` is parameterized, the `nivaas_app` grants exclude `seed_truth` and `raw_listings`, and the plate route sanitizes `seed` (`^[a-z0-9-]{1,64}$`).
15. `doc-updater`: `docs/data-provenance.md` (synthetic generator, fictional sources, truth schema) and `docs/methodology.md` §quality.

**Acceptance:**
- [ ] `pnpm --filter @nivaas/engine test --coverage` → all pass, line coverage ≥ 90% on `geo, stats, normalize, locality, quality`.
- [ ] `time pnpm db:fresh` → exit 0 in < 180 s. `SELECT count(*) FROM localities` = 69. `SELECT count(*) FROM source_listings` ≥ 6,400.
- [ ] `SELECT count(*) FROM source_listings WHERE quality_status='accepted' AND (rent_inr < 1500 OR locality_id IS NULL)` = 0.
- [ ] `SELECT count(*) FROM localities WHERE lower(name) IN ('from','bangalore','bengaluru')` = 0, and `SELECT count(*) FROM locality_unmatched WHERE raw_norm='from'` = 1.
- [ ] The 20 planted empty-locality rows with valid geo are accepted with warning `LOCALITY_FROM_GEO`. The query joining `seed_truth.source_rows` on `defect='empty_locality_geo'` returns 20 accepted.
- [ ] Rejected count equals the seed's planted-reject count exactly: `pnpm eval:quality` prints `planted_rejects=… matched=… extra_rejects≤1%`.
- [ ] `SELECT count(*) FROM raw_listings WHERE payload::text ~* '(nobroker|magicbricks|nestaway|staticmb|http)'` = 0.
- [ ] As `nivaas_app`: `SELECT 1 FROM seed_truth.units LIMIT 1` → permission denied.
- [ ] Running `pnpm db:fresh` twice produces identical `SELECT md5(string_agg(id::text||rent_inr, ',' ORDER BY id)) FROM source_listings` (determinism).
- [ ] app runs on :3000 and a screenshot is saved to docs/screens/phase-1.png

### Phase 2: Dedup, identity and price history

**Goal:** Real clustering with measured precision and recall, stable public ids, an "Also on N sources" view, and price history from 26 runs.

**Tasks:**
1. `architect`: review the blocking key, the feature weights, the chaining guards, and the identity inheritance and redirect design.
2. `tdd-guide` (test-first): engine `dedup/blocking.ts` (block keys plus neighbour enumeration; property test that true duplicates within 120 m and ±5% share a block).
3. `tdd-guide` (test-first): `dedup/similarity.ts` with hand-computed scores for 6 canonical pairs, including a same-building hard negative scoring < 0.62, a dHash Hamming helper and title tokens.
4. `tdd-guide` (test-first): `dedup/cluster.ts`. Union-find property tests (fast-check: idempotent, order-independent). Guard split test: a 3-chain with a 1.2 km span splits into 2.
5. `tdd-guide` (test-first): `dedup/canonical.ts` (completeness ordering, tie-breaks).
6. `tdd-guide`: pipeline stage 5.
   - Incremental block comparison writes `dedup_pairs`, upserts `listings` clusters, inherits ids and writes `listing_redirects`. `--full` mode.
   - Price observations are recorded on change.
7. `tdd-guide`: `ingest/eval/dedup-eval.ts` computes pairwise P/R and B-cubed F1 against `seed_truth`. `pnpm eval:dedup`.
8. `tdd-guide`: `/listing/[id]` with plates, rent, deposit and move-in (with the "deposit not listed" variant), sources table, a price-history step chart (SVG) and redirect handling. The `/` header uses the real duplicates-merged count.
9. `code-explorer`: trace that per-query `duplicatesMerged` and the header counts come from the same query module.
10. `security-reviewer`: id parsing (uuid Zod) and redirect loop protection (max 3 hops).
11. `doc-updater`: methodology §dedup (weights, thresholds, guards, metrics) and the codemap for `engine/dedup`.

**Acceptance:**
- [ ] `pnpm eval:dedup` → `pairwise_precision ≥ 0.98`, `pairwise_recall ≥ 0.92`, `bcubed_f1 ≥ 0.95`. All 150 planted hard-negative pairs are unmerged (`hard_negative_merges = 0`).
- [ ] `SELECT count(*) FROM listings WHERE is_active` between 5,000 and 5,700, and `SELECT sum(member_count-1) FROM listings WHERE is_active` equals the number in the `/` header (e2e reads `data-testid="dupes-merged"`).
- [ ] Guards hold: `SELECT count(*) FROM listings WHERE rent_max_inr > 1.25*rent_min_inr` = 0. Max member distance per cluster (a ST_Distance query in `db/test/guards.sql`) is ≤ 1000 m for all rows.
- [ ] `pnpm ingest:run --source synthetic --as-of 2026-10-01` re-run → `stats.raw_inserted = 0`, `stats.listings_changed = 0`.
- [ ] `pnpm ingest:run --source synthetic --as-of 2026-10-01 --full` → `SELECT count(*) FROM favorites_fixture f LEFT JOIN listings l ON l.id=f.listing_id LEFT JOIN listing_redirects r ON r.old_id=f.listing_id WHERE l.id IS NULL AND r.old_id IS NULL` = 0 (a test fixture of 200 ids captured before the run).
- [ ] `SELECT count(DISTINCT observed_at::date) FROM price_observations` ≥ 26, and ≥ 8% of active listings have ≥ 1 price change event.
- [ ] e2e: a known multi-source listing shows "Also on 2 sources" with two rents, and the history chart has ≥ 2 points.
- [ ] app runs on :3000 and a screenshot is saved to docs/screens/phase-2.png

### Phase 3: Fair rent and Deals

**Goal:** Every listing gets an expected rent, interval, confidence, badge and explanation. The Deals feed is ranked with reasons. Accuracy is measured against the truth.

**Tasks:**
1. `architect`: review the model hierarchy, shrinkage, LOO, hedonic design, CV protocol and artifact schema (it must be JSON-serializable and versioned).
2. `tdd-guide` (test-first): `fairrent/robust-median.ts` with hand-computed fixtures. A 9-row cell gives the expected median. Shrinkage w = n/(n+10). LOO excludes self. The area exponent is clamped.
3. `tdd-guide` (test-first): `stats/linalg.ts` (Cholesky, solve) and `fairrent/hedonic.ts` (Huber IRLS converges on a fixture with known coefficients within 1e-3).
4. `tdd-guide` (test-first): `fairrent/badge.ts` (boundaries at exactly −20%, −8%, +8%, +20%) and `fairrent/explain.ts` (golden strings, including the Koramangala example in §3.2).
5. `tdd-guide` (test-first): `deals/score.ts` (each eligibility rule has a failing fixture; score formula golden values; reason string).
6. `tdd-guide`: pipeline stages 6–7 (fit both models, 5-fold CV, choose active, write `model_runs`, `fair_rent_estimates`, denormalize to `listings`, deals). `pnpm model:fit`. `pnpm eval:fairrent` and `pnpm eval:deals` against `seed_truth`.
7. `tdd-guide`: UI. A `FairnessRuler` component and badge on rows and the detail page (explanation, interval, confidence, "Not enough comparable listings" state). `/deals` page with ranked deal rows, reason with highlighter, and locality/BHK filters.
8. `code-explorer`: confirm that no UI path computes fair rent client-side and that engine version and model run id are on every estimate.
9. `security-reviewer`: `/deals` filters are validated, and no truth data reaches the web.
10. `doc-updater`: methodology §fair rent and §deals with live metrics placeholders, and `/methodology` page copy.

**Acceptance:**
- [ ] `pnpm eval:fairrent` → active model `mdape_vs_truth ≤ 0.08` and observed-rent interval coverage between 0.55 and 0.80. Both models' metrics are printed and stored in `model_runs.metrics`.
- [ ] `pnpm eval:deals` → `precision ≥ 0.85`, `recall ≥ 0.75` against `seed_truth.true_deals`. All 10 ×0.30 plants are absent from deals: `SELECT count(*) FROM listings l JOIN seed_truth.source_rows s … WHERE s.defect='too_good' AND l.is_deal` = 0.
- [ ] `SELECT count(*) FROM listings WHERE is_deal AND (fair_delta_pct > -0.20 OR fair_delta_pct < -0.55 OR confidence='low')` = 0.
- [ ] `SELECT count(*) FROM listings WHERE badge IS NOT NULL AND fair_explanation IS NULL` = 0, and `SELECT count(*) FROM listings WHERE confidence='low' AND badge IS NOT NULL` = 0.
- [ ] With `ANTHROPIC_API_KEY` unset: `pnpm db:fresh && pnpm verify` → exit 0.
- [ ] e2e: every `/deals` row's reason contains "below fair rent" and "comps". No page contains the word "verified" (`grep -ri verified apps/web/app apps/web/components` → 0 matches outside tests).
- [ ] app runs on :3000 and a screenshot is saved to docs/screens/phase-3.png

### Phase 4: Search UX (map + list, URL filters, mobile sheet, PGs, public listing API)

**Goal:** The core search experience at 1440 and 390, backed by validated, rate-limited, OpenAPI-registered routes.

**Tasks:**
1. `architect`: review `defineRoute` (Zod 4 → handler + OpenAPI registry), the rate-limit design (pg fixed window, Node runtime), the keyset cursor and the map payload cap.
2. `tdd-guide` (test-first): engine `filters/` (types, `serialize`/`parse` round-trip property test, `filtersHash` stability, unknown params dropped).
3. `tdd-guide`: `lib/api/define-route.ts`, `lib/rate-limit.ts` (integration test: limit+1 returns 429 with `Retry-After`; `RATE_LIMIT_PUBLIC_PER_MIN=5` in test env) and the error envelope.
4. `tdd-guide`: `GET /api/v1/listings`, `/listings/map`, `/listings/{id}`, `/listings/{id}/history`, `/localities`, `/work-presets`. The query module uses the indexes from §5. Contract tests.
5. `tdd-guide`: `FilterBar` chips, `FilterSheet` (mobile bottom sheet with snap points, focus trap, Esc, `inert`) and `url-state.ts` (debounced `router.replace`, back/forward).
6. `tdd-guide`: `MapView` (client-only dynamic import, clustered GeoJSON source, badge-coloured price pins, hover sync, "Search this area", style restyling to tokens, OSM attribution). Playwright intercepts tiles with the fixture style.
7. `tdd-guide`: `/pgs` with sharing, food and gender filters and per-bed rent. Sort options. Empty and loading states. Skeleton rows.
8. `tdd-guide`: `scripts/perf-api.ts` (200 sequential requests over 10 filter combos; prints p50/p95).
9. `code-explorer`: check that all route handlers declare `runtime = 'nodejs'` and that none bypass `defineRoute`.
10. `security-reviewer`: Zod coverage, bbox and limit caps, rate-limit key privacy (hashed IP, salt from env), `TRUST_PROXY` default off, CSP for MapLibre (`worker-src blob:`).
11. `doc-updater`: API section in the README, and codemaps for `apps/web/lib/api` and `components/map`.

**Acceptance:**
- [ ] `curl -s 'localhost:3000/api/v1/listings?bhk=abc' | jq -r .error.code` → `VALIDATION`, HTTP 400.
- [ ] With `RATE_LIMIT_PUBLIC_PER_MIN=5`, the 6th `curl` within 60 s → HTTP 429 with a `Retry-After` header.
- [ ] `pnpm tsx scripts/perf-api.ts` → `p95_ms < 150` locally on the seeded DB.
- [ ] e2e: applying BHK=2 + budget + furnished updates `location.search`; reload preserves results; `page.goBack()` restores the previous filters; the matched count equals the API `counts.matched`.
- [ ] e2e (390): the "Filters" button opens a sheet with `role="dialog"` and `aria-modal="true"`; Tab stays inside it; Esc closes it and focus returns to the trigger.
- [ ] e2e: the map renders ≥ 1 cluster layer feature (`map.queryRenderedFeatures`), and hovering a row sets a `data-active` pin. No network request leaves to non-intercepted tile hosts during tests.
- [ ] e2e: `/pgs` filter `sharing=double&food=1` returns only rows with those attributes.
- [ ] app runs on :3000 and a screenshot is saved to docs/screens/phase-4.png

### Phase 5: Compare, commute and TCO

**Goal:** Commute estimates per mode with a pluggable provider, a match-score assistant on one scale, and a 2–4-way side-by-side with a TCO breakdown that works at 390px.

**Tasks:**
1. `architect`: review the `CommuteProvider` interface, metro graph representation, constants table, TCO assumptions and the user-editable inputs.
2. `tdd-guide`: migration additions for `metro_edges` population from reference data (consecutive stations at 32 km/h plus 0.5 min dwell; interchange 6 min). Test that the graph is connected per line and that the interchanges exist.
3. `tdd-guide` (test-first): engine `commute/heuristic.ts` and `commute/metro.ts`.
   - Dijkstra over the station graph, access/egress rules, and the null-with-reason path.
   - Golden tests: the Koramangala→Manyata car 72 min and bike 48 min from §3.5. A metro route Indiranagar→Majestic→Jayanagar with 1 interchange. Manyata metro returns null.
4. `tdd-guide` (test-first): engine `commute/cost.ts` (fare slabs, auto fare, per-km costs) and `tco/compute.ts` (the ₹40,919 golden test; fast-check that components sum to the total and are non-negative; deposit-unknown path flagged).
5. `tdd-guide` (test-first): engine `compare/match-score.ts` (0–100, component weights, median computed from the same values).
6. `tdd-guide`: `GET /api/v1/commute`, `/api/v1/compare` with contract tests.
7. `tdd-guide`: `/compare` page. Assistant form (presets + locality picker + map click), shortlist with score chips, a "Compare" tray (sticky bottom on mobile, max 4) and a `CompareTable` (sticky label column, scroll-snap columns, best-per-row highlight, TCO breakdown expander with editable assumptions). Commute chips on rows and detail when a work location is set (localStorage for anonymous users).
8. `code-explorer`: verify the constants are centralized with units and as-of comments, and that the UI shows "estimate" labels.
9. `security-reviewer`: `ids` cap (≤ 4) and lat/lng bounds validation. Work location is not logged in plaintext activity (rounded to 3 decimals).
10. `doc-updater`: methodology §commute and §TCO (full constants table) and codemap for `engine/commute`.

**Acceptance:**
- [ ] `pnpm --filter @nivaas/engine test commute tco compare` → pass; coverage ≥ 90% for these modules.
- [ ] `curl -s 'localhost:3000/api/v1/commute?from=12.9352,77.6245&preset=manyata-tech-park&mode=car&peak=true' | jq .minutes` → `72`.
- [ ] `curl -s '…mode=metro…preset=manyata-tech-park' | jq -r .reason` contains "No operational metro station".
- [ ] e2e: on the assistant, the median score shown equals the median of the scores displayed on the shortlist cards (regression for the reference product's scale mismatch); every score is in [0,100].
- [ ] e2e (390): comparing 4 listings shows a table with the label column visible after horizontal scroll (`boundingBox().x` stays 0) and no page-level overflow.
- [ ] e2e: the TCO total displayed equals the sum of the displayed components (parsed from `data-value`).
- [ ] app runs on :3000 and a screenshot is saved to docs/screens/phase-5.png

### Phase 6: Analytics and the data-quality panel

**Goal:** Correct, internally consistent analytics with a heatmap and a transparent data-quality panel. Every recon analytics bug is pinned by a test.

**Tasks:**
1. `architect`: review the MV definitions, refresh strategy, the `Panel<T>` contract (one object renders both chart and table) and the min-n thresholds.
2. `tdd-guide`: migration `0007_analytics_mvs.sql` and refresh at the end of the pipeline. SQL integration tests on a 60-row hand-built fixture with hand-computed medians, P25/P75 and psf.
3. `tdd-guide` (test-first): chart scale and format helpers. Axis ticks never produce "N/A" or "NaN". Null values are skipped. INR tick formatting.
4. `tdd-guide`: `components/charts/*` (Histogram, BarWithWhiskers, DotPlot, LineSeries, Donut alternative as stacked bar) as server-rendered SVG with `<title>`/`<desc>`, a `<table>` fallback and `data-value` attributes.
5. `tdd-guide`: `/api/v1/analytics/{summary,trends,sources,quality,heatmap}` (`ST_HexagonGrid` with n ≥ 5) with contract tests.
6. `tdd-guide`: `/analytics` page (KPI tiles, panels, filters kind/BHK/furnishing in the URL) and the heatmap layer in `MapView` (metric toggle).
7. `tdd-guide`: `/analytics/quality` page (funnel equations, codes table with examples, unmatched localities, dedup stats, model metrics).
8. `code-explorer`: verify every panel's chart and table share a single data source and that the universe definition is printed on the page.
9. `security-reviewer`: quality examples are anonymized (no full titles or descriptions, max 40 chars, ids hashed) and the heatmap does not leak single listings (n ≥ 5).
10. `doc-updater`: methodology §analytics (universe, medians not means, min-n) and screenshots in docs.

**Acceptance:**
- [ ] `pnpm --filter @nivaas/db test analytics` → hand-computed fixture medians match exactly.
- [ ] e2e: the `/analytics` text contains none of `N/A`, `NaN`, `undefined`, `₹1 ` and `11901` (regex scan of `innerText`).
- [ ] e2e: every locality label in charts exists in `GET /api/v1/localities` (no "From").
- [ ] e2e: for the top-localities panel, the `data-value` set on bars equals the `data-value` set in the table rows (same order, same numbers).
- [ ] e2e: on `/analytics/quality`, `raw = accepted + rejected` and `accepted = canonical + duplicatesMerged` (parsed integers satisfy the equations), and the `LOCALITY_UNRESOLVED` row lists the example "From".
- [ ] The KPI "Localities" equals `SELECT count(DISTINCT locality_id) FROM listings WHERE is_active` (≤ 69).
- [ ] app runs on :3000 and a screenshot is saved to docs/screens/phase-6.png

### Phase 7: Accounts, favorites, activity, saved searches and alerts

**Goal:** Magic-link sign-in, persistent favorites (with anonymous merge), activity log, saved searches with idempotent new-match alerts (in-app + email stub), DPDP export/delete, and RLS on user tables.

**Tasks:**
1. `architect`: review the Auth.js v5 + Drizzle adapter setup with database sessions, Node-only session checks, the RLS policies with `withUser`, and the outbox design.
2. `tdd-guide`: migration `0005_users.sql` (Auth.js tables + user tables) and `0008_rls.sql`. RLS integration test: user A cannot read B's favorites via `withUser(A)` (mirrors solum `verify-rls`). `pnpm db:verify-rls`.
3. `tdd-guide`: `lib/auth.ts`. Email provider with `sendVerificationRequest` writing to `email_outbox`. Sign-in rate limit. `/signin` and `/signin/check-email`. `/dev/mail` guarded as in §6. `scripts/assert-prod-env.ts` wired into `build`.
4. `tdd-guide`: `/api/me/*` routes from §6. Origin check on mutations. Activity writes on view, favorite, search, compare and save. The anonymous favorites merge.
5. `tdd-guide` (test-first): engine `alerts/match.ts` (a listing matches `Filters`; parity test with the SQL filter builder on 500 random filter/listing pairs).
6. `tdd-guide`: `pnpm alerts:run` (new canonical listings since `last_checked_at` → `notifications` with `ON CONFLICT DO NOTHING` → `email_outbox` digest per cadence). The synthetic adapter supports `--as-of 2026-10-08` to generate a new week.
7. `tdd-guide`: UI. Heart toggles, the "Save this search" button with name and cadence, bell with unread count, and `/activity` tabs (Favorites, Recent, Saved searches, Alerts). Export and delete-account controls.
8. `code-explorer`: confirm no route handler reads user tables via `withAdmin`.
9. `security-reviewer`: session cookie flags, CSRF/Origin, magic-link token expiry (10 min) and single use, enumeration-safe sign-in response, `/dev/mail` impossible in production, RLS, DELETE /api/me completeness, activity retention, and no email addresses in logs.
10. `doc-updater`: `docs/privacy-data-map.md` (each personal-data field, purpose and retention) and the README auth section.

**Acceptance:**
- [ ] e2e: sign in with `test@example.com` → read the link from `/dev/mail` → land signed in → favorite 2 listings → reload → still favorited. Anonymous favorites made before sign-in appear after sign-in.
- [ ] `pnpm db:verify-rls` → exit 0 (cross-user read returns 0 rows).
- [ ] Save search "2BHK Koramangala ≤ 45K", then `pnpm ingest:run --source synthetic --as-of 2026-10-08 && pnpm alerts:run` → `SELECT count(*) FROM notifications` ≥ 1 and `SELECT count(*) FROM email_outbox WHERE kind='alert'` ≥ 1. A second `pnpm alerts:run` → both counts unchanged.
- [ ] `curl -X POST localhost:3000/api/me/favorites -d '{"listingId":"…"}'` without a session → 401. With a session but `Origin: https://evil.example` → 403.
- [ ] `NODE_ENV=production NIVAAS_DEV_MAILBOX=1 pnpm build` → exit ≠ 0. `pnpm build && NIVAAS_DEV_MAILBOX= pnpm --filter @nivaas/web start` then `curl -o /dev/null -w '%{http_code}' localhost:3000/dev/mail` → 404.
- [ ] `DELETE /api/me` → `SELECT count(*)` for that user id across `users, favorites, activity_events, saved_searches, notifications, work_locations, sessions, accounts` = 0.
- [ ] app runs on :3000 and a screenshot is saved to docs/screens/phase-7.png

### Phase 8: Public API, SEO, optional LLM, and polish

**Goal:** Ship the public read API with OpenAPI, the SEO machinery (gated in synthetic mode), llms.txt, OG images, optional Claude features, and accessibility, performance and visual polish.

**Tasks:**
1. `architect`: review OpenAPI generation from the route registry, the noindex gating rules, the LLM fallback and caching design, and the PMTiles self-host option.
2. `tdd-guide`: `lib/api/openapi.ts` → `/api/v1/openapi.json` and `/api-docs` (server-rendered). A contract test suite validates real responses of every `/api/v1` route against the generated schemas; `@redocly/cli lint` runs in `verify`.
3. `tdd-guide`: `sitemap.ts`, `robots.ts` (synthetic mode → `Disallow: /`), global `noindex` in synthetic mode, `/localities/[slug]` landing pages (ISR, JSON-LD `Place` + `Dataset`), `opengraph-image.tsx` for listings and localities, and the `/llms.txt` route.
4. `tdd-guide` (test-first): engine `query/parse.ts` (rules parser: BHK, budget "under 35k/≤ 0.5L", furnishing, locality, preset names, PG terms).
5. `tdd-guide`: `lib/llm/parse.ts` (claude-sonnet-5-5 tool-use, Zod validation, 3 s timeout, `llm_cache`, fallback to rules) and `ingest/llm/extract.ts` (claude-haiku-5-5 for `gulmohar` free-text rows, batch of 20, never overrides structured fields, flag `EXTRACTED_LLM`). Both are no-ops without a key.
6. `tdd-guide`: polish.
   - `@axe-core/playwright` on all key routes at 1440 and 390.
   - Night-edition palette (`prefers-color-scheme`).
   - About page rewrite (no empty hero) and copy pass.
   - Self-hosted PMTiles option (`NEXT_PUBLIC_MAP_STYLE_URL` pointing to `/tiles/bangalore.pmtiles` style).
   - Bundle budget script (list routes ≤ 170 KB gz JS excluding the lazy map chunk).
   - Error boundaries and not-found pages.
7. `code-explorer`: a final audit that every public route is in OpenAPI, every page carries the disclosure, and the brand guard and boundaries pass.
8. `security-reviewer`: full pre-release review. CSP final, headers, rate limits on `/search/parse`, prompt-injection handling (user text only goes into a tool-constrained schema; output is Zod-validated; no tool execution), API key only on the server, OG route input sanitization, dependency audit (`pnpm audit --prod` with no high/critical).
9. `doc-updater`: final `docs/architecture.md`, `docs/methodology.md`, `docs/source-adapters.md`, `docs/codemaps/*`, README, and a CHANGELOG entry.

**Acceptance:**
- [ ] `pnpm dlx @redocly/cli lint http://localhost:3000/api/v1/openapi.json` → 0 errors. The contract suite passes for all `/api/v1` routes.
- [ ] `curl -s localhost:3000/robots.txt` contains `Disallow: /` while `NIVAAS_DATA_MODE=synthetic`. `curl -s localhost:3000/ | grep -c 'name="robots" content="noindex'` = 1. `curl -s localhost:3000/sitemap.xml | grep -c '/localities/'` = 69.
- [ ] `curl -sI localhost:3000/llms.txt` → `200` with `content-type: text/plain`. `curl -s localhost:3000/localities/koramangala/opengraph-image -o og.png && file og.png` → `PNG image data, 1200 x 630`.
- [ ] With `ANTHROPIC_API_KEY` unset: `curl -s 'localhost:3000/api/v1/search/parse?q=2bhk+near+manyata+under+35k+furnished' | jq -r .parser` → `rules`, and `.filters.bhk == [2]`, `.filters.rent.max == 35000`. With a key set: `.parser` → `claude-sonnet-5-5`. `pnpm verify` passes in both modes.
- [ ] `pnpm e2e --grep @a11y` → 0 serious or critical axe violations on `/`, `/pgs`, `/deals`, `/compare`, `/analytics`, `/analytics/quality`, `/listing/[id]`, `/activity`, `/localities/koramangala` at both viewports.
- [ ] `pnpm build` and the bundle budget script → all list routes ≤ 170 KB gz first-load JS (map chunk excluded). e2e: the `/about` first viewport has ≥ 60% of its height occupied by content blocks.
- [ ] app runs on :3000 and a screenshot is saved to docs/screens/phase-8.png

---

## 9. Risks & legal guardrails

### Legal and ethical guardrails (non-negotiable)

- **No scraping, crawling or hot-linking** of any listings portal, and no image proxy for portal URLs.
  - The `SourceAdapter.license.imageRights` type has no `hotlink` option.
  - `brand-guard` and the `raw_listings` URL-scan SQL check run in `verify`.
  - A new real source requires a written licence recorded in `sources.terms` before its adapter merges.
- **No reference-product IP:** the CasaSetu name, logo, copy, colours and layout are not used. Copy is original. Fonts are OFL. Icons are ISC (Lucide).
- **Fictional sources:** source names are generic tree names, visibly suffixed "(demo)" and flagged `is_synthetic`. Before any public demo, check that no name collides with a real rental business in India; rename if one does.
- **Synthetic disclosure:** a persistent bar on every page, a methodology section, and a `dataMode` field in `/api/health` and `llms.txt`. Synthetic listing pages are never indexed (`noindex` + robots `Disallow` + excluded from the sitemap) and never described as real offers or "verified."
- **Map data:** OpenStreetMap data is under ODbL, so "© OpenStreetMap contributors" is always visible. Tiles come from OpenFreeMap within its fair-use terms. No tile prefetching or bulk download. Self-hosted PMTiles is available in Phase 8 for independence.
- **Approximate reference data:** locality centroids, metro stations, fares, fuel and auto costs are labelled approximate in data (`approx: true`) and in the UI ("estimate"). Metro line status is a data field, not a claim. All of it must be re-verified against OSM and BMRCL before real-data launch.
- **Advice disclaimer:** fair-rent, deal and commute outputs are estimates, not advice. Every badge shows its basis and confidence and refuses when confidence is low.
- **Privacy (India DPDP Act 2023):**
  - Collect only email, favorites, searches, activity and work location, for the stated purpose.
  - Export and delete endpoints. 180-day activity retention.
  - IPs stored only as salted hashes in rate-limit keys, purged after 1 h.
  - No third-party analytics in v1 (the reference product ships PostHog; we do not).
  - Email addresses are never logged.
- **LLM:**
  - Optional, server-side key only, exact model IDs `claude-sonnet-5-5` and `claude-haiku-5-5`.
  - Only the user's query text or listing text is sent; never emails or activity.
  - Outputs are Zod-validated, cached, and never trusted to override structured data.
- **Brand clearance:** "Nivaas" and its variants are likely in use by Indian real-estate businesses. Run a trademark search (Classes 36, 42) and a domain check before any public launch. This cannot be verified offline.

### Technical risks

| Risk | Impact | Mitigation |
|---|---|---|
| `postgis/postgis` has no arm64 image on this Mac | DB won't start, or runs slowly under emulation | `NIVAAS_PG_BUILD=local` Dockerfile (`postgres:16-bookworm` + `postgresql-16-postgis-3`). Phase 0 acceptance checks `postgis_full_version()`. |
| Port 5432 already used (local Postgres) | `db:up` fails confusingly | `pnpm preflight` fails loudly naming the holder. Never remap silently. solum uses 5433, so no conflict with it. |
| Synthetic generator and models share assumptions (circular validation) | Metrics look better than reality | The generator has unmodelled effects (building effect, floor, parking). Truth deals include noise cases. Metrics are reported as "synthetic benchmark" only, and re-validated on licensed data via observed-rent CV. |
| Dedup over-merging through chains | Distinct homes hidden | Guards (1 km span, 25% spread, one-per-source), planted hard negatives with a target of 0 merges, `dedup_pairs` audit trail, "possible" band not merged. |
| Cluster id churn breaks favorites and URLs | Lost user data | Id inheritance + `listing_redirects` + Phase 2 acceptance test. |
| MAD rejects genuine deals in tight cells | Deals feed shrinks | MAD floor 0.10, asymmetric −4.0 threshold, area-adjusted residuals. Eval tracks deals recall. |
| Next middleware on the edge can't reach pg | Rate limits and auth fail | Everything runs in Node route handlers and RSC. No middleware for auth or limits. |
| MapLibre SSR, worker or CSP issues, and flaky tile network in tests | Broken map, flaky e2e | Client-only dynamic import, `worker-src blob:`, Playwright tile interception with a fixture style, map not required for list usability. |
| Auth.js v5 API churn | Upgrade breakage | Pin exact versions. Wrap in `lib/auth.ts`. e2e covers the sign-in flow. |
| Drizzle schema drifts from SQL migrations | Runtime type lies | `db:check-drift` in `verify`. SQL is authoritative. |
| Tailwind v4 + Next 15 + webpack `extensionAlias` interplay | Build errors | Phase 0 builds and screenshots the shell. Keep webpack (not Turbopack) for parity with solum. |
| Seed time (26 runs × ~6.4K rows) | Slow `db:fresh` | Batched COPY for raw rows, incremental dedup, MV refresh only at the end of the final run. Budget < 180 s, asserted in Phase 1. |
| Analytics misread on small samples | Misleading charts | min-n 15 with "low sample" greying; heatmap n ≥ 5. |

---

## 10. Definition of done

- [ ] All 9 phases (0–8) merged. Each PR has a `security-reviewer` sign-off with no open CRITICAL or HIGH findings and a `doc-updater` docs commit.
- [ ] `pnpm db:fresh && pnpm verify` exits 0 on a clean clone with `ANTHROPIC_API_KEY` unset. This covers typecheck, lint, boundaries, brand-guard, drift, unit, integration, contract, e2e, a11y and overflow.
- [ ] Engine line coverage ≥ 90%. Overall coverage ≥ 80%. Every engine module has tests written before its implementation (visible in commit order).
- [ ] Synthetic benchmarks met and printed by `pnpm eval:all`:

  | Benchmark | Target |
  |---|---|
  | Dedup pairwise precision | ≥ 0.98 |
  | Dedup pairwise recall | ≥ 0.92 |
  | Dedup hard-negative merges | 0 |
  | Fair-rent MdAPE vs truth | ≤ 8% |
  | Deals precision | ≥ 0.85 |
  | Deals recall | ≥ 0.75 |
  | Planted quality defects handled as specified | yes |

- [ ] Recon regressions pinned:
  - No "From"/"Bangalore" locality, no accepted rent < ₹1,500, no invalid furnishing value.
  - No "N/A"/"NaN" on analytics, and chart = table values.
  - One match-score scale.
  - Move-in shows "deposit not listed" when the deposit is unknown.
  - No overflow at 390px.
- [ ] Honest counts: header `listings · duplicates merged · rejected` reconcile with `/analytics/quality` equations and the API `counts`.
- [ ] `docs/screens/phase-0.png` … `docs/screens/phase-8.png` (and `-mobile` variants) exist, each produced by `pnpm screens N`.
- [ ] `docs/architecture.md`, `docs/methodology.md` (with live metrics), `docs/data-provenance.md`, `docs/source-adapters.md`, `docs/privacy-data-map.md` and `docs/codemaps/*` are current.
- [ ] Legal gates:
  - `brand-guard` passes and no portal URLs appear in data.
  - The synthetic disclosure is on every page.
  - `noindex` and robots `Disallow` are active in synthetic mode.
  - OSM attribution is visible.
  - Approximate reference data is flagged.
  - The trademark/domain check for "Nivaas" and the demo source names is recorded as a pre-launch blocker in `docs/data-provenance.md`.
