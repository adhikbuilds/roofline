export { ENGINE_VERSION } from './version';
export { createTrace, formatTrace } from './trace';
export type { Trace, TraceStep, TraceBuilder } from './trace';
export { readFlags } from './flags';
export type { Flag, Flags, EnvLike, DataMode, CommuteProvider } from './flags';
export { formatINR, formatINRShort } from './money';
export type { FormatINROptions } from './money';
export {
  haversineKm,
  geohashEncode,
  geohashDecode,
  geohashNeighbors,
  BANGALORE_BBOX,
  bboxContains,
  bboxExpand,
} from './geo';
export type { LatLng, BBox } from './geo';
export { median, quantile, quantiles, mad, iqr, theilSenSlope, weightedMedian } from './stats';
export * from './normalize';
export * from './locality';
export {
  REASON_CODES,
  WARNING_CODES,
  QUALITY_BOUNDS,
  OUTLIER_PARAMS,
  hardRules,
  hasValidGeo,
  buildBaseline,
  checkOutlier,
  assessRow,
  assessBatch,
} from './quality';
export type {
  ReasonCode,
  WarningCode,
  Baseline,
  BaselineOptions,
  QualityRow,
  RuleResult,
  OutlierResult,
  OutlierLevel,
  Assessment,
} from './quality';
export * from './dedup';
export { BADGE_EDGES, deltaOf, storedDelta, badgeFor } from './fairrent/badge';
export {
  NOT_ENOUGH_COMPS,
  formatBhk,
  formatCount,
  formatArea,
  pctHalfAway,
  explainRobustMedian,
  explainHedonic,
  explain,
} from './fairrent/explain';
export type { ExplainNames } from './fairrent/explain';
export * from './deals';
export type {
  Furnishing as FairRentFurnishing,
  Zone,
  Confidence,
  Badge,
  ModelKind,
  Downgrade,
  FlatInput,
  PgInput,
  FitListing,
  EstimateBasis,
  Prediction,
  FairRentEstimate,
  PredictOptions,
  ArtifactHeader,
  CommonConstants,
  CellJson,
  FactorMethod,
  PgSubmodel,
  RobustMedianConstants,
  EpsilonEntry,
  FurnishingEntry,
  RobustMedianArtifact,
} from './fairrent/types';
export {
  SHRINK_K,
  DEFAULT_CONSTANTS as ROBUST_MEDIAN_DEFAULTS,
  shrinkWeight,
  looMedian,
  looMad,
  shrinkChain,
  selectBasis,
  areaEpsilon,
  furnishingFactors,
  fitPgSubmodel,
  predictPg,
  fitRobustMedian,
  predictRobustMedian,
  confidenceFor,
  intervalFor,
} from './fairrent/robust-median';
export {
  HEDONIC_DEFAULTS,
  buildDesign,
  irlsHuber,
  looPrediction,
  fitHedonic,
  predictHedonic,
} from './fairrent/hedonic';
export type { Design, SparseRow, IrlsOptions, IrlsResult } from './fairrent/hedonic';
export { fnv1a32, foldOf, crossValidate, chooseActive } from './fairrent/cv';
export type { CvResult } from './fairrent/cv';
export { ARTIFACT_SCHEMA, ARTIFACT_SCHEMA_VERSION, ArtifactError, parseArtifact } from './fairrent/artifact';
export type {
  HedonicConstants,
  HedonicArtifact,
  FairRentArtifact,
} from './fairrent/types';
