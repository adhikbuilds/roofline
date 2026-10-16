import { notFound } from 'next/navigation';
import { ListingCard } from '@/components/listing/ListingCard';
import { Carousel } from '@/components/ui/Carousel';
import { ListingCardSkeleton } from '@/components/ui/Skeleton';
import { photosFor } from '@/lib/photos';
import { getDeals, getListings, getLocalities } from '@/lib/queries';
import { Playground } from './Playground';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'UI kit', robots: { index: false, follow: false } };

/** Dev-only component gallery: every ui/ component in its states. 404 in production. */
export default async function DevUiPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [deals, page, localities] = await Promise.all([getDeals({ locality: null, bhk: null }), getListings(1), getLocalities()]);
  const top = deals.slice(0, 6);
  const plain = page.rows.slice(0, 3);
  const noFair = page.rows.find((r) => r.fair == null) ?? { ...plain[0]!, fair: null };
  const options = localities
    .filter((l) => l.listings > 0)
    .map((l) => ({ value: l.slug, label: l.name, meta: l.median2bhkRent ? `₹${l.median2bhkRent.toLocaleString('en-IN')} 2BHK` : undefined }));
  const lightboxPhotos = photosFor('showcase-lightbox-0000', 'flat', { locality: 'Indiranagar', bhk: 2, unitKind: 'bhk' });

  return (
    <div className="mx-auto max-w-[1320px] space-y-14 px-4 py-10 md:px-8" data-testid="dev-ui">
      <header>
        <p className="type-label text-[13px] uppercase tracking-wide text-purple">Dev only</p>
        <h1 className="type-display text-[40px] leading-[44px] md:text-[56px] md:leading-[60px]">UI kit</h1>
        <p className="mt-2 max-w-[60ch] text-ink-2">Every component in its states. This page returns 404 in production.</p>
      </header>

      <Playground
        options={options}
        lightboxPhotos={lightboxPhotos.map((p) => (p.type === 'photo' ? { src: p.src, alt: p.alt } : { src: '', alt: p.alt }))}
        lightboxSpecs={lightboxPhotos}
      />

      <section aria-labelledby="cards">
        <h2 id="cards" className="type-display mb-5 text-[28px] leading-8">Listing cards</h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {plain.map((r, i) => <ListingCard key={r.id} row={r} priority={i === 0} />)}
          {top[0] && <ListingCard row={top[0]} rank={1} reason={top[0].reason} />}
          <ListingCard row={noFair} />
          <ListingCardSkeleton />
        </div>
      </section>

      <section aria-labelledby="carousel">
        <h2 id="carousel" className="type-display mb-5 text-[28px] leading-8">Carousel of deals</h2>
        <Carousel label="Top deals">
          {top.map((d, i) => <ListingCard key={d.id} row={d} rank={i + 1} reason={d.reason} />)}
        </Carousel>
      </section>
    </div>
  );
}
