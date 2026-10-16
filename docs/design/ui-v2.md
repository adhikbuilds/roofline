# Roofline UI v2: photo-led, interactive (2026-10-16)

The owner reviewed v1 and rejected it as "zero interactive, no landing page, AI slop". v1 was type-only, flat, had no imagery
and no motion. v2 keeps the brand (name, Purple Line accent, indigo ink, the fairness ruler) and becomes **visually rich and
interactive**: real photography, a true landing page, live search, tasteful motion, depth. The owner chose this direction from
an ASCII preview. **This file overrides PLAN §7's "banned" list wherever they conflict.** Honesty rules still hold: every
number is computed live from the DB, there are no fake testimonials, and synthetic data stays labelled.

## Visual system

- **Type:** Anek Latin stays (variable wdth). Display uses wdth 112, wght 700, tracking −0.025em. Body is wdth 100, 16/26.
  Hero H1 is 64/68 desktop and 40/44 mobile. Tabular numerals for money.
- **Colour tokens** (extend `@theme`, keep the old names working):
  - `--ink #141A33` (deeper indigo), `--ink-2 #4B5270`, `--ink-3 #7A8099`
  - `--canvas #F7F7FB` (page), `--surface #FFFFFF`, `--line #E6E7EF`
  - `--purple #6D28D9` (brand, more vivid), `--purple-600 #5B21B6`, `--purple-50 #F3EEFF`, `--purple-100 #E6DCFF`
  - `--marigold #F59E0B` for deal highlights and "new" dots, `--marigold-50 #FFF7E6`
  - Verdict scale unchanged in meaning: deal `#047857`, good `#10B981`, fair `#64748B`, above `#D97706`, over `#DC2626`
  - Hero background: a soft radial mesh of `--purple-100`, `#E0F2FE` and `--canvas`, plus a faint 24px dot grid at 4% ink.
    Static, no animation.
- **Depth:** cards use 16px radius, a 1px `--line` border and shadow
  `0 1px 2px rgb(20 26 51 / 0.04), 0 8px 24px rgb(20 26 51 / 0.06)`. On hover the card lifts 2px and the shadow grows. Photos
  have a 12px radius inside cards. Buttons are 12px radius (pill only for chips).
- **Motion** (`motion` v12, `motion/react`):
  - Sections fade and rise 12px once when they enter the viewport, 400ms ease-out, staggered 60ms for grids.
  - Counters count up once.
  - The ruler marker slides in.
  - Carousels scroll-snap with arrow buttons.
  - Everything respects `prefers-reduced-motion` (opacity only, no transforms).
- **Icons:** lucide-react, 18px, 1.75 stroke.

## Imagery

- No portal images, ever. Listing photos come from `apps/web/public/photos/manifest.json`, an array of
  `{ file, kind: 'living'|'bedroom'|'kitchen'|'exterior'|'pg', alt }` (the lead generates original images with a local model).
- `photosFor(listingId, kind)` deterministically picks 3–5 photos by hashing the id. When the manifest is empty, fall back to a
  polished illustrated placeholder: a soft gradient tile (from the locality's hue) with the existing plate drawing as a light
  watermark and the BHK label. It must look intentional, not broken.
- Hero collage: 3 large photos from the manifest (or placeholders) in an asymmetric grid, rounded 20px.

## Pages

### `/`: landing (new)

1. **Hero.** Left: H1 "Every rental in Bangalore, counted once." Under it, one line on what Roofline does. Then the **search
   console**, a white card with:
   - a locality combobox (ARIA combobox; type-ahead over the 69 localities with median rent in the option row; keyboard support)
   - a BHK segmented control (Any, 1RK, 1, 2, 3, 4+)
   - a budget dual-thumb slider (₹5K–₹1.5L, log scale) with live labels
   - a primary button **"Search N homes"**, where N updates live (debounced 200ms) from `GET /api/v1/listings/count` with the
     same filters
   - submitting goes to `/homes?…` with those filters
   - below the console: live counts "3,902 flats · 1,164 PG beds · 1,106 duplicates merged" with count-up

   Right: the photo collage, with a floating **deal card** overlapping it: a real top deal (photo thumb, locality, BHK,
   rent, "22% below fair rent", the animated FairnessRuler). The card links to the listing.
2. **Deals this week.** Horizontal carousel of the 12 best deals as photo cards, with arrows and a "See all deals" link.
3. **"Is this rent fair?" interactive.** Pick a real featured listing (server-provided: fair estimate, P10/P90, comps count).
   The user drags a rent slider and the ruler marker, badge and sentence update live ("₹4,200 below the Koramangala 2BHK
   median"). This is a presentational demo over stored values, labelled "Try it". It is not a client-side fair-rent model.
4. **How it works.** Three interactive tabs; the active tab auto-advances every 6s and pauses on hover:
   - **Merged:** three source cards animate into one listing with "Also on 3 sources"
   - **Priced:** the ruler with fair, P10 and P90 labels
   - **Ranked:** deal rows sliding in
5. **Explore localities.** A grid of the 12 busiest localities: name, zone chip, median 2BHK rent, a 26-week sparkline,
   listings count. Hover lift; clicking goes to `/homes?loc=…`.
6. **Map teaser.** A static SVG outline of Bangalore with the 69 locality centroids as dots sized by listings. Hovering a dot
   shows a tooltip with the median rent. Map search arrives in Phase 4, so the CTA says "Map search is coming soon".
7. **Closing CTA band.** Indigo background, white headline, the search console repeated compactly.

The footer keeps its four columns: Product, Data, Company, Legal.

### `/homes`: browse (moved from `/`)

- A toolbar of filter chips (BHK, budget, furnishing, verdict) synced to the URL, plus sort (Best value, Newest, Rent ↑/↓).
- A 3-column grid (2 at tablet, 1 on mobile) of **ListingCard**:
  - photo carousel with dots, swipe and arrows on hover
  - a verdict badge chip over the photo
  - a heart button (local-only for now)
  - rent large, plus move-in
  - locality · BHK · area
  - a compact FairnessRuler
  - "Also on N sources" when N > 1
- Infinite "Load more" (keyset pagination) and skeleton cards while loading.

### `/deals`

Photo cards in the same style, with the reason line highlighted (marigold underline). Filters become chips. Each card shows
the rank number.

### `/listing/[id]`

- A gallery: one large photo plus 4 thumbs, with a lightbox on click (Esc, arrow keys, focus trap).
- Two columns. Left: title, facts grid with icons, the "Is this rent fair?" panel (big ruler 100% width, badge, explanation,
  interval, confidence), sources table and price history. Right: a **sticky cost card** with rent, deposit, move-in total,
  buttons "Contact via source" (disabled, labelled as demo) and "Save".
- Similar listings carousel at the bottom.

### Global

- Header: transparent over the hero, turning solid with a blur on scroll.
- Nav: Homes, PGs, Deals, Compare, Analytics, plus Saved and Sign in.
- Mobile: a slide-in menu sheet, and the bottom tab bar kept.
- The "Demo data" notice becomes a slim dismissible banner, so it isn't a heavy bar.

## Quality bar

- 1440 and 390 screenshots must look like a funded consumer product.
- No horizontal overflow, keyboard focus visible, axe: 0 serious.
- LCP image priority on the hero.
- The landing page renders server-side with data, and only interactive islands are client components.
