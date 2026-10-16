import { formatINR } from '@roofline/engine';
import { buildStepChart, type HistoryPoint } from '@/lib/listing-detail';

const W = 560;
const H = 160;
const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const day = (iso: string) => fmt.format(new Date(iso));

/** Price history as an inline SVG step chart. The rent holds until the next observation, then steps. */
export function PriceHistory({ history }: { history: HistoryPoint[] }) {
  const chart = buildStepChart(history, W, H);
  if (!chart) return <p className="text-indigo-2">No price history recorded yet.</p>;
  const first = history[0]!;
  // One observation is a fact, not a trend: say it plainly instead of drawing a lone dot.
  if (history.length === 1) {
    return (
      <p data-testid="history-unchanged" className="figures text-[17px] leading-[26px]">
        {formatINR(first.rentInr)} a month since {day(first.at)}.{' '}
        <span className="text-indigo-2">The rent hasn’t changed since it was first listed.</span>
      </p>
    );
  }
  const last = history[history.length - 1]!;
  const label =
    history.length === 1
      ? `Price history: ${formatINR(first.rentInr)} a month, first seen ${day(first.at)}, no changes since.`
      : `Price history: ${formatINR(first.rentInr)} a month on ${day(first.at)}, ${formatINR(last.rentInr)} on ${day(last.at)}, ${history.length} observations.`;
  return (
    <figure>
      <div className="figures mb-3 flex flex-wrap items-center gap-2">
        <span className="type-display text-[26px] leading-8">{formatINR(last.rentInr)}</span>
        {last.rentInr !== first.rentInr && (
          <span
            data-testid="history-change"
            className={`type-label rounded-full px-2.5 py-0.5 text-[13px] ${last.rentInr < first.rentInr ? 'bg-[#e8f6f0] text-deal' : 'bg-marigold-50 text-above-text'}`}
          >
            {last.rentInr < first.rentInr ? 'Down' : 'Up'} {Math.round((Math.abs(last.rentInr - first.rentInr) / first.rentInr) * 100)}% since {day(first.at)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        <defs>
          <linearGradient id="ph-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-purple)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-purple)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} stroke="var(--color-line)" strokeDasharray="3 5" strokeWidth="1" />
        ))}
        <path d={`${chart.path} V${H - 1} H${chart.points[0]!.x} Z`} fill="url(#ph-fill)" />
        <line x1="0" y1={H - 1} x2={W} y2={H - 1} stroke="var(--color-line)" strokeWidth="1" />
        <path d={chart.path} fill="none" stroke="var(--color-purple)" strokeWidth="2.5" strokeLinejoin="round" />
        {chart.points.map((p) => (
          <circle
            key={p.at}
            data-testid="history-point"
            cx={p.x}
            cy={p.y}
            r="4.5"
            fill="var(--color-surface)"
            stroke="var(--color-indigo)"
            strokeWidth="2"
          >
            <title>{`${formatINR(p.rentInr)} on ${day(p.at)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="figures mt-2 text-[14px] text-indigo-2">
        {history.length === 1
          ? `${formatINR(first.rentInr)} a month since ${day(first.at)}.`
          : `${formatINR(chart.minInr)} to ${formatINR(chart.maxInr)} a month, ${day(first.at)} to ${day(last.at)}.`}
      </figcaption>
      <ol className="sr-only">
        {history.map((h) => (
          <li key={h.at}>{`${day(h.at)}: ${formatINR(h.rentInr)} a month`}</li>
        ))}
      </ol>
    </figure>
  );
}
