import Link from 'next/link';
import { formatINR } from '@roofline/engine';
import { getLedger, getListings, parsePage, type ListingRow } from '@/lib/queries';

export const dynamic = 'force-dynamic';


const n = (x: number) => x.toLocaleString('en-IN');

export default async function HomesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const page = parsePage((await searchParams).page);
  const [ledger, listings] = await Promise.all([getLedger(), getListings(page)]);
  return (
    <div className="mx-auto max-w-[1320px] px-4 pt-8 md:px-8 md:pt-12">
      <h1 className="type-display max-w-[18ch] text-[34px] leading-[38px] md:text-[52px] md:leading-[56px]">
        Every rental in Bangalore, counted once.
      </h1>
      <p data-testid="ledger" className="figures mt-4 max-w-[62ch] text-[17px] leading-[26px] text-indigo-2">
        {n(ledger.listings)} listings from {n(ledger.sources)} sources. {n(ledger.merged)} duplicates merged,{' '}
        {n(ledger.rejected)} rejected for bad data.
      </p>

      {listings.rows.length === 0 ? (
        <section
          aria-labelledby="empty-title"
          className="mt-10 rounded-[var(--radius-panel)] border border-line bg-surface p-6 md:p-10"
        >
          <h2 id="empty-title" className="type-display text-[24px] leading-[30px]">
            No listings loaded yet
          </h2>
          <p className="mt-2 max-w-[60ch] text-indigo-2">
            Load the synthetic Bangalore dataset to see listings, fair-rent checks and deals. Run{' '}
            <code className="rounded bg-concrete px-1.5 py-0.5 text-indigo">pnpm db:fresh</code> from the project root, then
            reload this page.
          </p>
          <FairnessRulerPreview />
        </section>
      ) : (
        <>
          <ul className="mt-8 flex flex-col gap-2">
            {listings.rows.map((l) => (
              <ListingItem key={l.id} l={l} />
            ))}
          </ul>
          <nav aria-label="Pagination" className="mt-6 flex gap-4 pb-4">
            {listings.page > 1 && (
              <Link href={listings.page === 2 ? '/' : `/?page=${listings.page - 1}`} className="inline-flex min-h-11 items-center font-medium text-purple underline underline-offset-4">
                Previous page
              </Link>
            )}
            {listings.hasNext && (
              <Link href={`/?page=${listings.page + 1}`} className="inline-flex min-h-11 items-center font-medium text-purple underline underline-offset-4">
                Next page
              </Link>
            )}
          </nav>
        </>
      )}
    </div>
  );
}

/** A static preview of the signature element so the empty state shows what each listing will carry. */
function FairnessRulerPreview() {
  const rent = 28000;
  const fair = 32500;
  return (
    <figure className="mt-8 max-w-sm">
      <div className="flex items-baseline gap-2">
        <span className="type-display figures text-[28px] leading-none">{formatINR(rent)}</span>
        <span className="text-indigo-2">a month</span>
      </div>
      <svg viewBox="0 0 132 18" className="mt-3 h-[36px] w-[264px]" role="img" aria-label="Rent sits 14% below the fair estimate">
        <line x1="2" y1="9" x2="130" y2="9" stroke="var(--color-line)" strokeWidth="4" strokeLinecap="round" />
        <line x1="52" y1="9" x2="71" y2="9" stroke="var(--color-good)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="71" cy="9" r="5" fill="var(--color-surface)" stroke="var(--color-indigo)" strokeWidth="2" />
        <circle cx="52" cy="9" r="5" fill="var(--color-purple)" />
      </svg>
      <figcaption className="mt-2 text-[14px] text-indigo-2">
        <span className="font-semibold text-good">Good price.</span> {formatINR(fair - rent)} below the fair estimate of{' '}
        {formatINR(fair)} for a 2BHK in this locality. Example only.
      </figcaption>
    </figure>
  );
}

function ListingItem({ l }: { l: ListingRow }) {
  const kind = l.unitKind === 'pg_bed' ? 'PG bed' : l.unitKind === 'studio' ? 'Studio' : l.unitKind === 'rk' ? '1 RK' : l.bhk ? `${l.bhk} BHK` : 'Home';
  return (
    <li data-testid="listing-row" className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-[var(--radius-row)] border border-line bg-surface px-4 py-3 md:min-h-[112px] md:items-center">
      <div className="min-w-0">
        <div className="type-display figures text-[24px] leading-[30px]">
          {formatINR(l.rentInr)} <span className="text-[15px] font-normal text-indigo-2">a month</span>
        </div>
        <div className="mt-1 text-indigo-2">
          {l.localityName}, {kind}
          {l.areaSqft ? `, ${l.areaSqft.toLocaleString('en-IN')} sq ft` : ''}
        </div>
      </div>
      <div className="figures text-right text-[14px] text-indigo-2">
        <div>{l.moveInInr == null ? 'Move-in cost not stated' : `${formatINR(l.moveInInr)} move-in`}</div>
        <div>{l.sourceCount === 1 ? '1 source' : `${l.sourceCount} sources`}</div>
      </div>
    </li>
  );
}
