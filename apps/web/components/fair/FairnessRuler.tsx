import { formatINR } from '@roofline/engine';
import { BADGE_LABEL, RULER_WIDTH, rulerGeometry, verdictToken, type FairInfo } from '@/lib/fairness';

/**
 * The signature element: a 132px "metro line". The comparable-rent interval is the line, the fair estimate is a
 * station dot, the listing is the purple marker, and the segment between them takes the verdict colour.
 * Values come from the database (computed at ingest); this component only draws them.
 */
export function FairnessRuler({ rentInr, fair, labels = false }: { rentInr: number; fair: FairInfo; labels?: boolean }) {
  if (fair.badge == null) return null;
  const low = fair.lowInr ?? fair.fairInr;
  const high = fair.highInr ?? fair.fairInr;
  const g = rulerGeometry({ rentInr, fairInr: fair.fairInr, lowInr: low, highInr: high });
  const verdict = verdictToken(fair.badge);
  const diff = Math.abs(rentInr - fair.fairInr);
  const side = rentInr < fair.fairInr ? 'below' : rentInr > fair.fairInr ? 'above' : 'at';
  const label =
    side === 'at'
      ? `Rent is at the fair estimate of ${formatINR(fair.fairInr)}`
      : `Rent is ${formatINR(diff)} ${side} the fair estimate of ${formatINR(fair.fairInr)}. Comparable listings range ${formatINR(low)} to ${formatINR(high)}.`;
  const slide = Math.round((g.stationX - g.markerX) * 10) / 10;
  return (
    <div data-testid="fairness-ruler" data-badge={fair.badge} className="w-[132px] max-w-full">
      <svg
        viewBox={`0 0 ${RULER_WIDTH} 18`}
        width={RULER_WIDTH}
        height={18}
        role="img"
        aria-label={label}
        className="block overflow-visible"
      >
        <line x1={g.lineX1} y1={9} x2={g.lineX2} y2={9} stroke="var(--color-line)" strokeWidth={4} strokeLinecap="round" />
        <line x1={g.markerX} y1={9} x2={g.stationX} y2={9} stroke={verdict} strokeWidth={4} strokeLinecap="round" />
        <circle cx={g.stationX} cy={9} r={5} fill="var(--color-surface)" stroke="var(--color-indigo)" strokeWidth={2} />
        <circle
          cx={g.markerX}
          cy={9}
          r={5}
          fill="var(--color-purple)"
          className="ruler-marker"
          style={{ ['--slide' as string]: `${slide}px` }}
        />
      </svg>
      {labels && (
        <div className="figures mt-1 flex justify-between text-[12px] leading-4 text-indigo-2">
          <span>{formatINR(low)}</span>
          <span>{formatINR(high)}</span>
        </div>
      )}
    </div>
  );
}

export function FairBadge({ fair }: { fair: FairInfo }) {
  if (fair.badge == null) return null;
  return (
    <span
      data-testid="fair-badge"
      className="type-label inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[13px]"
    >
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: verdictToken(fair.badge) }} />
      {BADGE_LABEL[fair.badge]}
    </span>
  );
}
