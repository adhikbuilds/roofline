<!-- Architect design for Phase 3 (fair rent and deals), 2026-10-16. Source of truth for engine/fairrent and engine/deals. -->

# Phase 3 design: fair rent (v1 robust-median, v2 hedonic) and Deals

Status: proposed, for `architect` review in Phase 3, task 1. Scope: `packages/engine/src/{fairrent,deals}/*`, `stats/linalg.ts`, and the `model_runs` / `fair_rent_estimates` / `listings` writes.

Sources read: PLAN §3.2, §3.3, §5, Phase 3; `engine/src/stats/*`; `engine/src/quality/{constants,outliers}.ts`; `engine/src/money.ts`; `engine/src/trace.ts`; `ingest/src/adapters/synthetic/{generate,params,truth}.ts`; `db/migrations/0004_listings.sql`; `db/src/schema/enums.ts`.

---

## 0. What the seed's rent model implies for the design

From `generate.ts` and `params.ts`, the true expected rent of a flat is:

```
rent_true = base2bhk[loc] · BHK_MULT[bhk] · FURN_MULT[furn] · (area/TYP_AREA[bhk])^0.35 · bldg · drift(week)
bldg  = exp(0.06 · N_clip2)
noise = exp(0.10 · N_clip2)           (per unit, observed only)
observed = round500(rent_true · noise · variant(0.95–1.05 on 2nd+ source) · rentSkew)   (jacaranda rentSkew = 1.06)
```

Consequences:

- **The hedonic model is correctly specified.** Log-linear terms are locality + BHK + furnishing + ln(area). Parking, gated, lift, floor and facing have no effect in the truth, so their η should come out ≈ 0.
- **Expected noise levels.** The irreducible observed-vs-truth noise is σ≈0.10 (clipped at 2σ), and the building effect σ=0.06 is invisible to both models. Expected MdAPE_truth is ≈0.04–0.06 and MdAPE_obs ≈0.07–0.09. A ±1.4826·MAD_log band is about ±1σ, giving observed coverage of ≈0.65. That fits the 0.55–0.80 target.
- **Sanity fixtures for the fitted parameters:**
  - Area exponent 0.35 sits inside the clamp [0.2, 0.8].
  - Furnishing factors are 1.18 and 0.90, i.e. ln = +0.1655 and −0.1054. Furnishing is drawn independently of locality.
- **Genuine deals:**
  - 2% of flats. Rent = truth × U(0.60, 0.78), so δ_truth ∈ [−0.40, −0.22].
  - Always single-source, complete (area, deposit, geo, exact locality) and in dense locality×BHK cells (≥ 12 rows).
  - Leave-one-out (LOO) is essential: a deal must not drag down its own cell.
- **`too_good` rows (×0.30)** are already rejected by the quality MAD test and never reach fair rent. The −0.55 floor is defence in depth.
- **Known bias.** Weekly price changes (80% decreases of 3–10%) change observed rent but not `seed_truth.true_rent`, so older listings sit below truth. This is accepted and documented in risks; the engine does not correct for it.

---

## 1. Shared definitions

| Symbol | Definition |
|---|---|
| Fit set | Active canonical `listings` (one row per cluster) with canonical member `quality_status='accepted'`, as of `asOf`. Rent = `listings.rent_inr`. |
| `bhkKey` | `rk` and `studio` → `0`; `bhk` → `min(bhk, 5)` (5 means 5+, matching `QUALITY_BOUNDS`). |
| Furnishing | `'furnished' \| 'semi' \| 'unfurnished' \| null`. `null` = unknown (for example `furnishing_invalid` rows). |
| Zone | `locality_zone` enum: central, east, south_east, south, west, north, north_east. |
| `A_b` | Reference area: city median `area_sqft` (type-7) of fit-set flats with `bhkKey=b` and known area. |
| Log medians | Every cell median is the type-7 median of **log** values. For even n this is the geometric mean of the two middle rents. |
| MAD_log | **Raw** (unscaled) `mad()` from `stats/descriptive.ts` of log values. It is multiplied by 1.4826 only in the interval. |
| `K_SHRINK` | 10. Shrinkage weight `w = n/(n+10)`, where n is the LOO count. |
| Delta | `delta = (rent_inr − expected_inr) / expected_inr`, computed on **integers** (never `rent/expected − 1`). Both operands must be positive integers, else throw. |
| Stored delta | `deltaStored = Math.fround(delta)`, because `fair_delta_pct` and `delta_pct` are Postgres `real`. |
| Time | `asOf` is an ISO string passed in. No `Date.now`. `ageDays = floor((asOf − first_seen_at) / 86_400_000)`. |

---

## 2. v1 `robust-median` (flats)

### 2.1 Fit order (pure, deterministic)

1. **Reference areas `A_b`** for b ∈ 0..5.

2. **Area exponent `ε_b`.**
   - Inputs: flats with known area in L1 cells with n ≥ 3. Demean within the cell: `x = ln(area) − med_cell(ln area)`, `y = ln(rent) − med_cell(ln rent)`.
   - `ε_b^raw = theilSenSlope(x, y)` using the existing O(n²) function. If n > 2000, subsample deterministically: sort by `listing.id` and take every ⌈n/2000⌉-th row.
   - Fallbacks:
     - `n_b < 20` or the slope is null → pooled slope over all BHKs (same demeaning).
     - Pooled slope still null → `OUTLIER_PARAMS.epsilon` (0.35).
   - Final value: `ε_b = clamp(raw, 0.2, 0.8)`. The artifact stores `raw`, `value` and `source: 'bhk' | 'pooled' | 'default'`.

