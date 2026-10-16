import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Carousel } from '@/components/ui/Carousel';
import { Reveal } from '@/components/ui/Reveal';
import { bhkLabel } from '@/lib/photos';
import type { SimilarListings as Similar } from '@/lib/queries';
import { ListingCard } from './ListingCard';

/** "More 2 BHK homes in Indiranagar": nearest rents first, same locality and BHK. Renders nothing when there are none. */
export function SimilarListings({ similar, unitKind, bhk }: { similar: Similar; unitKind: string; bhk: number | null }) {
  if (similar.rows.length === 0) return null;
  const label = bhkLabel(unitKind, bhk);
  const q = new URLSearchParams();
  if (similar.localitySlug) q.set('loc', similar.localitySlug);
  if (unitKind === 'bhk' && bhk) q.set('bhk', String(bhk));
  return (
    <Reveal className="mt-16">
      <section aria-labelledby="similar-title" data-testid="similar">
        <div className="flex items-end justify-between gap-4">
          <h2 id="similar-title" className="type-display text-[26px] leading-[32px] md:text-[32px] md:leading-[38px]">
            More {label} homes in {similar.localityName}
          </h2>
          <Link href={`/homes?${q}`} className="type-label hidden items-center gap-1.5 text-[15px] text-purple hover:text-purple-600 sm:inline-flex">
            See all <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
          </Link>
        </div>
        <Carousel label={`Similar ${label} homes`} className="mt-5">
          {similar.rows.map((row, i) => (
            <ListingCard key={row.id} row={row} slot={i} />
          ))}
        </Carousel>
      </section>
    </Reveal>
  );
}
