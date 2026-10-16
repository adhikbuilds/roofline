import type { Metadata } from 'next';
import Link from 'next/link';
import { DealCard } from '@/components/browse/DealCard';
import { FilterChip } from '@/components/browse/FilterChip';
import { NavSelect } from '@/components/browse/NavSelect';
import { parseDealFilters } from '@/lib/deals-filters';
import { getDealLocalities, getDeals } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Deals' };

const BHKS = [1, 2, 3, 4] as const;

function href(locality: string | null, bhk: number | null): string {
  const q = new URLSearchParams();
  if (locality) q.set('locality', locality);
  if (bhk) q.set('bhk', String(bhk));
  const s = q.toString();
  return s ? `/deals?${s}` : '/deals';
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requested = parseDealFilters(await searchParams);
  const localities = await getDealLocalities();
  // A well-formed slug that is not a locality with deals is ignored like any other bad value.
  const locality = requested.locality && localities.some((x) => x.slug === requested.locality) ? requested.locality : null;
  const bhk = requested.bhk;
  const deals = await getDeals({ locality, bhk });
  const filtered = locality != null || bhk != null;

  return (
    <div className="pb-16">
      <header className="relative bg-[radial-gradient(60%_120%_at_85%_-10%,var(--color-marigold-50),transparent_60%),radial-gradient(40%_100%_at_0%_0%,var(--color-purple-100),transparent_55%)] bg-canvas">
        <div className="mx-auto max-w-[1320px] px-4 pb-8 pt-10 md:px-8 md:pb-10 md:pt-14">
          <p className="type-label text-[13px] uppercase tracking-[0.12em] text-purple">Ranked this week</p>
          <h1 className="type-display mt-2 text-[34px] leading-[38px] md:text-[48px] md:leading-[52px]">Deals</h1>
          <p className="figures mt-3 max-w-[62ch] text-[17px] leading-[26px] text-ink-2">
            Homes listed well under the fair rent for their locality, size and furnishing, ranked by how far under and how sure we are.
            These are estimates from comparable listings.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[1320px] px-4 md:px-8">
        <section
          aria-label="Filter deals"
          className="relative z-10 -mt-5 flex flex-col gap-4 rounded-[16px] border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-end sm:justify-between sm:p-5 md:-mt-6"
        >
          <div role="group" aria-label="Size" className="min-w-0">
            <p className="type-label mb-2 text-[12px] uppercase tracking-[0.08em] text-ink-3">Size</p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
              {BHKS.map((b) => (
                <FilterChip key={b} testId={`chip-bhk-${b}`} selected={bhk === b} href={href(locality, bhk === b ? null : b)}>
                  {b} BHK
                </FilterChip>
              ))}
            </div>
          </div>
          <NavSelect
            label="Locality"
            value={locality ?? ''}
            options={[{ value: '', label: 'All localities', href: href(null, bhk) }, ...localities.map((x) => ({ value: x.slug, label: x.name, href: href(x.slug, bhk) }))]}
          />
        </section>

        {filtered && (
          <div className="mt-4">
            <Link href="/deals" scroll={false} className="type-label inline-flex h-9 items-center text-[14px] text-ink-2 underline underline-offset-4 hover:text-ink">
              Clear filters
            </Link>
          </div>
        )}

        {deals.length === 0 ? (
          <section aria-labelledby="no-deals" data-testid="deals-empty" className="mt-8 rounded-[20px] border border-dashed border-line bg-surface p-6 md:p-10">
            <h2 id="no-deals" className="type-display text-[24px] leading-[30px]">
              {filtered ? 'No deals match these filters' : 'No deals right now'}
            </h2>
            <p className="mt-2 max-w-[60ch] text-ink-2">
              {filtered
                ? 'Nothing is listed at least 20% under its fair rent here. Try another locality or size.'
                : 'A deal needs a rent at least 20% under its fair estimate, enough comparable listings, a fresh listing and clean data. None qualify at the moment.'}
            </p>
            {filtered && (
              <Link href={href(null, null)} className="mt-3 inline-flex min-h-11 items-center font-medium text-purple underline underline-offset-4">
                Show all deals
              </Link>
            )}
          </section>
        ) : (
          <>
            <p data-testid="deals-count" className="figures type-display mt-6 text-[22px] leading-8">
              {deals.length} {deals.length === 1 ? 'deal' : 'deals'}<span className="text-ink-3">, best first</span>
            </p>
            <ol className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
              {deals.map((d, i) => (
                <DealCard key={d.id} deal={d} rank={i + 1} priority={i < 3} />
              ))}
            </ol>
          </>
        )}

        <details className="mt-10 max-w-[70ch] rounded-[16px] border border-line bg-surface p-5">
          <summary className="type-label min-h-11 cursor-pointer text-[16px] leading-[44px]">How deals are chosen</summary>
          <div className="space-y-2 pb-1 text-ink-2">
            <p>
              A listing counts as a deal when its rent is 20% or more below the estimated fair rent, and no more than 55% below.
              Rents far lower than that are held back for review, because they are more often errors than bargains.
            </p>
            <p>
              We also need medium or high confidence, clean data, at least three photos, a known area, and a listing seen in the last
              two weeks. Where one home appears on several sources, their rents must agree within 15%.
            </p>
            <p>The order combines how far under fair rent it is, our confidence, how fresh it is and how complete the listing is.</p>
          </div>
        </details>
        <p className="mt-8 text-[13px] leading-5 text-ink-3">
          Demo data: all listings, rents and photos on Roofline are synthetic and generated for this preview.
        </p>
      </div>
    </div>
  );
}