3. **Area-standardised log rent:** `z_i = ln(rent_i) − ε_b·ln(area_i/A_b)`. If area is missing, there is no area term.

4. **Furnishing log factors `φ_{b,f}`**, with `φ_{b,semi} = 0`. "Median ratio" is made precise and robust to locality mix:
   - For each locality with `n(L,b,f) ≥ 3` and `n(L,b,semi) ≥ 3`, take `d_L = med(z | L,b,f) − med(z | L,b,semi)`.
   - `φ_{b,f} = weightedMedian(d_L, min(n_f, n_semi))` over qualifying localities. This is `method: 'paired'`.
   - If fewer than 5 localities qualify: `φ_{b,f} = med(z | b,f) − med(z | b,semi)` city-wide. This is `method: 'city'`.
   - If that is still empty: φ = 0, `method: 'none'`.

5. **Semi-equivalent value:** `y_i = z_i − φ_{b,f_i}`. If furnishing is null, φ = 0.

6. **Cells**, all medians and MADs of `y`:

| Level | Key (JSON string) | Members |
|---|---|---|
| L1 | `"{localityId}\|{b}\|{furn}"` | furnishing known only |
| L2 | `"{localityId}\|{b}"` | all furnishings (semi-equivalent) |
| L3 | `"{zone}\|{b}"` | all furnishings |
| L4 | `"{b}"` | city × BHK |

The task's chain "locality×BHK×furnishing → locality×BHK → zone×BHK → city×BHK" is this table. L2–L4 are the PLAN's "× furnishing factor" levels, because they pool in semi-equivalent space and multiply back by `exp(φ)` at prediction.

`ε_b`, `A_b` and `φ` are fitted on all data, including the target listing. This is an **accepted simplification**: a single listing's influence on a city-wide Theil–Sen slope or a weighted median of locality differences is negligible.

### 2.2 Leave-one-out

- **Self is excluded at every level (L1–L4), not only L1.**
  - Shrinkage, the basis rule and the displayed counts always use the LOO count: `n_k' = n_k − 1` for in-sample listings, `n_k` for out-of-sample ones.
  - For cells where `n_k < 30` (n counted *including* self), the LOO median and LOO MAD are recomputed from the cell's sorted `ys` after removing one occurrence of the listing's own `y`. Removing any equal occurrence gives the same result.
  - For cells where `n_k ≥ 30`, the full-cell median and MAD are used (PLAN §3.2). Self-influence is at most half an order-statistic gap.
- The artifact stores sorted `ys` exactly for cells with n < 30, so in-sample LOO is reproducible from the artifact alone.
- A listing is "in-sample" iff `listing.id ∈ artifact.fitIds`. This is a sorted string array (about 5.5k uuids). Callers pass `{ inSample }` explicitly; the fit-ids set is used to assert it.

### 2.3 Shrinkage (bottom-up, recursive)

```
μ4 = M4'                                   (no estimate if n4' = 0)
μ3 = w3·M3' + (1−w3)·μ4                    w_k = n_k'/(n_k'+10); a level with n_k' = 0 has w_k = 0
μ2 = w2·M2' + (1−w2)·μ3
μ1 = w1·M1' + (1−w1)·μ2                    L1 skipped (w1 = 0) when furnishing is null
ln E = μ1 + φ_{b,f} + ε_b·ln(area/A_b)     (area term = 0 when area is missing)
expected_inr = Math.round(exp(ln E))
```

`M_k'` is the (LOO) median of `y` in the listing's level-k cell.

### 2.4 Basis level, n_eff and MAD_log

- **Basis level** = the first of L1→L4 with `n_k' ≥ 10`, i.e. `w_k ≥ 0.5`: the deepest level whose own median carries at least half the weight. If none qualifies, basis = L4.
- **n_eff** (a single integer used for confidence, `basis.nEff` and "N comps"):
  - basis ∈ {L1, L2}: `n_eff = n_basis'`
  - basis ∈ {L3, L4}: `n_eff = n_L2'` (locality comps only, so < 10)
  - Rationale: the alternative `Σ ω_k n_k` counts zone and city rows as "comparable listings". That would give "high confidence" to a listing in a locality with zero comps. Here, zone and city are priors, not comps.
- **Displayed "N listings"** in the v1 explanation = `n_basis'` (LOO). It equals n_eff whenever basis is L1 or L2.
- **MAD_log** = raw MAD of `y` in the basis cell (LOO when n < 30).

### 2.5 Interval

```
h = 1.4826 · max(MAD_log, 0.05)            MAD_FLOOR = 0.05 avoids zero-width bands
low_inr  = Math.round(expected_inr · exp(−h))
high_inr = Math.round(expected_inr · exp(+h))
```

This is about a ±1σ band, so the target observed coverage is about 0.68. The artifact constants allow tuning.

### 2.6 Confidence

1. Base value:
   - `high` if `n_eff ≥ 20 AND MAD_log ≤ 0.25`
   - else `medium` if `n_eff ≥ 8`
   - else `low`
2. Downgrade one step for **each** of the following (they stack, floor at `low`):
   - `area_missing` (flats)
   - `furnishing_missing` (flats)
   - `food_missing` (PG)
3. No estimate (city cell empty, or PG sharing null) → `low`. No `fair_rent_estimates` row is written, because `expected_inr` is NOT NULL.

**What `low` means:**
- `badge = NULL` and the listing is never a deal.
- On `listings`, these are NULL: `fair_rent_inr`, `fair_low_inr`, `fair_high_inr`, `fair_delta_pct`, `badge`.
- On `listings`: `confidence='low'` and `fair_explanation = "Not enough comparable listings."`.
- The UI shows that sentence and no number ("refuse to give a verdict").
- `fair_rent_estimates` keeps the numbers with `confidence='low'`, for eval and the methodology page.

