/** Stable reason codes (rejections). Never rename: they are persisted in quality_reasons. */
export const REASON_CODES = {
  RENT_TOO_LOW: 'RENT_TOO_LOW',
  RENT_TOO_HIGH: 'RENT_TOO_HIGH',
  AREA_IMPLAUSIBLE: 'AREA_IMPLAUSIBLE',
  PSF_IMPLAUSIBLE: 'PSF_IMPLAUSIBLE',
  GEO_INVALID: 'GEO_INVALID',
  LOCALITY_UNRESOLVED: 'LOCALITY_UNRESOLVED',
  RENT_OUTLIER_MAD: 'RENT_OUTLIER_MAD',
  RENT_OUTLIER_IQR: 'RENT_OUTLIER_IQR',
} as const;
export type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES];

/** Stable warning codes (row kept). */
export const WARNING_CODES = {
  AREA_MISSING: 'AREA_MISSING',
  LOCALITY_FROM_GEO: 'LOCALITY_FROM_GEO',
  BHK_AREA_MISMATCH: 'BHK_AREA_MISMATCH',
} as const;
export type WarningCode = (typeof WARNING_CODES)[keyof typeof WARNING_CODES];

export const QUALITY_BOUNDS = {
  flatRentMin: 1500,
  flatRentMax: 1_000_000,
  pgRentMin: 2000,
  pgRentMax: 60_000,
  areaMin: 120,
  areaMax: 15_000,
  psfMin: 5,
  psfMax: 300,
  /** Plausible sqft per BHK (index = bhk, 5 means 5+). Outside => BHK_AREA_MISMATCH. */
  bhkAreaMin: [120, 200, 350, 550, 800, 1000],
  bhkAreaMax: [900, 1800, 3000, 5000, 8000, 15_000],
} as const;

export const OUTLIER_PARAMS = {
  /** Minimum group size for the MAD test. */
  minCellN: 8,
  /** Minimum group size for the IQR fallback. */
  minIqrN: 4,
  madFloor: 0.1,
  zScale: 0.6745,
  zLow: -4.0,
  zHigh: 3.5,
  iqrK: 3,
  /** Default area elasticity of rent (seed truth uses 0.35). */
  epsilon: 0.35,
} as const;
