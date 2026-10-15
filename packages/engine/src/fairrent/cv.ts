/** Deterministic 5-fold cross-validation of both fair-rent models, and the rule that picks the active one. */
import { median } from '../stats/descriptive';
import { fitHedonic, predictHedonic } from './hedonic';
import { fitRobustMedian, predictRobustMedian } from './robust-median';
import type { FitListing, FlatInput, ModelKind, Prediction } from './types';

/** FNV-1a (32-bit) over the UTF-8 bytes of `s`. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  const mix = (b: number): void => {
    h = Math.imul(h ^ b, 0x01000193) >>> 0;
  };
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) mix(c);
    else if (c < 0x800) {
      mix(0xc0 | (c >> 6));
      mix(0x80 | (c & 63));
    } else if (c < 0x10000) {
      mix(0xe0 | (c >> 12));
      mix(0x80 | ((c >> 6) & 63));
      mix(0x80 | (c & 63));
    } else {
      mix(0xf0 | (c >> 18));
      mix(0x80 | ((c >> 12) & 63));
      mix(0x80 | ((c >> 6) & 63));
      mix(0x80 | (c & 63));
    }
  }
  return h;
}

/** Fold of a listing id: fnv1a32(id) mod k. */
export function foldOf(id: string, k = 5): number {
  return fnv1a32(id) % k;
}

export interface CvResult {
  model: ModelKind;
  /** Held-out flats evaluated (identical set for both models). With n = 0 every metric is 0. */
  n: number;
  mdapeObs: number;
  coverageObs: number;
  mdapeObsBadged: number | null;
  nBadged: number;
  mdapeTruth?: number;
  coverageTruth?: number;
}

interface Pair {
  rent: number;
  truth: number | undefined;
  p: Prediction;
}

function summarise(model: ModelKind, pairs: readonly Pair[]): CvResult {
  const ape = (e: number, t: number): number => Math.abs(e - t) / t;
  const share = (xs: readonly boolean[]): number => (xs.length === 0 ? 0 : xs.filter(Boolean).length / xs.length);
  const badged = pairs.filter((q) => q.p.confidence !== 'low');
  const withTruth = pairs.filter((q): q is Pair & { truth: number } => q.truth !== undefined);
  const out: CvResult = {
    model,
    n: pairs.length,
    mdapeObs: median(pairs.map((q) => ape(q.p.expectedInr, q.rent))) ?? 0,
    coverageObs: share(pairs.map((q) => q.p.lowInr <= q.rent && q.rent <= q.p.highInr)),
    mdapeObsBadged: badged.length === 0 ? null : median(badged.map((q) => ape(q.p.expectedInr, q.rent))),
    nBadged: badged.length,
  };
  if (withTruth.length > 0) {
    out.mdapeTruth = median(withTruth.map((q) => ape(q.p.expectedInr, q.truth)))!;
    out.coverageTruth = share(withTruth.map((q) => q.p.lowInr <= q.truth && q.truth <= q.p.highInr));
  }
  return out;
}

/** Hedonic is active iff its observed MdAPE is strictly lower; ties go to robust_median. Truth never enters. */
export function chooseActive(v1: CvResult, v2: CvResult): ModelKind {
  return v2.mdapeObs < v1.mdapeObs ? 'hedonic' : 'robust_median';
}

/**
 * k-fold CV (default 5). Per fold both models are refit from scratch on the other folds and predict the
 * held-out flats out-of-sample; only flats both models can price are scored. `truth` (listing id -> true
 * expected rent) only adds the diagnostic mdapeTruth / coverageTruth fields.
 */
export function crossValidate(
  rows: readonly FitListing[],
  opts: { asOf: string; k?: number; truth?: ReadonlyMap<string, number> },
): { robustMedian: CvResult; hedonic: CvResult; active: ModelKind } {
  const k = opts.k ?? 5;
  if (!Number.isInteger(k) || k < 2) throw new RangeError('crossValidate: k must be an integer >= 2');
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rm: Pair[] = [];
  const hd: Pair[] = [];
  for (let fold = 0; fold < k; fold++) {
    const train = sorted.filter((r) => foldOf(r.id, k) !== fold);
    const test = sorted.filter((r): r is FlatInput => r.kind === 'flat' && foldOf(r.id, k) === fold);
    if (test.length === 0 || !train.some((r) => r.kind === 'flat')) continue;
    const a1 = fitRobustMedian(train, { asOf: opts.asOf });
    const a2 = fitHedonic(train, { asOf: opts.asOf, pg: a1.pg });
    const o = { inSample: false, modelRunId: 'cv' };
    for (const x of test) {
      const p1 = predictRobustMedian(a1, x, o);
      const p2 = predictHedonic(a2, x, o);
      if (!p1 || !p2) continue;
      const truth = opts.truth?.get(x.id);
      rm.push({ rent: x.rentInr, truth, p: p1 });
      hd.push({ rent: x.rentInr, truth, p: p2 });
    }
  }
  const robustMedian = summarise('robust_median', rm);
  const hedonic = summarise('hedonic', hd);
  return { robustMedian, hedonic, active: chooseActive(robustMedian, hedonic) };
}
