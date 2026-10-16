'use client';

import { formatINR, formatINRShort } from '@roofline/engine';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Chip } from '@/components/ui/Chip';
import { cn } from '@/components/ui/cn';
import { BADGE_LABEL, verdictToken, type BadgeName } from '@/lib/fairness';
import { SectionHead } from './SectionHead';

export type HowData = {
  merge: { localityName: string; bhk: number; areaSqft: number | null; rentInr: number; sourceRents: number[] } | null;
  priced: { localityName: string; bhk: number; rentInr: number; fairInr: number; lowInr: number; highInr: number; badge: BadgeName | null } | null;
  ranked: Array<{ id: string; localityName: string; label: string; rentInr: number; highlight: string; pct: number }>;
};

const DURATION = 6000;
const TABS = [
  { key: 'merged', title: 'Merged', blurb: 'The same flat, posted on several sites, becomes one listing.' },
  { key: 'priced', title: 'Priced', blurb: 'Each listing is set against comparable homes to get a fair rent.' },
  { key: 'ranked', title: 'Ranked', blurb: 'Listings priced furthest below fair rise to the top.' },
] as const;

/**
 * Three interactive tabs. The active one auto-advances every 6s (progress shown on the tab), pauses while the pointer
 * or keyboard focus is inside, and does not auto-advance at all under prefers-reduced-motion.
 */
