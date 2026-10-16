'use client';

import { Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ListingCardSkeleton } from '@/components/ui/Skeleton';
import { loadMoreHomes } from '@/app/homes/actions';

export const GRID_CLASS = 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6';

/**
 * The first page arrives server-rendered as `children`; "Load more" asks a server action for the next
 * page of cards (rendered on the server too) and appends them. Keyed by the filter query string, so
 * changing a filter remounts this and drops the appended pages.
 */
export function InfiniteGrid({
  qs,
  children,
  initialCount,
  total,
  initialCursor,
}: {
  qs: string;
  children: ReactNode;
  initialCount: number;
  total: number;
  initialCursor: string | null;
}) {
  const [extra, setExtra] = useState<ReactNode[]>([]);
  const [count, setCount] = useState(initialCount);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await loadMoreHomes(qs, cursor);
      setExtra((e) => [...e, ...res.items]);
      setCount((c) => c + res.added);
      setCursor(res.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <ul data-testid="homes-grid" className={GRID_CLASS}>
        {children}
        {extra}
        {loading && [0, 1, 2].map((i) => <li key={`sk-${i}`} className="list-none"><ListingCardSkeleton /></li>)}
      </ul>
      <div className="mt-10 flex flex-col items-center gap-3 pb-4">
        <p data-testid="homes-progress" aria-live="polite" className="figures text-[14px] text-ink-3">
          Showing {count.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
        </p>
        {failed && (
          <p role="alert" className="text-[14px] text-over">
            Could not load more homes. Try again.
          </p>
        )}
        {cursor ? (
          <button
            type="button"
            onClick={more}
            disabled={loading}
            data-testid="load-more"
            className="type-label inline-flex h-12 min-w-[200px] items-center justify-center gap-2 rounded-[12px] border border-ink bg-surface px-6 text-[15px] text-ink shadow-[0_1px_2px_rgb(20_26_51/0.06)] transition-[background-color,color,transform] duration-150 hover:bg-ink hover:text-white active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple motion-reduce:transition-none"
          >
            {loading && <Loader2 size={18} strokeWidth={1.75} aria-hidden className="animate-spin motion-reduce:animate-none" />}
            {loading ? 'Loading homes' : 'Load more homes'}
          </button>
        ) : (
          count > 0 && <p className="text-[14px] text-ink-2">That is every home matching these filters.</p>
        )}
      </div>
    </>
  );
}
