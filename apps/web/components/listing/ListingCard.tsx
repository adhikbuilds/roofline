import Link from 'next/link';
import { formatINR } from '@roofline/engine';
import { FairnessRuler } from '@/components/fair/FairnessRuler';
import { Card } from '@/components/ui/Card';
import { BADGE_LABEL, splitReason, verdictToken } from '@/lib/fairness';
import { bhkLabel, photosFor } from '@/lib/photos';
import type { ListingRow } from '@/lib/queries';
import { HeartButton } from './HeartButton';
import { PhotoCarousel } from './PhotoCarousel';

type CardRow = Pick<ListingRow, 'id' | 'rentInr' | 'bhk' | 'unitKind' | 'areaSqft' | 'localityName' | 'fair'> & {
  sourceCount?: number;
  moveInInr?: number | null;
};

const n = (x: number) => x.toLocaleString('en-IN');

/** Why this is cheap, in one line: "23% below fair rent". */
/** `deltaPct` is stored as a fraction (-0.143 is 14% below), as in fair_delta_pct. */
function deltaText(row: CardRow): string | null {
  const f = row.fair?.deltaPct;
  if (f == null) return null;
  const pct = Math.round(f * 100);
  if (Math.abs(pct) < 1) return null;
  return `${Math.abs(pct)}% ${pct < 0 ? 'below' : 'above'} fair rent`;
}

/**
 * Photo-led listing card. Server component: only the photo carousel and the heart are client islands.
 * `rank` and `reason` are used by the deals page (rank number, marigold-underlined reason line).
 */
export function ListingCard({
  row,
  rank,
  reason,
  priority = false,
  slot,
}: {
  row: CardRow;
  rank?: number;
  reason?: string;
  priority?: boolean;
  /** Position in its row or grid, so neighbouring cards lead with different photos. */
  slot?: number;
}) {
  const href = `/listing/${row.id}`;
  const label = bhkLabel(row.unitKind, row.bhk);
  const photos = photosFor(row.id, row.unitKind === 'pg_bed' ? 'pg' : 'flat', {
    locality: row.localityName,
    bhk: row.bhk,
    unitKind: row.unitKind,
  }, undefined, slot);
  const fair = row.fair;
  const { highlight } = splitReason(reason ?? null);
  // A deal card already leads with the reason ("44% below fair rent"), so the ruler caption would repeat it.
  const delta = reason && highlight ? null : deltaText(row);
  const verdict = fair?.badge ?? null;

  return (
    <Card interactive data-testid="listing-card" className="group relative flex h-full flex-col p-2">
      <PhotoCarousel
        photos={photos}
        href={href}
        priority={priority}
        sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
        overlay={
          <>
            <div className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5">
              {rank != null && (
                <span
                  data-testid="deal-rank"
                  className="figures type-display grid h-7 min-w-7 place-items-center rounded-full bg-marigold px-1.5 text-[14px] text-ink shadow-[0_2px_6px_rgb(20_26_51/0.2)]"
                >
                  {rank}
                </span>
              )}
              {verdict && fair && (
                <span
                  data-testid="verdict-chip"
                  className="type-label inline-flex h-7 items-center gap-1.5 rounded-full bg-white/95 px-2.5 text-[13px] text-ink shadow-[0_2px_6px_rgb(20_26_51/0.15)]"
                >
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: verdictToken(verdict) }} />
                  {BADGE_LABEL[verdict]}
                </span>
              )}
            </div>
            <HeartButton id={row.id} className="absolute right-2.5 top-2.5 z-20" />
          </>
        }
      />
      <div className="flex flex-1 flex-col gap-2.5 px-2.5 pb-2.5 pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="figures type-display text-[26px] leading-8">
            {formatINR(row.rentInr)}
            <span className="type-label ml-1 text-[14px] font-medium text-ink-3">/mo</span>
          </p>
          {row.moveInInr != null && (
            <p className="figures whitespace-nowrap text-[13px] text-ink-3">Move-in {formatINR(row.moveInInr)}</p>
          )}
        </div>
        <h3 className="text-[15px] leading-[22px] text-ink-2">
          <Link href={href} className="font-semibold text-ink after:absolute after:inset-0 after:z-0 after:rounded-[16px] after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-purple">
            {row.localityName}
          </Link>
          {' · '}
          {label}
          {row.areaSqft ? <span className="figures">{` · ${n(row.areaSqft)} sq ft`}</span> : null}
        </h3>
        {reason && highlight ? (
          <p className="text-[15px] leading-[22px] font-semibold text-ink">
            <span className="underline decoration-marigold decoration-2 underline-offset-[5px]">{highlight}</span>
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          {fair && fair.badge ? (
            <>
              <FairnessRuler rentInr={row.rentInr} fair={fair} />
              {delta && <span className="figures text-right text-[13px] leading-4 text-ink-2">{delta}</span>}
            </>
          ) : (
            <span className="text-[13px] text-ink-3">Not enough comparable listings</span>
          )}
        </div>
        {(row.sourceCount ?? 1) > 1 && (
          <p data-testid="also-on" className="text-[13px] text-ink-3">Also on {row.sourceCount} sources</p>
        )}
      </div>
    </Card>
  );
}
