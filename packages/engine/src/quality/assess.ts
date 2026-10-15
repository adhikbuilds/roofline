import { buildBaseline, checkOutlier } from './outliers';
import type { Baseline, BaselineOptions } from './outliers';
import { hardRules } from './rules';
import type { Assessment, QualityRow } from './types';

/** Full per-row verdict. Hard rules short-circuit the statistical stage. */
export function assessRow(row: QualityRow, baseline?: Baseline): Assessment {
  const { reasons, warnings } = hardRules(row);
  if (reasons.length > 0) return { status: 'rejected', reasons, warnings };
  if (!baseline) return { status: 'accepted', reasons, warnings };
  const outlier = checkOutlier(baseline, row);
  if (outlier.rejected) {
    return { status: 'rejected', reasons: [outlier.code!], warnings, outlier };
  }
  return { status: 'accepted', reasons, warnings, outlier };
}

/**
 * Assess a batch. Baseline = prior accepted rows + this batch's hard-rule survivors,
 * so rejected junk never shifts the baseline.
 */
export function assessBatch(
  batch: readonly QualityRow[],
  priorAccepted: readonly QualityRow[] = [],
  opts: BaselineOptions = {},
): Assessment[] {
  if (batch.length === 0) return [];
  const survivors = batch.filter((r) => hardRules(r).reasons.length === 0);
  const baseline = buildBaseline([...priorAccepted, ...survivors], opts);
  return batch.map((r) => assessRow(r, baseline));
}
