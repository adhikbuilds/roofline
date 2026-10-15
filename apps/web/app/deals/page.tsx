import type { Metadata } from 'next';
import Link from 'next/link';
import { formatINR } from '@roofline/engine';
import { FairBadge, FairnessRuler } from '@/components/fair/FairnessRuler';
import { parseDealFilters } from '@/lib/deals-filters';
import { splitReason } from '@/lib/fairness';
import { getDealLocalities, getDeals, type DealRow } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Deals' };

const BHKS = [1, 2, 3, 4] as const;

function kindLabel(unitKind: string, bhk: number | null): string {
  if (unitKind === 'pg_bed') return 'PG bed';
  if (unitKind === 'studio') return 'Studio';
  if (unitKind === 'rk') return '1 RK';
  return bhk ? `${bhk} BHK` : 'Home';
}

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
    <div className="mx-auto max-w-[1320px] px-4 pt-8 md:px-8 md:pt-12">
      <h1 className="type-display text-[34px] leading-[38px] md:text-[52px] md:leading-[56px]">Deals</h1>
      <p className="figures mt-4 max-w-[62ch] text-[17px] leading-[26px] text-indigo-2">
        Homes listed well under the fair rent for their locality, size and furnishing, ranked by how far under and how sure we are.
        These are estimates from comparable listings.
      </p>

      <form method="get" action="/deals" aria-label="Filter deals" className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="type-label text-[14px] text-indigo-2">Locality</span>
          <select
            name="locality"
            defaultValue={locality ?? ''}
            className="min-h-11 rounded-[var(--radius-input)] border border-line bg-surface px-3 text-indigo"
          >
            <option value="">All localities</option>
            {localities.map((x) => (
              <option key={x.slug} value={x.slug}>{x.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="type-label text-[14px] text-indigo-2">Size</span>
          <select
            name="bhk"
            defaultValue={bhk ?? ''}
            className="min-h-11 rounded-[var(--radius-input)] border border-line bg-surface px-3 text-indigo"
          >
            <option value="">Any BHK</option>
            {BHKS.map((b) => (
              <option key={b} value={b}>{b} BHK</option>
            ))}
          </select>
        </label>
        <button type="submit" className="type-label min-h-11 rounded-full bg-purple px-5 text-[15px] text-white">
          Apply filters
        </button>
        {filtered && (
          <Link href="/deals" className="inline-flex min-h-11 items-center font-medium text-purple underline underline-offset-4">
            Clear filters
          </Link>
        )}
      </form>

      {deals.length === 0 ? (
        <section aria-labelledby="no-deals" data-testid="deals-empty" className="mt-8 rounded-[var(--radius-panel)] border border-line bg-surface p-6 md:p-10">
          <h2 id="no-deals" className="type-display text-[24px] leading-[30px]">
            {filtered ? 'No deals match these filters' : 'No deals right now'}
          </h2>
          <p className="mt-2 max-w-[60ch] text-indigo-2">
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
          <p data-testid="deals-count" className="figures mt-6 text-indigo-2">
            {deals.length} {deals.length === 1 ? 'deal' : 'deals'}, best first
          </p>
          <ol className="mt-3 flex flex-col gap-2">
            {deals.map((d, i) => (
              <DealItem key={d.id} d={d} rank={i + 1} />
            ))}
          </ol>
        </>
      )}

      <details className="mt-8 max-w-[70ch] rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <summary className="type-label min-h-11 cursor-pointer text-[16px] leading-[44px]">How deals are chosen</summary>
        <div className="space-y-2 pb-1 text-indigo-2">
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
    </div>
  );
}

function DealItem({ d, rank }: { d: DealRow; rank: number }) {
  const { highlight, rest } = splitReason(d.reason);
  const kind = kindLabel(d.unitKind, d.bhk);
  return (
    <li
      data-testid="deal-row"
      className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-[var(--radius-row)] border border-line bg-surface px-4 py-3 md:min-h-[112px]"
    >
      <div className="min-w-0 flex-1 basis-[240px]">
        <Link
          href={`/listing/${d.id}`}
          aria-label={`Deal ${rank}: ${formatINR(d.rentInr)} a month, ${d.localityName}, ${kind}`}
          className="type-display figures inline-flex min-h-11 items-baseline gap-2 text-[24px] leading-[30px] after:absolute after:inset-0 after:content-['']"
        >
          {formatINR(d.rentInr)} <span className="text-[15px] font-normal text-indigo-2">a month</span>
        </Link>
        <div className="text-indigo-2">
          {d.localityName}, {kind}
          {d.areaSqft ? `, ${d.areaSqft.toLocaleString('en-IN')} sq ft` : ''}
        </div>
        <p data-testid="deal-reason" title={`Deal score ${d.score.toFixed(2)}`} className="figures mt-1 leading-[26px]">
          <mark className="highlighter">{highlight}</mark>
          {rest.map((part) => (
            <span key={part} className="ml-3 inline-block text-indigo-2">{part}</span>
          ))}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <FairBadge fair={d.fair} />
        <FairnessRuler rentInr={d.rentInr} fair={d.fair} />
      </div>
    </li>
  );
}
