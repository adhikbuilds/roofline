import { Reveal } from '@/components/ui/Reveal';
import { ListingCard } from '@/components/listing/ListingCard';
import type { ListingRow } from '@/lib/queries';

/** One grid cell: the shared photo card, fading up with a stagger. */
export function HomeCard({ row, index, priority = false }: { row: ListingRow; index: number; priority?: boolean }) {
  return (
    <Reveal as="li" index={index % 6} className="list-none">
      <ListingCard row={row} priority={priority} slot={index} />
    </Reveal>
  );
}
