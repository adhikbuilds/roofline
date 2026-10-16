import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { countHomes, getHomesPage, getLocalityName } from '@/lib/queries';
import { ActiveChip } from './FilterChip';
import { HomeCard } from './HomeCard';
import { InfiniteGrid, GRID_CLASS } from './InfiniteGrid';
import { ListingCardSkeleton } from '@/components/ui/Skeleton';
import {
  BHK_LABEL, BUDGETS, FURNISHING_LABEL, activeBudget, customBudgetLabel, filtersToQuery, homesHref, isFiltered, type HomesFilters,
} from './filters';
import { BADGE_LABEL } from '@/lib/fairness';

export function GridSkeleton() {
  return (
    <div data-testid="homes-skeleton" aria-busy="true">
      <div className="mb-5 h-8 w-48 skeleton rounded-[8px]" aria-hidden />
      <ul className={GRID_CLASS}>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="list-none">
            <ListingCardSkeleton />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Active filters as removable pills, each linking to the same filters minus that one value. */
function ActiveFilters({ f, locName }: { f: HomesFilters; locName: string | null }) {
  const out: { key: string; label: string; href: string }[] = [];
  if (f.loc) out.push({ key: 'loc', label: locName ?? f.loc, href: homesHref({ ...f, loc: null }) });
  for (const b of f.bhk) out.push({ key: `bhk-${b}`, label: BHK_LABEL[b], href: homesHref({ ...f, bhk: f.bhk.filter((x) => x !== b) }) });
  const preset = activeBudget(f);
  const budgetLabel = preset ? BUDGETS.find((b) => b.id === preset)!.label : customBudgetLabel(f);
  if (budgetLabel) out.push({ key: 'budget', label: budgetLabel, href: homesHref({ ...f, min: null, max: null }) });
  if (f.kind) out.push({ key: 'kind', label: f.kind === 'pg' ? 'PG beds' : 'Flats', href: homesHref({ ...f, kind: null }) });
  for (const x of f.furn) out.push({ key: `furn-${x}`, label: FURNISHING_LABEL[x], href: homesHref({ ...f, furn: f.furn.filter((y) => y !== x) }) });
  for (const x of f.verdict) out.push({ key: `v-${x}`, label: BADGE_LABEL[x], href: homesHref({ ...f, verdict: f.verdict.filter((y) => y !== x) }) });
  if (out.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {out.map((o) => (
        <ActiveChip key={o.key} href={o.href}>{o.label}</ActiveChip>
      ))}
      <Link
        href={homesHref({ ...f, loc: null, bhk: [], min: null, max: null, kind: null, furn: [], verdict: [] })}
        scroll={false}
        data-testid="clear-filters"
        className="type-label ml-1 inline-flex h-8 items-center rounded-full px-2 text-[13px] text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
      >
        Clear all
      </Link>
    </div>
  );
}

export async function HomesResults({ filters }: { filters: HomesFilters }) {
  const [total, page, locName] = await Promise.all([
    countHomes(filters),
    getHomesPage(filters),
    filters.loc ? getLocalityName(filters.loc) : Promise.resolve(null),
  ]);

  if (total == null) {
    return (
      <p data-testid="homes-unavailable" role="status" className="rounded-[16px] border border-line bg-surface p-6 text-ink-2">
        Listings are unavailable right now. Check that the database is running, then reload.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p data-testid="homes-count" aria-live="polite" className="figures type-display text-[22px] leading-8">
          {total.toLocaleString('en-IN')} {total === 1 ? 'home' : 'homes'}
          {locName ? <span className="text-ink-3"> in {locName}</span> : null}
        </p>
        <ActiveFilters f={filters} locName={locName} />
      </div>

      {page.rows.length === 0 ? (
        <section
          aria-labelledby="homes-empty"
          data-testid="homes-empty"
          className="grid place-items-center rounded-[20px] border border-dashed border-line bg-surface px-6 py-16 text-center"
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-purple-50 text-purple">
            <SearchX size={26} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 id="homes-empty" className="type-display mt-4 text-[24px] leading-[30px]">
            {isFiltered(filters) ? 'No homes match these filters' : 'No listings loaded yet'}
          </h2>
          <p className="mt-2 max-w-[48ch] text-ink-2">
            {isFiltered(filters)
              ? 'Try removing a filter or widening the budget.'
              : 'Load the synthetic Bangalore dataset with pnpm db:fresh, then reload this page.'}
          </p>
          {isFiltered(filters) && (
            <Link
              href="/homes"
              className="type-label mt-5 inline-flex h-11 items-center rounded-[12px] bg-purple px-5 text-[15px] text-white transition-colors hover:bg-purple-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
            >
              Clear all filters
            </Link>
          )}
        </section>
      ) : (
        <InfiniteGrid qs={filtersToQuery(filters)} initialCount={page.rows.length} total={total} initialCursor={page.nextCursor}>
          {page.rows.map((r, i) => (
            <HomeCard key={r.id} row={r} index={i} priority={i < 3} />
          ))}
        </InfiniteGrid>
      )}
    </div>
  );
}
