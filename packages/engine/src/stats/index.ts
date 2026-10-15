export { median, quantile, quantiles, mad, iqr } from './descriptive';
export { theilSenSlope } from './theil-sen';
export { weightedMedian } from './weighted';
export {
  LinalgError,
  cholesky,
  forwardSolve,
  backSolve,
  choleskySolve,
  solveSPD,
  quadFormInv,
  weightedGramSparse,
  weightedXtySparse,
} from './linalg';
export type { LinalgErrorCode } from './linalg';
