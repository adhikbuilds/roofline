import type { Trace } from '../trace';

export type Furnishing = 'furnished' | 'semi' | 'unfurnished';
export type Zone = 'central' | 'east' | 'south_east' | 'south' | 'west' | 'north' | 'north_east';
export type Confidence = 'high' | 'medium' | 'low';
export type Badge = 'great_deal' | 'good_price' | 'fair' | 'above_market' | 'overpriced';
export type ModelKind = 'robust_median' | 'hedonic';
export type Downgrade = 'area_missing' | 'furnishing_missing' | 'food_missing';

export interface FlatInput {
  kind: 'flat';
  id: string;
  localityId: number;
  zone: Zone;
  unitKind: 'rk' | 'studio' | 'bhk';
  bhk: number;
  furnishing: Furnishing | null;
  areaSqft: number | null;
  rentInr: number;
  parking: 'bike' | 'car' | 'both' | 'none' | null;
  tags: readonly string[];
  floor: number | null;
  totalFloors: number | null;
}

export interface PgInput {
  kind: 'pg';
  id: string;
  localityId: number;
  zone: Zone;
  sharing: 'single' | 'double' | 'triple' | 'quad' | null;
  food: boolean | null;
  rentInr: number;
}

export type FitListing = FlatInput | PgInput;

export interface EstimateBasis {
  model: ModelKind;
  level: 'L1' | 'L2' | 'L3' | 'L4' | 'P1' | 'P2' | 'P3' | 'hedonic';
  n: number;
  nEff: number;
  madLog: number;
  epsilon: number | null;
  areaAdjusted: boolean;
  loo: boolean;
  downgrades: Downgrade[];
  modelRunId: string;
  engineVersion: string;
  context?: { l1MedianRentInr: number; l1N: number };
}

export interface Prediction {
  expectedInr: number;
  lowInr: number;
  highInr: number;
  confidence: Confidence;
  basis: EstimateBasis;
  trace: Trace;
}

export interface FairRentEstimate extends Prediction {
  listingId: string;
  delta: number;
  deltaStored: number;
  badge: Badge | null;
  explanation: string;
}

export interface PredictOptions {
  inSample: boolean;
  modelRunId: string;
}

// ---- artifact shapes shared by both models (JSON-serialisable) ----

export interface ArtifactHeader {
  schema: 'roofline.fairrent';
  schemaVersion: 1;
  kind: ModelKind;
  engineVersion: string;
  asOf: string;
  /** Sorted listing ids (in-sample test). */
  fitIds: string[];
  counts: { flats: number; pg: number };
}

/** Tunable numeric constants shared by both models (widened from the design's literal types). */
export interface CommonConstants {
  shrinkK: number;
  basisMinN: number;
  looMaxN: number;
  madScale: number;
  madFloor: number;
  confidence: { highN: number; highMad: number; mediumN: number };
}

/** `ys` is sorted and present iff n < looMaxN. */
export interface CellJson {
  n: number;
  median: number;
  mad: number;
  ys?: number[];
}

export type FactorMethod = 'paired' | 'city' | 'none';

export interface PgSubmodel {
  foodLog: Record<string, { value: number; method: FactorMethod }>;
  cells: {
    p1: Record<string, CellJson>;
    p2: Record<string, CellJson>;
    p3: Record<string, CellJson>;
  };
}

export interface RobustMedianConstants extends CommonConstants {
  epsClamp: [number, number];
  epsDefault: number;
  tsMaxN: number;
  furnPairMinN: number;
  furnMinLocalities: number;
}

export interface EpsilonEntry {
  value: number;
  raw: number | null;
  n: number;
  source: 'bhk' | 'pooled' | 'default';
}

export interface FurnishingEntry {
  furnished: number;
  unfurnished: number;
  method: FactorMethod;
}

export interface RobustMedianArtifact extends ArtifactHeader {
  kind: 'robust_median';
  constants: RobustMedianConstants;
  flat: {
    refArea: Record<string, number>;
    epsilon: Record<string, EpsilonEntry>;
    furnishingLog: Record<string, FurnishingEntry>;
    cells: {
      l1: Record<string, CellJson>;
      l2: Record<string, CellJson>;
      l3: Record<string, CellJson>;
      l4: Record<string, CellJson>;
    };
  };
  pg: PgSubmodel;
}

export interface HedonicConstants extends CommonConstants {
  lambda: number;
  huberK: number;
  tol: number;
  maxIter: number;
  zoneRef: 'central';
}

export interface HedonicArtifact extends ArtifactHeader {
  kind: 'hedonic';
  constants: HedonicConstants;
  /** Stable order, e.g. "zone:east", "loc:17", "bhk:3", "furn:furnished". */
  columns: string[];
  penalized: boolean[];
  droppedColumns: string[];
  beta: number[];
  /** Row-major lower Cholesky factor of X'WX + L (p x p), for exact leave-one-out. */
  cholL: number[];
  /** Final Huber scale s. */
  huberScale: number;
  refArea: Record<string, number>;
  irls: { iterations: number; converged: boolean };
  residualMad: {
    locBhk: Record<string, { n: number; mad: number }>;
    zoneBhk: Record<string, { n: number; mad: number }>;
    global: number;
  };
  context: { l1: Record<string, { n: number; medianRent: number; rents?: number[] }> };
  pg: PgSubmodel;
}

export type FairRentArtifact = RobustMedianArtifact | HedonicArtifact;
