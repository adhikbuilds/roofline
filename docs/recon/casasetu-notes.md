# CasaSetu teardown (recon 2026-10-15)

Source files: casasetu-text.md (visible text of /, /pgs, /deals, /compare, /analytics, /about), shots/cs-*.png.

## Stack fingerprint
- Next.js (App Router, prerender + `x-nextjs-cache: HIT`, stale-time 300s), behind Cloudflare.
- Separate backend at api.casasetu.com; `/api/image-proxy?url=` re-serves listing photos hot-linked from portals
  (img.staticmb.com = MagicBricks, images.nobroker.in, nestaway, rentmystay workers.dev).
- Bundles include Recharts (charts), PostHog (analytics/experiments/surveys), Mapbox (map/geo).
- Listing ids are UUIDs: /properties/{uuid}. Fields seen: source, lat, lng, locality, furnishing, bhk, facing, deposit,
  `hidden` (dedup/quality hidden), `dedup_per_session`.

## Information architecture
Nav: Homes (/) · PGs (/pgs) · Deals (/deals) · Compare (/compare) · Analytics (/analytics) · Activity (/activity) · Sign in (/auth) · About.
- Home: H1 "74,731 listings · Flats & PGs in Bangalore for Rent", subline "Deduped across NoBroker, MagicBricks and 8 more portals".
  Search bar + sort (Newest First). Left filter rail: City, BHK chips (1–7), price range slider (₹0–₹10L) + min/max,
  Furnishing, Parking, Area, Source, Facing, Advanced. Results "56,053 properties found (17,841 hidden)", 3-col cards, page numbers up to 3115.
- Card: photo carousel (1/7) with source badge + heart, ₹rent/month, Deposit, **Move-in cost** (rent+deposit), title, locality,
  BHK/sqft/bath chips, furnishing chip, tags (Non-Veg OK, Corporation water, Borewell), facing, floor, bike/car parking.
- Deals: "Handpicked properties priced 25–50% below expected market rate", locality + BHK filter.
- Compare: "Property Compare Assistant" — budget, max deposit, BHK, work locality, max distance km, max commute minutes,
  mode Bike/Car/Metro, furnished, parking → matched shortlist + avg rent + median match score; "Auto-pick top 2".
- Analytics: KPI tiles (total listings, avg rent, avg area, localities/geo sub-clusters), top localities bar, furnishing donut,
  price per sq.ft table, source comparison cards, locality breakdown table. Filters city/BHK/furnishing.
- About: 3 steps (search → analyze → redirect to source), zero brokerage.

## What it does well (replicate)
- One search across many portals, dedup with an honest "N hidden" count.
- Move-in cost surfaced on the card (rent + deposit) — the number renters actually care about.
- Commute-aware compare and a below-market "Deals" feed. Dense, scannable cards. Fast prerendered pages.

## Gaps / visible bugs (where we add depth)
- Data-quality bugs on Analytics: a locality literally named "From", min rent ₹1, furnishing value "11901", axis label "₹N/A",
  avg-rent bars that disagree with table. → needs normalization, outlier rejection (IQR/MAD), locality canonicalization + geo clustering.
- No map view on search; no saved searches/alerts; no price-history per listing; no "is this price fair" explanation on the card;
  deal score not explained; no PG-specific fields (sharing, food, gender) in compare; no mobile-first filter sheet.
- Visual: generic shadcn-ish light-green template; filters are a long accordion; no hierarchy between price and fairness.
- Hot-links portal images through a proxy (legal/ToS risk). Our build must NOT scrape or hot-link portals: use a synthetic but
  realistic Bangalore seed + a pluggable `SourceAdapter` interface for licensed feeds / owner-submitted listings.
