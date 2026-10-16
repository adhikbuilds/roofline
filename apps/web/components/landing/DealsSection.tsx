import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { ListingCard } from '@/components/listing/ListingCard';
import { Carousel, Reveal } from '@/components/ui';
import type { DealRow } from '@/lib/queries';
import { SectionHead } from './SectionHead';

/** The 12 best deals by stored score. `reason` is passed so each card shows its "N% below fair rent" highlight. */
export function DealsSection({ deals }: { deals: DealRow[] }) {
  if (deals.length === 0) return null;
  return (
    <section aria-labelledby="deals-title" className="mx-auto max-w-[1320px] px-4 py-16 md:px-8 md:py-24">
      <SectionHead id="deals-title" eyebrow="Deals this week" title="Priced well below what comparable homes ask">
        <Link
          href="/deals"
          className="type-label group inline-flex min-h-11 items-center gap-1.5 text-[15px] text-purple hover:text-purple-600"
        >
          See all deals
          <ArrowRight size={18} strokeWidth={1.75} aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transform-none" />
        </Link>
      </SectionHead>
      <Reveal>
        <Carousel label="Deals this week" dots={false}>
          {deals.map((d, i) => (
            <ListingCard key={d.id} row={d} reason={d.reason} priority={i < 2} slot={i} />
          ))}
        </Carousel>
      </Reveal>
    </section>
  );
}