export function HowItWorks({ data }: { data: HowData }) {
  const pref = useReducedMotion();
  // The preference is only known on the client; reading it before mount would make the first render differ from the server HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reduce = mounted && !!pref;
  const uid = useId();
  const [active, setActive] = useState(0);
  const paused = useRef(false);
  const elapsed = useRef(0);
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    elapsed.current = 0;
    bars.current.forEach((b) => b && (b.style.transform = 'scaleX(0)'));
    if (reduce) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (!paused.current) elapsed.current += now - last;
      last = now;
      const bar = bars.current[active];
      if (bar) bar.style.transform = `scaleX(${Math.min(1, elapsed.current / DURATION)})`;
      if (elapsed.current >= DURATION) {
        setActive((a) => (a + 1) % TABS.length);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduce]);

  function onKey(e: KeyboardEvent) {
    const move = (n: number) => {
      const i = (n + TABS.length) % TABS.length;
      setActive(i);
      tabs.current[i]?.focus();
    };
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(active + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(active - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(TABS.length - 1); }
  }

  return (
    <section aria-labelledby="how-title" className="bg-surface py-16 md:py-24">
      <div className="mx-auto max-w-[1320px] px-4 md:px-8">
        <SectionHead id="how-title" eyebrow="How it works" title="One listing, one fair price, one ranking" />
        <div
          className="grid gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-12"
          onMouseEnter={() => (paused.current = true)}
          onMouseLeave={() => (paused.current = false)}
          onFocus={() => (paused.current = true)}
          onBlur={() => (paused.current = false)}
        >
          <div role="tablist" aria-label="How Roofline works" aria-orientation="vertical" onKeyDown={onKey} className="grid grid-cols-3 gap-2 lg:grid-cols-1 lg:gap-3">
            {TABS.map((t, i) => {
              const on = i === active;
              return (
                <button
                  key={t.key}
                  ref={(el) => { tabs.current[i] = el; }}
                  id={`${uid}-tab-${t.key}`}
                  role="tab"
                  type="button"
                  aria-selected={on}
                  aria-controls={`${uid}-panel`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setActive(i)}
                  className={cn(
                    'relative overflow-hidden rounded-[16px] border p-3 text-left transition-[background-color,border-color,box-shadow] duration-200 lg:p-5',
                    on ? 'border-purple-100 bg-purple-50 shadow-card' : 'border-line bg-surface hover:border-ink-3',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={cn('type-display figures hidden h-8 w-8 shrink-0 place-items-center sm:grid rounded-full text-[15px] transition-colors', on ? 'bg-purple text-white' : 'bg-canvas text-ink-2')}
                    >
                      {i + 1}
                    </span>
                    <span className="type-display text-[16px] leading-6 text-ink sm:text-[18px] lg:text-[22px]">{t.title}</span>
                  </span>
                  <span className="mt-2 hidden pl-11 text-[15px] leading-6 text-ink-2 lg:block">{t.blurb}</span>
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-transparent">
                    <span
                      ref={(el) => { bars.current[i] = el; }}
                      className="block h-full origin-left bg-purple"
                      style={{ transform: 'scaleX(0)' }}
                    />
                  </span>
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`${uid}-panel`}
            aria-labelledby={`${uid}-tab-${TABS[active]!.key}`}
            data-testid="how-panel"
            data-tab={TABS[active]!.key}
            className="flex min-h-[360px] flex-col justify-center overflow-hidden rounded-[20px] border border-line bg-canvas p-5 md:p-8"
          >
            <p className="mb-5 text-[15px] leading-6 text-ink-2 lg:hidden">{TABS[active]!.blurb}</p>
            {active === 0 && <MergedPanel key="m" data={data.merge} reduce={!!reduce} />}
            {active === 1 && <PricedPanel key="p" data={data.priced} reduce={!!reduce} />}
            {active === 2 && <RankedPanel key="r" rows={data.ranked} reduce={!!reduce} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="grid h-full min-h-[280px] place-items-center text-center text-ink-3">{children}</p>;
}

function MergedPanel({ data, reduce }: { data: HowData['merge']; reduce: boolean }) {
  if (!data) return <Empty>No listing carried by three sources yet.</Empty>;
  const names = ['Source A', 'Source B', 'Source C'];
  const t = (delay: number) => ({ duration: reduce ? 0.01 : 0.45, delay: reduce ? 0 : delay, ease: 'easeOut' as const });
  return (
    <div className="grid items-center gap-5 md:grid-cols-[1fr_auto_1fr] md:gap-4">
      <div className="flex flex-col gap-2.5">
        {data.sourceRents.map((r, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: reduce ? 0 : -28 }}
            animate={{ opacity: 1, x: 0 }}
            transition={t(i * 0.14)}
            className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgb(20_26_51/0.05)]"
          >
            <span>
              <span className="type-label block text-[12px] uppercase tracking-wide text-ink-3">{names[i]}</span>
              <span className="block text-[14px] leading-5 text-ink-2">
                {data.bhk} BHK · {data.localityName}
              </span>
            </span>
            <span className="figures type-display text-[18px] text-ink">{formatINR(r)}</span>
          </motion.div>
        ))}
      </div>
      <motion.svg
        aria-hidden
        viewBox="0 0 64 120"
        className="mx-auto hidden h-28 w-14 md:block"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={t(0.5)}
      >
        {[18, 60, 102].map((y, i) => (
          <motion.path
            key={y}
            d={`M2 ${y} C32 ${y} 32 60 62 60`}
            fill="none"
            stroke="var(--color-purple)"
            strokeWidth={2}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={t(0.55 + i * 0.08)}
          />
        ))}
      </motion.svg>
      <motion.div
        initial={{ opacity: 0, scale: reduce ? 1 : 0.94, y: reduce ? 0 : 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={t(0.95)}
        className="rounded-[16px] border border-purple-100 bg-surface p-5 shadow-[var(--shadow-card-hover)]"
      >
        <Chip tone="purple" data-testid="merged-chip">Also on 3 sources</Chip>
        <p className="figures type-display mt-3 text-[32px] leading-9 text-ink">
          {formatINR(data.rentInr)}
          <span className="type-label ml-1 text-[14px] font-medium text-ink-3">/mo</span>
        </p>
        <p className="mt-1 text-[15px] leading-6 text-ink-2">
          {data.localityName} · {data.bhk} BHK{data.areaSqft ? ` · ${data.areaSqft.toLocaleString('en-IN')} sq ft` : ''}
        </p>
        <p className="mt-3 border-t border-line pt-3 text-[13px] leading-5 text-ink-3">
          Matched by location, size, rent and photos, then counted once. Real listing from the dataset.
        </p>
      </motion.div>
    </div>
  );
}

function PricedPanel({ data, reduce }: { data: HowData['priced']; reduce: boolean }) {
  if (!data) return <Empty>No priced listing to show yet.</Empty>;
  const { lowInr, highInr, fairInr, rentInr } = data;
  const lo = Math.min(lowInr, rentInr) * 0.94;
  const hi = Math.max(highInr, rentInr) * 1.06;
  const p = (r: number) => ((r - lo) / (hi - lo)) * 100;
  const colour = data.badge ? verdictToken(data.badge) : 'var(--color-fair)';
  const t = { duration: reduce ? 0.01 : 0.7, ease: [0.2, 0.8, 0.2, 1] as const };
  return (
    <div>
      <p className="text-[15px] leading-6 text-ink-2">
        A real {data.bhk} BHK in {data.localityName}, listed at <span className="figures font-semibold text-ink">{formatINR(rentInr)}</span>.
      </p>
      <div className="relative mx-2 mt-16 h-24 md:mx-6">
        <div className="absolute inset-x-0 top-9 h-1.5 rounded-full bg-line" />
        <motion.div
          className="absolute top-9 h-1.5 origin-left rounded-full bg-purple-100"
          style={{ left: `${p(lowInr)}%`, width: `${p(highInr) - p(lowInr)}%` }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={t}
        />
        {[
          { v: lowInr, label: 'P10', align: 'items-center' },
          { v: highInr, label: 'P90', align: 'items-center' },
        ].map((m) => (
          <div key={m.label} className="absolute top-[30px] -translate-x-1/2 text-center" style={{ left: `${p(m.v)}%` }}>
            <span className="mx-auto block h-3.5 w-0.5 bg-ink-3" />
            <span className="figures mt-2 block text-[12px] leading-4 text-ink-3">
              {m.label}
              <br />
              {formatINRShort(m.v)}
            </span>
          </div>
        ))}
        <div className="absolute top-[26px] -translate-x-1/2" style={{ left: `${p(fairInr)}%` }}>
          <span className="block h-[22px] w-[22px] rounded-full border-[3px] border-ink bg-surface" />
          <span className="type-label absolute left-1/2 top-9 -translate-x-1/2 whitespace-nowrap text-center text-[13px] leading-4 text-ink">
            Fair
            <br />
            <span className="figures font-normal text-ink-2">{formatINRShort(fairInr)}</span>
          </span>
        </div>
        <motion.div
          className="absolute top-0 -translate-x-1/2"
          initial={{ left: `${p(fairInr)}%`, opacity: reduce ? 0 : 1 }}
          animate={{ left: `${p(rentInr)}%`, opacity: 1 }}
          transition={{ ...t, delay: reduce ? 0 : 0.35 }}
        >
          <span className="figures type-label block -translate-y-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-center text-[12px] leading-4 text-white" style={{ background: colour }}>
            Listed {formatINRShort(rentInr)}
          </span>
          <span className="mx-auto mt-1 block h-[26px] w-[26px] translate-y-[2px] rounded-full border-[3px] border-surface bg-purple shadow-[0_2px_6px_rgb(20_26_51/0.3)]" />
        </motion.div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {data.badge && (
          <span className="type-label inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[14px]">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: colour }} />
            {BADGE_LABEL[data.badge]}
          </span>
        )}
        <p className="text-[14px] leading-5 text-ink-3">The line is the range comparable homes ask. The ring is the fair estimate.</p>
      </div>
    </div>
  );
}

function RankedPanel({ rows, reduce }: { rows: HowData['ranked']; reduce: boolean }) {
  if (rows.length === 0) return <Empty>No deals ranked yet.</Empty>;
  return (
    <ol className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <motion.li
          key={r.id}
          initial={{ opacity: 0, x: reduce ? 0 : 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: reduce ? 0.01 : 0.45, delay: reduce ? 0 : i * 0.12, ease: 'easeOut' }}
          className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-3 md:gap-4 md:px-4"
        >
          <span className="figures type-display grid h-8 w-8 shrink-0 place-items-center rounded-full bg-marigold text-[15px] text-ink">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold leading-5 text-ink">{r.localityName}</span>
            <span className="block truncate text-[13px] leading-5 text-ink-3">{r.label}</span>
          </span>
          <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-line sm:block" aria-hidden>
            <motion.span
              className="block h-full origin-left rounded-full bg-deal"
              style={{ width: `${Math.min(100, r.pct * 2)}%` }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: reduce ? 0.01 : 0.6, delay: reduce ? 0 : 0.3 + i * 0.12 }}
            />
          </span>
          <span className="text-right">
            <span className="figures type-display block text-[17px] leading-5 text-ink">{formatINR(r.rentInr)}</span>
            <span className="figures block text-[12px] font-semibold leading-4 text-deal">{r.highlight}</span>
          </span>
        </motion.li>
      ))}
    </ol>
  );
}
