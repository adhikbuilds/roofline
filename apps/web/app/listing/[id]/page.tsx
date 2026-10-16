import type { Metadata } from 'next';
import { Armchair, BedDouble, ChevronRight, Layers, MapPin, Maximize2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { formatINR } from '@roofline/engine';
import { FairBadge } from '@/components/fair/FairnessRuler';
import { CostCard } from '@/components/listing/CostCard';
import { FairPanel } from '@/components/listing/FairPanel';
import { ListingGallery } from '@/components/listing/ListingGallery';
import { PriceHistory } from '@/components/listing/PriceHistory';
import { SimilarListings } from '@/components/listing/SimilarListings';
import { Reveal } from '@/components/ui/Reveal';
import { parseListingId } from '@/lib/listing-detail';
import { bhkLabel, photosFor } from '@/lib/photos';
import { getListingDetail, getSimilarListings, resolveListing } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Listing' };

const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const card = 'rounded-[16px] border border-line bg-surface shadow-card';

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseListingId((await params).id);
  if (!id) notFound();
  const resolved = await resolveListing(id);
  if (resolved.kind === 'missing') notFound();
  if (resolved.kind === 'redirect') permanentRedirect(`/listing/${resolved.id}`);
  const [l, similar] = await Promise.all([getListingDetail(resolved.id), getSimilarListings(resolved.id)]);
  if (!l) notFound();

  const kind = bhkLabel(l.unitKind, l.bhk);
  const title = `${kind} in ${l.localityName}`;
  const photos = photosFor(l.id, l.unitKind === 'pg_bed' ? 'pg' : 'flat', { locality: l.localityName, bhk: l.bhk, unitKind: l.unitKind });

  const facts = [
    { icon: BedDouble, label: 'Layout', value: kind },
    { icon: Maximize2, label: 'Area', value: l.areaSqft ? `${l.areaSqft.toLocaleString('en-IN')} sq ft` : 'Not stated' },
    { icon: Armchair, label: 'Furnishing', value: l.furnishing ? pretty(l.furnishing) : 'Not stated' },
    { icon: MapPin, label: 'Locality', value: l.localityName },
    { icon: Wallet, label: 'Deposit', value: l.depositInr == null ? 'Deposit not listed' : formatINR(l.depositInr) },
    { icon: Layers, label: 'Listed on', value: l.sourceCount === 1 ? '1 source' : `${l.sourceCount} sources` },
  ];
  const bestRent = Math.min(...l.sources.flatMap((s) => (s.rentInr == null ? [] : [s.rentInr])), Infinity);

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-8 pt-5 md:px-8 md:pt-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[14px] text-ink-3">
        <Link href="/homes" className="inline-flex min-h-9 items-center hover:text-purple">Homes</Link>
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
        <Link href="/homes" className="inline-flex min-h-9 items-center hover:text-purple">{l.localityName}</Link>
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
        <span aria-current="page" className="text-ink-2">{kind}</span>
      </nav>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="type-display text-[32px] leading-[36px] md:text-[44px] md:leading-[48px]">{title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-ink-2">
            <span className="figures">{formatINR(l.rentInr)} a month</span>
            {l.areaSqft ? <span className="figures">· {l.areaSqft.toLocaleString('en-IN')} sq ft</span> : null}
            {l.furnishing ? <span>· {pretty(l.furnishing)}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {l.fair?.badge && <FairBadge fair={l.fair} />}
          {l.sourceCount > 1 && (
            <span className="type-label inline-flex items-center gap-1.5 rounded-full bg-marigold-50 px-3 py-0.5 text-[13px] text-[#92600a]">
              <Layers size={14} strokeWidth={1.75} aria-hidden /> Also on {l.sourceCount} sources
            </span>
          )}
        </div>
      </div>

      <div className="mt-5">
        <ListingGallery photos={photos} title={title} />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
        <aside className="order-first self-start lg:sticky lg:top-24 lg:order-last" aria-label="Cost summary">
          <CostCard id={l.id} rentInr={l.rentInr} depositInr={l.depositInr} moveInInr={l.moveInInr} fair={l.fair} />
        </aside>

        <div className="flex min-w-0 flex-col gap-8">
          <Reveal>
            <section aria-labelledby="facts-title">
              <h2 id="facts-title" className="type-display text-[24px] leading-[30px]">The home</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="facts">
                {facts.map((f) => (
                  <div key={f.label} className={`${card} flex items-start gap-3 p-4`}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-purple-50 text-purple">
                      <f.icon size={18} strokeWidth={1.75} aria-hidden />
                    </span>
                    <dl className="min-w-0">
                      <dt className="text-[13px] leading-5 text-ink-3">{f.label}</dt>
                      <dd className="figures type-label truncate text-[16px] leading-6 text-ink">{f.value}</dd>
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          </Reveal>

          <Reveal>
            <FairPanel rentInr={l.rentInr} fair={l.fair} />
          </Reveal>

          <Reveal>
            <section aria-labelledby="sources-title">
              <h2 id="sources-title" className="type-display text-[24px] leading-[30px]">
                {l.sourceCount === 1 ? 'Listed on 1 source' : `Also on ${l.sourceCount} sources`}
              </h2>
              <p className="mt-1 text-ink-2">Roofline merged these into one home so you see it once.</p>
              <div className={`${card} mt-4 overflow-x-auto`}>
                <table className="w-full min-w-[320px] text-left">
                  <thead>
                    <tr className="type-label border-b border-line bg-canvas text-[13px] text-ink-3">
                      <th scope="col" className="px-4 py-3">Source</th>
                      <th scope="col" className="px-4 py-3 text-right">Rent</th>
                      <th scope="col" className="px-4 py-3 text-right">Deposit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.sources.map((s) => (
                      <tr key={`${s.sourceId}-${s.rentInr}-${s.depositInr}`} data-testid="source-row" className="figures border-b border-line last:border-b-0">
                        <th scope="row" className="px-4 py-3.5 font-semibold">{s.sourceName}</th>
                        <td className="px-4 py-3.5 text-right">
                          {s.rentInr == null ? 'Not stated' : formatINR(s.rentInr)}
                          {l.sources.length > 1 && s.rentInr === bestRent && (
                            <span className="type-label ml-2 rounded-full bg-[#e8f6f0] px-2 py-0.5 text-[11px] uppercase tracking-wide text-deal">Lowest</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">{s.depositInr == null ? 'Not listed' : formatINR(s.depositInr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </Reveal>

          <Reveal>
            <section aria-labelledby="history-title">
              <h2 id="history-title" className="type-display text-[24px] leading-[30px]">Price history</h2>
              <div className={`${card} mt-4 p-5 md:p-6`}>
                <PriceHistory history={l.history} />
              </div>
            </section>
          </Reveal>
        </div>
      </div>

      <SimilarListings similar={similar} unitKind={l.unitKind} bhk={l.bhk} />
    </div>
  );
}
