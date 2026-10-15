/** Seed constants for the synthetic Bangalore market (PLAN section 4.4). Everything is fictional. */

export const SEED = 20261001;

/** 26 weekly runs, as_of 2026-04-09 -> 2026-10-01 (7-day steps). */
export const WEEKS = 26;
export const FIRST_AS_OF = Date.UTC(2026, 3, 9);
export const WEEK_MS = 7 * 24 * 3600 * 1000;
export const weekAsOf = (w: number): Date => new Date(FIRST_AS_OF + w * WEEK_MS);
export const weekIndexOf = (asOf: Date): number => Math.round((asOf.getTime() - FIRST_AS_OF) / WEEK_MS);

export const TARGET_UNITS = 6400;
export const PG_UNIT_SHARE = 1200 / 5350;
export const HARD_NEGATIVE_PAIRS = 150;
/** Share of units listed on 1, 2 or 3 sources. */
export const SOURCE_COUNT_WEIGHTS = [0.8, 0.16, 0.04] as const;

export const WEEKLY_NEW = 0.015;
export const WEEKLY_DELIST = 0.01;
export const WEEKLY_PRICE_CHANGE = 0.02;
export const DRIFT_PER_MONTH = 0.004;

export type SourceKey = 'tamarind' | 'banyan' | 'peepal' | 'jacaranda' | 'gulmohar';

/**
 * The plan's five fictional sources mapped onto the ids in packages/db/reference/sources.json
 * (priority order). `flatWeight`/`pgWeight` are the shares of rows of that kind.
 */
export const SOURCES: ReadonlyArray<{
  key: SourceKey;
  sourceId: string;
  prefix: string;
  flatWeight: number;
  pgWeight: number;
  rentSkew: number;
  depositMissing: number;
  geoMissing: number;
  /** Owner submissions: details live only in the free-text description. */
  freeTextOnly: boolean;
}> = [
  { key: 'tamarind', sourceId: 'nestlane', prefix: 'tm', flatWeight: 0.444, pgWeight: 0, rentSkew: 1, depositMissing: 0.08, geoMissing: 0.04, freeTextOnly: false },
  { key: 'banyan', sourceId: 'rentbarn', prefix: 'bn', flatWeight: 0.333, pgWeight: 0, rentSkew: 1, depositMissing: 0.25, geoMissing: 0.08, freeTextOnly: false },
  { key: 'peepal', sourceId: 'keyloft', prefix: 'pp', flatWeight: 0, pgWeight: 0.85, rentSkew: 1, depositMissing: 0.08, geoMissing: 0.05, freeTextOnly: false },
  { key: 'jacaranda', sourceId: 'doorvale', prefix: 'jc', flatWeight: 0.167, pgWeight: 0.15, rentSkew: 1.06, depositMissing: 0.08, geoMissing: 0.03, freeTextOnly: false },
  { key: 'gulmohar', sourceId: 'hearthgrid', prefix: 'gm', flatWeight: 0.056, pgWeight: 0, rentSkew: 1, depositMissing: 0.08, geoMissing: 0.25, freeTextOnly: true },
];

export const BHK_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.04], [1, 0.18], [2, 0.38], [3, 0.28], [4, 0.09], [5, 0.03],
];
export const BHK_MULT: Record<number, number> = { 0: 0.42, 1: 0.6, 2: 1, 3: 1.45, 4: 2, 5: 2.6 };
export const TYP_AREA: Record<number, number> = { 0: 350, 1: 600, 2: 1100, 3: 1550, 4: 2300, 5: 3200 };
export const FURN_MULT = { unfurnished: 0.9, semi: 1, furnished: 1.18 } as const;
export const FURN_WEIGHTS: ReadonlyArray<readonly [keyof typeof FURN_MULT, number]> = [
  ['unfurnished', 0.3], ['semi', 0.45], ['furnished', 0.25],
];
export const AREA_EXPONENT = 0.35;
export const AREA_SD = 0.12;
export const BUILDING_SD = 0.06;
export const NOISE_SD = 0.1;
/** Natural noise is truncated at this many sigmas so only planted rows are statistical outliers. */
export const NOISE_CLIP = 2;

export const PG_BASE_SINGLE: Record<string, number> = {
  central: 17000, east: 14000, south_east: 14000, south: 12000, west: 11000, north: 12000, north_east: 12000,
};
export const PG_SHARING = [
  ['single', 1.0], ['double', 0.68], ['triple', 0.55], ['quad', 0.48],
] as const;
export const PG_GENDER_WEIGHTS: ReadonlyArray<readonly ['male' | 'female' | 'coed', number]> = [
  ['male', 0.45], ['female', 0.35], ['coed', 0.2],
];
export const PG_FOOD_SHARE = 0.7;
export const PG_FOOD_INR = 2000;

export const DEPOSIT_MONTHS: ReadonlyArray<readonly [number, number]> = [
  [2, 0.15], [3, 0.25], [5, 0.25], [6, 0.2], [10, 0.15],
];

/** Planted defect rows: label -> exact count (all in the week-0 cohort). */
export const DEFECT_COUNTS = {
  rent_one: 30,
  rent_annual: 20,
  rent_lakh: 15,
  locality_from_nogeo: 25,
  locality_from_geo: 15,
  locality_bangalore_nogeo: 9,
  locality_bangalore_geo: 6,
  empty_locality_geo: 20,
  furnishing_invalid: 25,
  area_zero: 8,
  area_huge: 7,
  geo_zero: 10,
  hard_negative: HARD_NEGATIVE_PAIRS,
} as const;
export type DefectKind = keyof typeof DEFECT_COUNTS | 'too_good';

/** Expected pipeline outcome per defect; the eval reads planted rejects from this map. */
export const DEFECT_OUTCOME: Record<DefectKind, 'rejected' | 'repaired' | 'accepted_flagged' | 'accepted'> = {
  rent_one: 'rejected',
  rent_annual: 'repaired',
  rent_lakh: 'repaired',
  locality_from_nogeo: 'rejected',
  locality_from_geo: 'accepted_flagged',
  locality_bangalore_nogeo: 'rejected',
  locality_bangalore_geo: 'accepted_flagged',
  empty_locality_geo: 'accepted_flagged',
  furnishing_invalid: 'accepted_flagged',
  area_zero: 'accepted_flagged',
  area_huge: 'rejected',
  geo_zero: 'accepted',
  hard_negative: 'accepted',
  too_good: 'rejected',
};
export const PLANTED_REJECT_DEFECTS = (Object.keys(DEFECT_OUTCOME) as DefectKind[]).filter(
  (d) => DEFECT_OUTCOME[d] === 'rejected',
);

export const DEAL_SHARE = 0.02;
export const DEAL_MULT: readonly [number, number] = [0.6, 0.78];
export const TOO_GOOD_COUNT = 10;
export const TOO_GOOD_MULT = 0.3;
