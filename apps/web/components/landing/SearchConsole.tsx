'use client';

import { ArrowRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatINR } from '@roofline/engine';
import { Combobox, RangeSlider, SegmentedControl, buttonClass } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { niceRent } from '@/components/ui/scale';
import { BHK_SEGMENTS, BUDGET_MAX, BUDGET_MIN, budgetLabel, consoleParams, type BhkSegment } from '@/lib/landing';

export type ConsoleLocality = { slug: string; name: string; median2bhkRent: number | null };


/**
 * The live search console. A real GET form to /homes (so it submits before hydration too); while the user changes
 * the filters, the button's count is refreshed from GET /api/v1/listings/count (200ms debounce, stale requests aborted).
 */
export function SearchConsole({
  localities,
  initialCount,
  testId,
  compact = false,
}: {
  localities: ConsoleLocality[];
  initialCount: number | null;
  testId: string;
  compact?: boolean;
}) {
  const [loc, setLoc] = useState<string | null>(null);
  const [bhk, setBhk] = useState<BhkSegment>('any');
  const [budget, setBudget] = useState<[number, number]>([BUDGET_MIN, BUDGET_MAX]);
  const [count, setCount] = useState<number | null>(initialCount);
  const [busy, setBusy] = useState(false);
  const first = useRef(true);

  const options = useMemo(
    () => localities.map((l) => ({ value: l.slug, label: l.name, meta: l.median2bhkRent ? `${formatINR(l.median2bhkRent, { short: true })} 2BHK` : undefined })),
    [localities],
  );
  const params = useMemo(() => consoleParams({ loc, bhk, budget }), [loc, bhk, budget]);
  const query = params.toString();

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (initialCount != null) return; // the server already counted the unfiltered set
    }
    const ctl = new AbortController();
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/listings/count${query ? `?${query}` : ''}`, { signal: ctl.signal });
        const body = (await res.json()) as { count?: number };
        setCount(res.ok && typeof body.count === 'number' ? body.count : null);
        setBusy(false);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setCount(null);
          setBusy(false);
        }
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query, initialCount]);

  return (
    <form
      method="get"
      action="/homes"
      data-testid={testId}
      className={cn(
        'rounded-[20px] border border-line bg-surface p-4 shadow-[var(--shadow-pop)] md:p-5',
        compact ? 'grid gap-4 lg:grid-cols-[1.15fr_1fr_1.1fr_auto] lg:items-end' : 'flex flex-col gap-4',
      )}
    >
      {loc && <input type="hidden" name="loc" value={loc} />}
      {bhk !== 'any' && <input type="hidden" name="bhk" value={bhk} />}
      {params.has('min') && <input type="hidden" name="min" value={params.get('min')!} />}
      {params.has('max') && <input type="hidden" name="max" value={params.get('max')!} />}

      <Combobox
        label="Locality"
        placeholder="Anywhere in Bangalore"
        options={options}
        value={loc}
        onChange={setLoc}
        emptyText="No locality matches that"
      />
      <div>
        <span className="type-label mb-2 block text-[13px] uppercase tracking-wide text-ink-3">
          BHK
        </span>
        <SegmentedControl label="BHK" segments={[...BHK_SEGMENTS]} value={bhk} onChange={setBhk} />
      </div>
      <RangeSlider
        label="Budget"
        min={BUDGET_MIN}
        max={BUDGET_MAX}
        log
        value={budget}
        onValueChange={setBudget}
        snap={niceRent}
        format={budgetLabel}
      />
      <button
        type="submit"
        data-testid={`${testId}-submit`}
        className={buttonClass('primary', 'lg', 'w-full gap-2.5')}
      >
        <span aria-hidden={false} className={cn('figures transition-opacity duration-150', busy && 'opacity-60')}>
          {count == null ? 'Search homes' : `Search ${count.toLocaleString('en-IN')} ${count === 1 ? 'home' : 'homes'}`}
        </span>
        <ArrowRight size={18} strokeWidth={1.75} aria-hidden />
      </button>
    </form>
  );
}
