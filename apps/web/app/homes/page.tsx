import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HomesToolbar } from '@/components/browse/HomesToolbar';
import { GridSkeleton, HomesResults } from '@/components/browse/HomesResults';
import { filtersToQuery, parseHomesFilters } from '@/components/browse/filters';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Homes' };

export default async function HomesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseHomesFilters(await searchParams);
  const key = filtersToQuery(filters);
  return (
    <div className="pb-16">
      <header className="relative bg-[radial-gradient(60%_120%_at_85%_-10%,var(--color-purple-100),transparent_60%),radial-gradient(40%_100%_at_0%_0%,#e0f2fe,transparent_55%)] bg-canvas">
        <div className="mx-auto max-w-[1320px] px-4 pb-8 pt-10 md:px-8 md:pb-10 md:pt-14">
          <p className="type-label text-[13px] uppercase tracking-[0.12em] text-purple">Browse</p>
          <h1 className="type-display mt-2 text-[34px] leading-[38px] md:text-[48px] md:leading-[52px]">Homes in Bangalore</h1>
          <p className="mt-3 max-w-[60ch] text-[17px] leading-[26px] text-ink-2">
            Every home is counted once, even when it appears on several sources, and each rent is set against the estimated fair rent for similar homes.
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-[1320px] px-4 md:px-8">
        <div className="relative z-10 -mt-5 md:-mt-6">
          <HomesToolbar filters={filters} />
        </div>
        <div className="mt-8">
          <Suspense key={key} fallback={<GridSkeleton />}>
            <HomesResults filters={filters} />
          </Suspense>
        </div>
        <p className="mt-10 text-[13px] leading-5 text-ink-3">
          Demo data: all listings, rents and photos on Roofline are synthetic and generated for this preview.
        </p>
      </div>
    </div>
  );
}
