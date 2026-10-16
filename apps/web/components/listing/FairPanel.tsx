'use client';

import { motion, useReducedMotion } from 'motion/react';
import { Gauge, Info, ShieldQuestion } from 'lucide-react';
import { formatINR } from '@roofline/engine';
import { FairBadge } from '@/components/fair/FairnessRuler';
import { BADGE_LABEL, NOT_ENOUGH_COMPS_COPY, verdictToken, type FairInfo } from '@/lib/fairness';
import { bigRulerLayout, fairGap } from '@/lib/listing-detail';

const CONFIDENCE: Record<FairInfo['confidence'], string> = { high: 'High', medium: 'Medium', low: 'Low' };

/**
 * The "Is this rent fair?" panel: a headline gap, a full-width ruler (comparable range as the line, fair estimate as the
 * station, this rent as the marker that slides in), and the stored interval, confidence and explanation.
 * Everything shown was computed at ingest and read from the database; nothing is estimated here.
 */
export function FairPanel({ rentInr, fair }: { rentInr: number; fair: FairInfo | null }) {
  const reduce = useReducedMotion();
  const frame = 'min-w-0 rounded-[16px] border border-line bg-surface p-5 shadow-card md:p-7';

  if (!fair || !fair.badge) {
    return (
      <section aria-labelledby="fair-title" data-testid="fair-panel" className={frame}>
        <h2 id="fair-title" className="type-display text-[24px] leading-[30px]">Is this rent fair?</h2>
        <div data-testid="fair-unavailable" className="mt-4 flex items-start gap-3 rounded-[12px] bg-canvas p-4 text-ink-2">
          <ShieldQuestion size={22} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
          <p>
            <span className="font-semibold text-ink">{NOT_ENOUGH_COMPS_COPY}.</span> There are too few similar homes nearby
            to judge this rent, so we show no verdict.
          </p>
        </div>
      </section>
    );
  }

  const low = fair.lowInr ?? fair.fairInr;
  const high = fair.highInr ?? fair.fairInr;
  const g = bigRulerLayout({ rentInr, fairInr: fair.fairInr, lowInr: low, highInr: high });
  const gap = fairGap(rentInr, fair.fairInr);
  const color = verdictToken(fair.badge);
  const left = Math.min(g.rentPct, g.fairPct);
  const width = Math.abs(g.rentPct - g.fairPct);
  const headline =
    gap.side === 'at' ? 'Right at the fair estimate' : `${formatINR(gap.diffInr)} ${gap.side} the fair estimate`;

  return (
    <section aria-labelledby="fair-title" data-testid="fair-panel" className={frame}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="fair-title" className="type-display text-[24px] leading-[30px]">Is this rent fair?</h2>
        <FairBadge fair={fair} />
      </div>

      <p className="type-display figures mt-5 text-[30px] leading-[36px] md:text-[38px] md:leading-[44px]" style={{ color }} data-testid="fair-headline">
        {headline}
        {gap.side !== 'at' && gap.pct > 0 && <span className="ml-2 text-[18px] font-medium text-ink-3">({gap.pct}%)</span>}
      </p>
      <p className="mt-1 text-ink-2">{BADGE_LABEL[fair.badge]} for comparable homes in this locality.</p>

      {/* the ruler */}
      <div data-testid="fair-ruler" className="relative mx-1 mb-14 mt-12 h-3 md:mx-3" role="img" aria-label={`Rent ${formatINR(rentInr)} against a fair estimate of ${formatINR(fair.fairInr)} and a comparable range of ${formatINR(low)} to ${formatINR(high)}.`}>
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
        {/* comparable range */}
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-purple-100"
          style={{ left: `${g.lowPct}%`, width: `${Math.max(g.highPct - g.lowPct, 1)}%` }}
        />
        {/* gap segment in the verdict colour */}
        <motion.div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ left: `${left}%`, width: `${width}%`, background: color, transformOrigin: gap.side === 'below' ? 'left' : 'right' }}
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : 0.25, ease: 'easeOut' }}
        />
        {/* range ends */}
        {[
          { pct: g.lowPct, label: 'Low', value: low },
          { pct: g.highPct, label: 'High', value: high },
        ].map((t) => (
          <div key={t.label} className="absolute top-1/2 -translate-x-1/2" style={{ left: `${t.pct}%` }}>
            <span className="absolute left-1/2 top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple/50" aria-hidden />
            <span className="figures absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap text-center text-[12px] leading-4 text-ink-3">
              {t.label}
              <br />
              <span className="text-[13px] font-medium text-ink-2">{formatINR(t.value)}</span>
            </span>
          </div>
        ))}
        {/* fair station */}
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${g.fairPct}%` }}>
          <span className="block h-5 w-5 rounded-full border-[3px] border-ink bg-surface shadow-[0_2px_6px_rgb(20_26_51/0.2)]" />
          <span className="figures absolute left-1/2 top-[-34px] -translate-x-1/2 whitespace-nowrap text-[12px] font-medium text-ink-2">
            Fair {formatINR(fair.fairInr)}
          </span>
        </div>
        {/* this rent */}
        <motion.div
          className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${g.rentPct}%` }}
          initial={{ x: `${(g.fairPct - g.rentPct) * 3}px`, opacity: 1 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.55, ease: [0.2, 0.8, 0.2, 1] }}
          data-testid="fair-marker"
        >
          <span className="block h-6 w-6 rounded-full border-[3px] border-white bg-purple shadow-[0_0_0_3px_rgb(109_40_217/0.25),0_4px_10px_rgb(109_40_217/0.4)]" />
        </motion.div>
      </div>

      <dl className="figures grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-[12px] bg-canvas p-4">
          <dt className="flex items-center gap-1.5 text-[13px] text-ink-3">This listing</dt>
          <dd className="type-display mt-1 text-[22px] leading-7">{formatINR(rentInr)}</dd>
        </div>
        <div className="rounded-[12px] bg-canvas p-4">
          <dt className="text-[13px] text-ink-3">Fair estimate</dt>
          <dd className="type-display mt-1 text-[22px] leading-7">{formatINR(fair.fairInr)}</dd>
        </div>
        <div className="rounded-[12px] bg-canvas p-4">
          <dt className="text-[13px] text-ink-3">Comparable range</dt>
          <dd data-testid="fair-interval" className="type-display mt-1 text-[22px] leading-7">
            {fair.lowInr != null && fair.highInr != null ? `${formatINR(fair.lowInr)} to ${formatINR(fair.highInr)}` : 'Not available'}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
        <span className="type-label inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1 text-purple-600">
          <Gauge size={15} strokeWidth={1.75} aria-hidden />
          {CONFIDENCE[fair.confidence]} confidence
        </span>
        {fair.explanation && (
          <p data-testid="fair-explanation" className="min-w-0 basis-full text-ink-2 md:basis-auto md:flex-1">
            {fair.explanation}
          </p>
        )}
      </div>
      <p className="mt-3 flex items-start gap-2 text-[13px] text-ink-3">
        <Info size={15} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
        An estimate from comparable listings, not an appraisal.
      </p>
    </section>
  );
}
