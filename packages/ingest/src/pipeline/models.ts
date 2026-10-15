/** The real engine wired into stage 6. Kept separate so tests inject fakes and this is the only engine-model import. */
import {
  crossValidate, fitHedonic, fitRobustMedian, predictHedonic, predictRobustMedian,
} from '@roofline/engine';
import type { ArtifactLike, Models } from './fairrent';

export function engineModels(): Models {
  return {
    crossValidate: (rows, opts) => crossValidate(rows, opts),
    fitRobustMedian: (rows, opts) => fitRobustMedian(rows, opts) as unknown as ArtifactLike,
    fitHedonic: (rows, opts) => fitHedonic(rows, opts) as unknown as ArtifactLike,
    predict: (a, x, o) => (a.kind === 'hedonic' ? predictHedonic(a as never, x, o) : predictRobustMedian(a as never, x, o)),
  };
}
