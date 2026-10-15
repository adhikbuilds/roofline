import { formatINR } from '@roofline/engine';

type Ledger = { listings: number; sources: number; merged: number; rejected: number };

// Phase 0: the database is empty. Phase 1 replaces this with counts from ingest_runs.
async function getLedger(): Promise<Ledger> {
  return { listings: 0, sources: 0, merged: 0, rejected: 0 };
}

const n = (x: number) => x.toLocaleString('en-IN');

export default async function HomesPage() {
  const ledger = await getLedger();
  return (
    <div className="mx-auto max-w-[1320px] px-4 pt-8 md:px-8 md:pt-12">
      <h1 className="type-display max-w-[18ch] text-[34px] leading-[38px] md:text-[52px] md:leading-[56px]">
        Every rental in Bangalore, counted once.
      </h1>
      <p className="figures mt-4 max-w-[62ch] text-[17px] leading-[26px] text-indigo-2">
        {n(ledger.listings)} listings from {n(ledger.sources)} sources. {n(ledger.merged)} duplicates merged,{' '}
        {n(ledger.rejected)} rejected for bad data.
      </p>

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