### 2.7 PG hierarchy (embedded in both artifact kinds)

- Levels:
  - P1 = `"{loc}|{sharing}|{food}"`
  - P2 = `"{zone}|{sharing}|{food}"`
  - P3 = `"{sharing}"` (city)
- Food factor `ψ_s`: same paired rule as φ, with zone as the pairing unit and "food" vs "no food" within sharing.
- `y = ln(rent) − ψ_s·[food]`. P3 pools both food states.
- Same LOO, shrinkage (K=10), basis rule (n' ≥ 10), interval and confidence.
- `n_eff = n_P1'` unless basis = P1. There is no area term.
- Sharing null → no estimate. Food null → P1/P2 skipped, ψ = 0, and confidence is downgraded.
- **Both** `robust_median` and `hedonic` artifacts embed this identical `pg` block, because the schema allows exactly one active `model_runs` row and the hedonic model has no PG terms.

---

## 3. v2 `hedonic` (flats)

### 3.1 Design matrix (94 columns; sparse rows)

| Block | Columns | Penalty |
|---|---|---|
| Intercept | 1 | 0 |
| Zone | 6 dummies (reference `central`) | 0 (unpenalised) |
| Locality deviation | 69 dummies `a_loc` (no reference) | λ (ridge toward 0, i.e. **toward the zone mean**) |
| BHK | 5 dummies for b ∈ {0,1,3,4,5} (reference 2) | 0 |
| Kind | `kind_studio` (studio vs rk within b=0; this is PLAN's `kind`) | 0 |
| Furnishing | `furn_furnished`, `furn_unfurnished`, `furn_unknown` (reference semi) | 0 |
| Area | `ln_area_c = ln(area) − ln(A_b)` (0 if missing), `area_missing` | 0 |
| Amenities | `parking_car` (parking ∈ {car, both}), `gated` (tag "Gated"), `lift` (tag "Lift") | 0 |
| Floor band | `floor_ground` (floor=0), `floor_4_9`, `floor_10p`, `floor_unknown` (reference 1–3) | 0 |

- Response: `y = ln(rent_inr)`.
- Prediction: `exp(xᵀβ)` with no smearing. It estimates the conditional median, which matches the MdAPE target.
- Rows are stored as `{ idx: Int32Array, val: Float64Array }` (about 12 non-zeros per row).
- **Identifiability:** an unpenalised column with zero weighted sum of squares (for example, no 10+ floors) is dropped. Its coefficient is 0 and it is listed in `droppedColumns`. Penalised columns always have λ on the diagonal. So `A = XᵀWX + Λ` is symmetric positive definite (SPD), otherwise `LinalgError`.

### 3.2 Huber IRLS

```
β⁰ = solve(XᵀX + Λ, Xᵀy)                                       (W = I)
repeat t = 1..maxIter:
  r = y − Xβ
  s = max(1.4826 · mad(r), 1e-6)
  w_i = 1 if |r_i| ≤ k·s else k·s/|r_i|                         k = 1.345
  β = choleskySolve(chol(XᵀWX + Λ), XᵀWy)
  stop when max_j |β_j − β_j^prev| < tol                        tol = 1e-8, maxIter = 50
```

- `λ`, `k`, `tol` and `maxIter` are **options** (defaults 1.0, 1.345, 1e-8, 50). Λ = diag(λ on locality-deviation columns, 0 elsewhere).
- The "recovers known coefficients within 1e-3" fixture runs `irlsHuber` on a generic design with `λ = 0`. Ridge would bias the estimates.
- Fixture: intercept + 3 covariates, n=200, deterministic noise from a fixed sequence, plus 10 gross outliers.
- The record stores `iterations` and `converged`. Non-convergence is not fatal: the last β is used, and it is flagged in metrics.

### 3.3 LOO, interval and confidence

- **Exact LOO for in-sample listings** at the final IRLS weights:
  - `h_ii = w_i · x_iᵀ A⁻¹ x_i`, computed as `w_i·‖L⁻¹x_i‖²`.
  - `ŷ_{−i} = y_i − r_i/(1 − h_ii)`.
  - The artifact stores the Cholesky factor `L` and the final `s`, so this is reproducible.
- **n_eff** = `n'` of the listing's locality×BHK (LOO). The displayed count rule matches v1.
- **MAD_log** = raw MAD of LOO residuals `y_i − ŷ_{−i}`:
  - in the listing's locality×BHK cell if n ≥ 10
  - else zone×BHK if n ≥ 10
  - else global.
  - Cell residual MADs are computed once at fit time and are not re-LOO'd (accepted simplification).
- **Interval and confidence thresholds:** identical to v1 (§2.5, §2.6).
  - Missing area: the `area_missing` indicator is used with `ln_area_c = 0`, plus the downgrade.
  - Missing furnishing: `furn_unknown`, plus the downgrade.
- **Explanation context:** the v2 sentence "Locality median ₹X across N listings" needs raw-rent L1 statistics. The hedonic artifact embeds `context.l1` cells: `{ n, medianRent, rents? }`. `rents` is sorted and present when n < 30, for LOO.

---

## 4. 5-fold CV and choosing the active model

1. **Folds:** `fold = fnv1a32(utf8(listing.id)) mod 5`. This is deterministic, and `Math.random` is banned in the engine. Clusters are already deduplicated, so no cross-source leakage is possible.
2. **For each fold k:**
   - Fit **both** v1 and v2 from scratch on the other 4 folds: A_b, ε, φ, cells, and the design reference areas.
   - Predict the held-out flats. These are out-of-sample, so no LOO.
3. **Evaluation set:** held-out flats where **both** models produce an estimate (the same set for both). All confidence levels are included. PGs are excluded because they share the same submodel.
4. **Metrics per model** (keys in `model_runs.metrics.cv`):
   - `mdapeObs` = median `|expected − rent|/rent`
   - `coverageObs` = share with `low ≤ rent ≤ high` (inclusive)
   - `mdapeObsBadged` and `nBadged` (non-low subset)
   - `n`
   - Synthetic mode only: `mdapeTruth` and `coverageTruth`.
     - These are computed by the ingest pipeline (admin role), which passes a `truth: Map<listingId, true_expected_rent_inr at asOf>` into `crossValidate`. The map is joined canonical member → `seed_truth.source_rows` → `true_rent`.
     - Truth values never enter an artifact.
     - `mdapeTruth` is **diagnostic only**.
5. **Selection rule:**
   - `active = 'hedonic'` iff `cv.hedonic.mdapeObs < cv.robust_median.mdapeObs`, strictly. Otherwise `'robust_median'` (ties go to v1).
   - The same rule applies in real and synthetic modes.
6. **Final fit:** both models are refit on the full fit set (these are the stored artifacts).
   - Both `model_runs` rows are written, and the winner gets `is_active=true`.
   - `fair_rent_estimates` is written for both runs, with in-sample LOO.
   - Only the active run's estimates are denormalised onto `listings`.

---

## 5. Badge (`badge.ts`)

Intervals are **right-closed `(lo, hi]`**. Every boundary belongs to the cheaper (lower) bin. This matches both explicit PLAN endpoints: `≤ −20%` and `> +20%`.

| Badge | Delta |
|---|---|
| `great_deal` | δ ≤ −0.20 |
| `good_price` | −0.20 < δ ≤ −0.08 |
| `fair` | −0.08 < δ ≤ +0.08 |
| `above_market` | +0.08 < δ ≤ +0.20 |
| `overpriced` | δ > +0.20 |
| `null` | confidence = `low` |

- The badge is computed on the **double** `delta` from integer rupees.
- IEEE division is correctly rounded, so `(33600−42000)/42000 === -0.2` exactly.

Boundary fixtures (expected = 42,000):

| rent | δ | badge |
|---|---|---|
| 33,600 | −0.20 | great_deal |
| 33,601 | −0.199976… | good_price |
| 38,640 | −0.08 | good_price |
| 38,641 | −0.0799761… | fair |
| 45,360 | +0.08 | fair |
| 45,361 | +0.0800238… | above_market |
| 50,400 | +0.20 | above_market |
| 50,401 | +0.200023… | overpriced |
| any | any | `null` with confidence `low` |

---

## 6. Explanation grammar (`explain.ts`)

The functions read the structured `basis`, never trace message text. They use `formatINRShort` from `money.ts`, so ₹42K, ₹4.2K and ₹38.2K are guaranteed.

Shared tokens:
- `Bhk` = `"1RK"` for rk; `"Studio"` for studio; otherwise `"{b}BHK"`. For b=5 the label uses the listing's actual BHK.
- `Furn` = `semi → "semi-furnished"`, `furnished → "furnished"`, `unfurnished → "unfurnished"`.
- `Zone` = `"Central Bangalore" | "East Bangalore" | "South-East Bangalore" | "South Bangalore" | "West Bangalore" | "North Bangalore" | "North-East Bangalore"`.
- `Count(n)` = Indian-grouped n + (`n === 1 ? " listing" : " listings"`).
- `Area(a)` = Indian-grouped integer, for example `1,100`.
- `Pct(δ)` = round half away from zero of `|δ|·100`.
- `LOW` = `"Not enough comparable listings."` This is the entire string whenever confidence = low.

### v1 (robust-median)

```
V1      := Lead " (" INR(expected) ", " Count(n_basis') ")." [ " Adjusted for " Area(area) " sq ft." ]
Lead    := INR(|rent − expected|) " " ("below" | "above") " the " Label " median"   if rent ≠ expected
         | "At the " Label " median"                                                  if rent = expected
Label   := L1: Locality " " Bhk " " Furn
         | L2: Locality " " Bhk
         | L3: Zone " " Bhk
         | L4: "Bangalore " Bhk
PG Label:= P1: Locality " " Sharing "-sharing PG " ("with food" | "without food")
         | P2: Zone " " Sharing "-sharing PG " ("with food" | "without food")
         | P3: "Bangalore " Sharing "-sharing PG"
```

- The parenthetical value is `expected_inr` (shrunk and area-adjusted), so the lead amount always equals `|rent − parenthetical|`.
- The "Adjusted for" sentence appears iff the listing is a flat with known area.

**Golden fixture (PLAN §3.2).** Estimate:
- `rent_inr=37800`, `expected_inr=42000`
- basis `L1`, `n_basis'=46`
- `locality='Koramangala'`, `bhk=2`, `furnishing='semi'`, `area_sqft=1100`
- `A_2=1100`, `φ=0`, `μ1 = ln 42000`

Output:

> `₹4.2K below the Koramangala 2BHK semi-furnished median (₹42K, 46 listings). Adjusted for 1,100 sq ft.`

Variants:

| Case | Golden |
|---|---|
| above | rent 46,200 → `₹4.2K above the Koramangala 2BHK semi-furnished median (₹42K, 46 listings). Adjusted for 1,100 sq ft.` |
| area missing | `₹4.2K below the Koramangala 2BHK semi-furnished median (₹42K, 46 listings).` |
| L2 fallback | `₹4.2K below the Koramangala 2BHK median (₹42K, 23 listings). Adjusted for 1,100 sq ft.` |
| L3, RK | `₹1.5K below the South-East Bangalore 1RK median (₹14K, 31 listings). Adjusted for 350 sq ft.` (rent 12,500) |
| furnished / unfurnished | `… Koramangala 2BHK furnished median …` / `… unfurnished median …` |
| singular | `(₹42K, 1 listing)`. This is reachable only via L4 when the city cell has a single comp, at low confidence. In practice it is suppressed by `LOW`, but the formatter test still covers it. |
| equal | `At the Koramangala 2BHK semi-furnished median (₹42K, 46 listings). Adjusted for 1,100 sq ft.` |
| low | `Not enough comparable listings.` |

### v2 (hedonic)

```
V2   := "Expected " INR(expected) " for a " [Area(area) " sq ft "] [Furn " "] Bhk " in " Locality
        "; listed " INR(rent) " (" Rel ")." [ " Locality median " INR(l1MedianRent) " across " Count(n_L1') "." ]
Rel  := Pct(δ) "% below" | Pct(δ) "% above" | "in line with expected"       (the last when Pct = 0)
```

- The trailing sentence appears iff furnishing is known and `n_L1' ≥ 3`.
- `l1MedianRent` is the type-7 median of raw rents (LOO when n < 30).

Golden:
- Input: `expected=38200, rent=34000, area=1100, semi, 2BHK, Koramangala, l1Median=42000, n_L1'=46`
- Output: `Expected ₹38.2K for a 1,100 sq ft semi-furnished 2BHK in Koramangala; listed ₹34K (11% below). Locality median ₹42K across 46 listings.`
- Check: δ = −4200/38200 = −0.10995 → 11.

---

## 7. Deals (`deals/score.ts`)

### 7.1 Eligibility

All rules are evaluated (no short-circuit). `failed[]` follows the fixed order below, and each rule gets one failing fixture.

| # | Rule code | Fails when |
|---|---|---|
| 1 | `NO_ESTIMATE` | No active-model estimate |
| 2 | `DELTA_ABOVE_MAX` | `deltaStored > -0.20` |
| 3 | `DEAL_TOO_GOOD_TO_VERIFY` | `deltaStored < -0.55`. Sets `quarantined=true`. Counted and listed in `model_runs.metrics.deals.quarantined {count, listingIds}` for the quality panel; never in Deals. |
| 4 | `LOW_CONFIDENCE` | `confidence === 'low'` |
| 5 | `QUALITY_NOT_ACCEPTED` | canonical member `quality_status !== 'accepted'` |
| 6 | `QUALITY_WARNING` | Any warning in the **union over active accepted cluster members** that is not in the allow-list `{'DEPOSIT_MISSING'}`. Today's codes (`AREA_MISSING`, `LOCALITY_FROM_GEO`, `BHK_AREA_MISMATCH`) all disqualify. `DEPOSIT_MISSING` is not emitted by quality; a missing deposit is detected from `deposit_inr IS NULL` and only lowers completeness. |
| 7 | `FEW_PHOTOS` | `photo_seeds.length < 3` |
| 8 | `AREA_UNKNOWN` | `area_sqft == null`. This excludes all PGs. |
| 9 | `STALE` | `asOf − last_seen_at > 14 × 86_400_000` ms. Exactly 14 days passes. |
| 10 | `SOURCE_SPREAD` | `100·(rent_max − rent_min) > 15·rent_min`. Integer arithmetic; exactly 15% passes. |

**Why `deltaStored` (`Math.fround`):**
- A double −0.55 is stored as `real` −0.5500000119, which would make the acceptance query `fair_delta_pct < -0.55 AND is_deal` return 1.
- Comparing the float32 value against the double literals guarantees the stored row satisfies both acceptance predicates, whether Postgres compares in float4 or float8. No float32 value lies strictly between `fround(−0.2)` and −0.2.
- Documented consequence: a delta that is exactly −0.55 in double is quarantined. A delta of exactly −0.20 is eligible. Both cases are tests.

### 7.2 Score

```
magnitude    = −delta                                   (double, not fround)
confW        = high 1.0 | medium 0.75
freshness    = max(0.5, 1 − ageDays/30)                 ageDays from listings.first_seen_at
completeness = 0.8 + 0.2 · k/4,  k = #{deposit_inr != null, photos ≥ 5, floor & total_floors known, parking known}
score        = magnitude · confW · freshness · completeness
```

Ranking: `score DESC`, then `listingId ASC` (deterministic).

Score goldens:
- `rent=30500, expected=39600, high, ageDays=3, k=4` → 0.2297979798 × 1.0 × 0.9 × 1.0 = **0.2068181818**.
- `medium, ageDays=20, deposit null, photos=4, floor+parking known` → freshness 0.5, completeness 0.9.

### 7.3 Reason line (stored in `listings.deal_reason`)

```
Reason := Pct(δ) "% below fair rent · saves " INR(expected − rent) "/mo · " Conf " confidence (" n_eff " comps) · listed " Age " · on " Src
Age    := "today" (0) | "1 day ago" | "{d} days ago"
Src    := "1 source" | "{k} sources"
```

- The separator is `" · "` (U+00B7 with spaces).
- The line always contains `below fair rent` and `comps`.

Golden (inputs as in the score golden, plus `n_eff=52`, `source_count=2`):

> `23% below fair rent · saves ₹9.1K/mo · high confidence (52 comps) · listed 3 days ago · on 2 sources`

---

## 8. Model artifact (`model_runs.artifact`, JSON-serialisable, versioned)

Format rules:
- Plain objects and arrays of finite numbers and strings only. No `Map`, `Float64Array`, `NaN`, `Infinity`, `BigInt` or `undefined`.
- Record keys are strings.
- Round-trip test: `predict(JSON.parse(JSON.stringify(a)), x)` must deep-equal `predict(a, x)` for every fit listing.
- `parseArtifact(unknown)` is a hand-written guard (the engine has no runtime deps). It rejects an unknown `schema` or `schemaVersion`.

```ts
// engine/src/fairrent/artifact.ts
export const ARTIFACT_SCHEMA = 'roofline.fairrent' as const;
export const ARTIFACT_SCHEMA_VERSION = 1 as const;

export interface ArtifactHeader {
  schema: typeof ARTIFACT_SCHEMA;
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: 'robust_median' | 'hedonic';
  engineVersion: string;              // ENGINE_VERSION; bump to 0.3.0 in Phase 3
  asOf: string;                       // ISO-8601 UTC
  fitIds: string[];                   // sorted listing ids (in-sample test)
  counts: { flats: number; pg: number };
}

export interface CommonConstants {
  shrinkK: 10; basisMinN: 10; looMaxN: 30;
  madScale: 1.4826; madFloor: 0.05;
  confidence: { highN: 20; highMad: 0.25; mediumN: 8 };
}

export interface CellJson { n: number; median: number; mad: number; ys?: number[] } // ys sorted, present iff n < 30

export interface PgSubmodel {
  foodLog: Record<string /*sharing*/, { value: number; method: 'paired' | 'city' | 'none' }>;
  cells: { p1: Record<string, CellJson>; p2: Record<string, CellJson>; p3: Record<string, CellJson> };
}

export interface RobustMedianArtifact extends ArtifactHeader {
  kind: 'robust_median';
  constants: CommonConstants & { epsClamp: [0.2, 0.8]; epsDefault: 0.35; tsMaxN: 2000;
                                 furnPairMinN: 3; furnMinLocalities: 5 };
  flat: {
    refArea: Record<string /*bhkKey*/, number>;
    epsilon: Record<string, { value: number; raw: number | null; n: number; source: 'bhk' | 'pooled' | 'default' }>;
    furnishingLog: Record<string, { furnished: number; unfurnished: number; method: 'paired' | 'city' | 'none' }>;
    cells: { l1: Record<string, CellJson>; l2: Record<string, CellJson>; l3: Record<string, CellJson>; l4: Record<string, CellJson> };
  };
  pg: PgSubmodel;
}

export interface HedonicArtifact extends ArtifactHeader {
  kind: 'hedonic';
  constants: CommonConstants & { lambda: number; huberK: number; tol: number; maxIter: number; zoneRef: 'central' };
  columns: string[];                  // stable order, e.g. "zone:east", "loc:17", "bhk:3", "furn:furnished"
  penalized: boolean[];
  droppedColumns: string[];
  beta: number[];
  cholL: number[];                    // row-major lower factor of XᵀWX+Λ (p×p), for exact LOO
  huberScale: number;                 // final s
  refArea: Record<string, number>;
  irls: { iterations: number; converged: boolean };
  residualMad: { locBhk: Record<string, { n: number; mad: number }>;
                 zoneBhk: Record<string, { n: number; mad: number }>; global: number };
  context: { l1: Record<string, { n: number; medianRent: number; rents?: number[] }> };
  pg: PgSubmodel;                     // identical to the robust_median run's pg block
}

export type FairRentArtifact = RobustMedianArtifact | HedonicArtifact;
export function parseArtifact(json: unknown): FairRentArtifact;
```

Size: about 0.3–0.5 MB per run (ys for n < 30 cells, plus a 94² Cholesky factor). That is acceptable for `jsonb`.

`fair_rent_estimates.basis` (also JSON):

```ts
export interface EstimateBasis {
  model: 'robust_median' | 'hedonic';
  level: 'L1' | 'L2' | 'L3' | 'L4' | 'P1' | 'P2' | 'P3' | 'hedonic';
  n: number; nEff: number; madLog: number; epsilon: number | null;
  areaAdjusted: boolean; loo: boolean;
  downgrades: Array<'area_missing' | 'furnishing_missing' | 'food_missing'>;
  modelRunId: string; engineVersion: string;
  context?: { l1MedianRentInr: number; l1N: number };
}
```

`model_runs.metrics`:

```ts
{ cv: { folds: 5, n, mdapeObs, coverageObs, mdapeObsBadged, nBadged, mdapeTruth?, coverageTruth? },
  selection: { rule: 'lower_mdape_obs_strict_ties_v1', active: boolean },
  pg: { looMdapeObs },
  deals?: { eligible, quarantined: { count, listingIds } } }
```

---

## 9. TypeScript signatures

```ts
// engine/src/fairrent/types.ts
export type Furnishing = 'furnished' | 'semi' | 'unfurnished';
export type Zone = 'central' | 'east' | 'south_east' | 'south' | 'west' | 'north' | 'north_east';
export type Confidence = 'high' | 'medium' | 'low';
export type Badge = 'great_deal' | 'good_price' | 'fair' | 'above_market' | 'overpriced';
export type ModelKind = 'robust_median' | 'hedonic';

export interface FlatInput {
  kind: 'flat'; id: string; localityId: number; zone: Zone;
  unitKind: 'rk' | 'studio' | 'bhk'; bhk: number; furnishing: Furnishing | null;
  areaSqft: number | null; rentInr: number;
  parking: 'bike' | 'car' | 'both' | 'none' | null; tags: readonly string[];
  floor: number | null; totalFloors: number | null;
}
export interface PgInput {
  kind: 'pg'; id: string; localityId: number; zone: Zone;
  sharing: 'single' | 'double' | 'triple' | 'quad' | null; food: boolean | null; rentInr: number;
}
export type FitListing = FlatInput | PgInput;

export interface Prediction {
  expectedInr: number; lowInr: number; highInr: number;
  confidence: Confidence; basis: EstimateBasis; trace: Trace;
}
export interface FairRentEstimate extends Prediction {
  listingId: string; delta: number; deltaStored: number; badge: Badge | null; explanation: string;
}
export interface PredictOptions { inSample: boolean; modelRunId: string }
```

```ts
// engine/src/fairrent/robust-median.ts
export const SHRINK_K = 10;
export function shrinkWeight(n: number, k?: number): number;                         // n/(n+k)
export function looMedian(sortedYs: readonly number[], self: number): number | null;  // removes one occurrence
export function looMad(sortedYs: readonly number[], self: number): number | null;
export function shrinkChain(levels: ReadonlyArray<{ n: number; median: number } | null>, k?: number):
  { mu: number; weights: number[] } | null;                                           // levels ordered deepest→city
export function selectBasis(counts: readonly number[], minN?: number): number;        // index of first n ≥ 10, else last
export function areaEpsilon(rows: readonly FlatInput[], refArea: Readonly<Record<string, number>>):
  RobustMedianArtifact['flat']['epsilon'];
export function furnishingFactors(z: ReadonlyArray<{ localityId: number; bhkKey: number; furnishing: Furnishing | null; z: number }>):
  RobustMedianArtifact['flat']['furnishingLog'];
export function fitPgSubmodel(rows: readonly PgInput[]): PgSubmodel;
export function predictPg(pg: PgSubmodel, c: CommonConstants, x: PgInput, o: PredictOptions): Prediction | null;
export function fitRobustMedian(rows: readonly FitListing[], opts: { asOf: string; constants?: Partial<RobustMedianArtifact['constants']> }): RobustMedianArtifact;
export function predictRobustMedian(a: RobustMedianArtifact, x: FitListing, o: PredictOptions): Prediction | null;
export function confidenceFor(nEff: number, madLog: number, downgrades: number, c?: CommonConstants['confidence']): Confidence;
export function intervalFor(expectedInr: number, madLog: number, c?: Pick<CommonConstants, 'madScale' | 'madFloor'>): { lowInr: number; highInr: number };
```

```ts
// engine/src/fairrent/hedonic.ts
export interface SparseRow { idx: Int32Array; val: Float64Array }
export interface Design { rows: SparseRow[]; p: number; columns: string[]; penalized: boolean[] }
export interface IrlsOptions { lambda?: number; huberK?: number; tol?: number; maxIter?: number }
export interface IrlsResult { beta: Float64Array; weights: Float64Array; scale: number; chol: Float64Array; iterations: number; converged: boolean }
export function buildDesign(rows: readonly FlatInput[], refArea: Readonly<Record<string, number>>): Design;
export function irlsHuber(d: Design, y: Float64Array, penalties: Float64Array, opts?: IrlsOptions): IrlsResult;
export function looPrediction(d: Design, y: Float64Array, r: IrlsResult, i: number): number;  // ŷ_{−i}
export function fitHedonic(rows: readonly FitListing[], opts: { asOf: string; pg: PgSubmodel; options?: IrlsOptions }): HedonicArtifact;
export function predictHedonic(a: HedonicArtifact, x: FitListing, o: PredictOptions): Prediction | null;
```

```ts
// engine/src/fairrent/cv.ts   (support module)
export function fnv1a32(s: string): number;
export function foldOf(id: string, k?: number): number;                               // fnv1a32(id) % 5
export interface CvResult { model: ModelKind; n: number; mdapeObs: number; coverageObs: number;
  mdapeObsBadged: number | null; nBadged: number; mdapeTruth?: number; coverageTruth?: number }
export function crossValidate(rows: readonly FitListing[], opts: { asOf: string; k?: number; truth?: ReadonlyMap<string, number> }):
  { robustMedian: CvResult; hedonic: CvResult; active: ModelKind };
export function chooseActive(v1: CvResult, v2: CvResult): ModelKind;                  // v2 iff v2.mdapeObs < v1.mdapeObs
```

```ts
// engine/src/fairrent/badge.ts
export const BADGE_EDGES = [-0.2, -0.08, 0.08, 0.2] as const;
export function deltaOf(rentInr: number, expectedInr: number): number;   // (rent−expected)/expected; positive ints only
export function storedDelta(delta: number): number;                       // Math.fround
export function badgeFor(delta: number, confidence: Confidence): Badge | null;
```

```ts
// engine/src/fairrent/explain.ts
export const NOT_ENOUGH_COMPS = 'Not enough comparable listings.';
export interface ExplainNames { localityName: string; zone: Zone }
export function formatBhk(unitKind: 'rk' | 'studio' | 'bhk', bhk: number): string;
export function formatCount(n: number, noun?: 'listing'): string;         // Indian grouping + plural
export function formatArea(sqft: number): string;
export function pctHalfAway(delta: number): number;
export function explainRobustMedian(e: Prediction, x: FitListing, rentInr: number, names: ExplainNames): string;
export function explainHedonic(e: Prediction, x: FlatInput, rentInr: number, names: ExplainNames): string;
export function explain(e: Prediction, x: FitListing, rentInr: number, names: ExplainNames): string; // dispatch on basis.model / low
```

```ts
// engine/src/stats/linalg.ts
export class LinalgError extends Error {
  readonly code: 'NOT_POSITIVE_DEFINITE' | 'DIMENSION_MISMATCH'; readonly column?: number;
}
/** Lower Cholesky factor of SPD n×n row-major A; throws NOT_POSITIVE_DEFINITE when pivot ≤ 1e-12·max(1, maxDiag). */
export function cholesky(a: Float64Array, n: number): Float64Array;
export function forwardSolve(l: Float64Array, n: number, b: Float64Array): Float64Array;  // L x = b
export function backSolve(l: Float64Array, n: number, b: Float64Array): Float64Array;     // Lᵀ x = b
export function choleskySolve(l: Float64Array, n: number, b: Float64Array): Float64Array;
export function solveSPD(a: Float64Array, n: number, b: Float64Array): Float64Array;
export function quadFormInv(l: Float64Array, n: number, x: Float64Array): number;        // xᵀA⁻¹x = ‖L⁻¹x‖²
export function weightedGramSparse(rows: readonly { idx: Int32Array; val: Float64Array }[], p: number, w: Float64Array): Float64Array;
export function weightedXtySparse(rows: readonly { idx: Int32Array; val: Float64Array }[], p: number, w: Float64Array, y: Float64Array): Float64Array;
```

```ts
// engine/src/deals/score.ts
export const DEAL_RULES = ['NO_ESTIMATE', 'DELTA_ABOVE_MAX', 'DEAL_TOO_GOOD_TO_VERIFY', 'LOW_CONFIDENCE',
  'QUALITY_NOT_ACCEPTED', 'QUALITY_WARNING', 'FEW_PHOTOS', 'AREA_UNKNOWN', 'STALE', 'SOURCE_SPREAD'] as const;
export type DealRule = (typeof DEAL_RULES)[number];
export const DEAL_LIMITS = { maxDelta: -0.2, minDelta: -0.55, minPhotos: 3, maxStaleDays: 14, maxSpreadPct: 15,
  allowedWarnings: ['DEPOSIT_MISSING'] } as const;
export interface DealInput {
  listingId: string; asOf: string; rentInr: number;
  expectedInr: number | null; delta: number | null; deltaStored: number | null;
  confidence: Confidence; nEff: number;
  qualityStatus: 'accepted' | 'rejected'; warnings: readonly string[];   // union over active accepted members
  photoCount: number; areaSqft: number | null; depositInr: number | null;
  floorKnown: boolean; parkingKnown: boolean;
  firstSeenAt: string; lastSeenAt: string;
  sourceCount: number; rentMinInr: number; rentMaxInr: number;
}
export interface DealComponents { magnitude: number; confW: number; freshness: number; completeness: number; ageDays: number }
export interface DealVerdict { listingId: string; eligible: boolean; failed: DealRule[]; quarantined: boolean;
  score: number | null; reason: string | null; components: DealComponents | null }
export function dealEligibility(x: DealInput): { failed: DealRule[]; quarantined: boolean };
export function dealComponents(x: DealInput): DealComponents;
export function dealScore(c: DealComponents): number;
export function dealReason(x: DealInput, c: DealComponents): string;
export function evaluateDeal(x: DealInput): DealVerdict;
export function rankDeals(v: readonly DealVerdict[]): DealVerdict[];       // eligible only; score DESC, id ASC
```

---

## 10. Decisions (ADR summary)

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D1 | Badge bins `(lo, hi]` | `[lo, hi)` | It is the only reading consistent with both PLAN endpoints. |
| D2 | Deal checks run on `fround(delta)` | A migration to `double precision` | No schema change, and acceptance SQL holds under float4 or float8 comparison. |
| D3 | `n_eff` = basis-level LOO count (locality levels only) | `Σ ω_k n_k` | Zone and city rows are priors, not comps. This avoids "high confidence" with zero locality data. |
| D4 | LOO at all levels; exact recompute when n < 30 | Always exact | Matches PLAN. The artifact stays small enough and in-sample estimates stay reproducible. |
| D5 | Furnishing factor = weighted median of within-locality log differences, with a city ratio-of-medians fallback | Plain city ratio | Robust to furnished stock clustering in pricier localities in real data. Equivalent on the seed. |
| D6 | Selection on observed MdAPE only, strict `<` | Truth MdAPE | Truth is unavailable in real mode and must not drive production behaviour. |
| D7 | PG robust-median submodel embedded in both artifacts | PG from the "other" run | One active `model_runs` row by constraint. |
| D8 | Hedonic `kind` = `kind_studio` | A separate `kind` for rk | rk is collinear with b=0. |
| D9 | `low` ⇒ NULL fair columns on `listings` | Show the number greyed out | "Refuse to give a verdict" (solum rule). Numbers stay in `fair_rent_estimates`. |

---

## 11. Risks and open items

- **PG sparsity.** Locality×sharing×food cells average under 3 rows, so most PGs will be `low` (no badge). Optionally add a food-adjusted locality×sharing level (a deviation from PLAN). Needs an `architect` call.
- **Price-change bias in the seed.** Observed rents drift below `seed_truth.true_rent`, which inflates `mdapeTruth` slightly and may push it toward the 0.08 bound. Watch `pnpm eval:fairrent`. If needed, restrict the fit set to `first_seen_at` within 13 weeks of `asOf`.
- **Hedonic λ=1** is weak relative to v1's K=10. Expect v2 locality effects to be noisier in small localities. CV decides.
- **Theil–Sen** is O(n²). It is capped by the 2,000-row deterministic subsample (about 2M pairs per BHK).
- **Bump `ENGINE_VERSION`** (to 0.3.0), since fair-rent output is new. Every estimate's `basis` carries `engineVersion` and `modelRunId`.