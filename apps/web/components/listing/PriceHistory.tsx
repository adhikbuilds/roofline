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
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full max-w-[720px]">
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
