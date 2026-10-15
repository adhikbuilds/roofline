import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { formatINR } from '@roofline/engine';
import { FairBadge, FairnessRuler } from '@/components/fair/FairnessRuler';
import { PriceHistory } from '@/components/listing/PriceHistory';
import { NOT_ENOUGH_COMPS_COPY } from '@/lib/fairness';
import { parseListingId } from '@/lib/listing-detail';
import { getListingDetail, resolveListing } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Listing' };

function kindLabel(unitKind: string, bhk: number | null): string {
  if (unitKind === 'pg_bed') return 'PG bed';
  if (unitKind === 'studio') return 'Studio';
  if (unitKind === 'rk') return '1 RK';
  return bhk ? `${bhk} BHK` : 'Home';
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseListingId((await params).id);
  if (!id) notFound();
  const resolved = await resolveListing(id);
  if (resolved.kind === 'missing') notFound();
  if (resolved.kind === 'redirect') permanentRedirect(`/listing/${resolved.id}`);
  const l = await getListingDetail(resolved.id);
  if (!l) notFound();

  const kind = kindLabel(l.unitKind, l.bhk);
  const seeds = l.plateSeeds.length > 0 ? l.plateSeeds.slice(0, 3) : [l.id];
  const title = `${kind} in ${l.localityName}`;

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-8 pt-6 md:px-8 md:pt-10">
      <Link href="/" className="inline-flex min-h-11 items-center font-medium text-purple underline underline-offset-4">
        Back to homes
      </Link>
      <h1 className="type-display figures mt-2 text-[34px] leading-[38px] md:text-[52px] md:leading-[56px]">
        {formatINR(l.rentInr)} <span className="text-[17px] font-normal text-indigo-2 md:text-[20px]">a month</span>
      </h1>
      <p className="mt-2 text-[17px] leading-[26px] text-indigo-2">
        {title}
        {l.areaSqft ? `, ${l.areaSqft.toLocaleString('en-IN')} sq ft` : ''}
        {l.furnishing ? `, ${l.furnishing.replace(/_/g, ' ')}` : ''}
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-2">
            {seeds.map((seed, i) => (
              <img
                key={seed}
                src={`/img/plate/${seed}`}
                alt={`Floor plan placeholder ${i + 1} for this ${kind}`}
                width={320}
                height={240}
                className={`h-auto w-full rounded-[var(--radius-panel)] border border-line ${i === 0 ? 'col-span-2' : ''}`}
              />
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 self-start">
        <section aria-labelledby="fair-title" data-testid="fair-panel" className="min-w-0 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 id="fair-title" className="type-display text-[22px] leading-[28px]">Is this rent fair?</h2>
          {l.fair?.badge ? (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <FairBadge fair={l.fair} />
                <span className="figures text-indigo-2">
                  {l.fair.confidence === 'high' ? 'High' : 'Medium'} confidence
                </span>
              </div>
              <FairnessRuler rentInr={l.rentInr} fair={l.fair} labels />
              <dl className="figures grid grid-cols-[auto_1fr] gap-x-8 gap-y-2">
                <dt className="text-indigo-2">Fair estimate</dt>
                <dd className="text-right font-medium">{formatINR(l.fair.fairInr)} a month</dd>
                {l.fair.lowInr != null && l.fair.highInr != null && (
                  <>
                    <dt className="text-indigo-2">Comparable range</dt>
                    <dd data-testid="fair-interval" className="text-right font-medium">
                      {formatINR(l.fair.lowInr)} to {formatINR(l.fair.highInr)}
                    </dd>
                  </>
                )}
              </dl>
              {l.fair.explanation && <p data-testid="fair-explanation" className="text-indigo-2">{l.fair.explanation}</p>}
              <p className="text-[13px] text-indigo-2">An estimate from comparable listings, not an appraisal.</p>
            </div>
          ) : (
            <p data-testid="fair-unavailable" className="mt-3 text-indigo-2">
              <span className="font-semibold text-indigo">{NOT_ENOUGH_COMPS_COPY}.</span> There are too few similar homes nearby to
              judge this rent, so we show no verdict.
            </p>
          )}
        </section>

        <section aria-labelledby="cost-title" className="min-w-0 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 id="cost-title" className="type-display text-[22px] leading-[28px]">What it costs to move in</h2>
          <dl className="figures mt-4 grid grid-cols-[auto_1fr] gap-x-8 gap-y-3">
            <dt className="text-indigo-2">Rent</dt>
            <dd className="text-right font-medium">{formatINR(l.rentInr)} a month</dd>
            <dt className="text-indigo-2">Deposit</dt>
            <dd className="text-right font-medium">{l.depositInr == null ? 'Deposit not listed' : formatINR(l.depositInr)}</dd>
            <dt className="text-indigo-2">Move-in</dt>
            <dd className="text-right font-medium">
              {l.moveInInr == null ? 'Not stated, add the deposit when you ask' : `${formatINR(l.moveInInr)} move-in`}
            </dd>
          </dl>
        </section>
        </div>
      </div>

      <section aria-labelledby="sources-title" className="mt-10">
        <h2 id="sources-title" className="type-display text-[24px] leading-[30px]">
          {l.sourceCount === 1 ? 'Listed on 1 source' : `Also on ${l.sourceCount} sources`}
        </h2>
        <div className="mt-4 overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
          <table className="w-full min-w-[320px] text-left">
            <thead>
              <tr className="type-label border-b border-line text-indigo-2">
                <th scope="col" className="px-4 py-3">Source</th>
                <th scope="col" className="px-4 py-3 text-right">Rent</th>
                <th scope="col" className="px-4 py-3 text-right">Deposit</th>
              </tr>
            </thead>
            <tbody>
              {l.sources.map((s) => (
                <tr key={`${s.sourceId}-${s.rentInr}-${s.depositInr}`} data-testid="source-row" className="figures border-b border-line last:border-b-0">
                  <th scope="row" className="px-4 py-3 font-medium">{s.sourceName}</th>
                  <td className="px-4 py-3 text-right">{s.rentInr == null ? 'Not stated' : formatINR(s.rentInr)}</td>
                  <td className="px-4 py-3 text-right">{s.depositInr == null ? 'Not listed' : formatINR(s.depositInr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="history-title" className="mt-10">
        <h2 id="history-title" className="type-display text-[24px] leading-[30px]">Price history</h2>
        <div className="mt-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <PriceHistory history={l.history} />
        </div>
      </section>
    </div>
  );
}
