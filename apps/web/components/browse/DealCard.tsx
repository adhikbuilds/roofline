import Link from 'next/link';
import { formatINR } from '@roofline/engine';
import { FairnessRuler } from '@/components/fair/FairnessRuler';
import { HeartButton } from '@/components/listing/HeartButton';
import { PhotoCarousel } from '@/components/listing/PhotoCarousel';
import { Card } from '@/components/ui/Card';
import { Reveal } from '@/components/ui/Reveal';
import { BADGE_LABEL, splitReason, verdictToken } from '@/lib/fairness';
import { bhkLabel, photosFor } from '@/lib/photos';
import type { DealRow } from '@/lib/queries';

/**
 * A ranked deal. The full stored reason is shown ("23% below fair rent", comps, saving): the first clause gets the
 * marigold underline, the remaining clauses stay muted beneath it.
 */
export function DealCard({ deal: d, rank, priority = false }: { deal: DealRow; rank: number; priority?: boolean }) {
  const href = `/listing/${d.id}`;
  const kind = bhkLabel(d.unitKind, d.bhk);
  const photos = photosFor(d.id, d.unitKind === 'pg_bed' ? 'pg' : 'flat', { locality: d.localityName, bhk: d.bhk, unitKind: d.unitKind }, undefined, rank - 1);
  const { highlight, rest } = splitReason(d.reason);
  const verdict = d.fair.badge;
  return (
    <Reveal as="li" index={(rank - 1) % 6} className="list-none">
      <Card interactive data-testid="deal-row" className="group relative flex h-full flex-col p-2">
        <PhotoCarousel
          photos={photos}
          href={href}
          priority={priority}
          sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
          overlay={
            <>
              <div className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5">
                <span
                  data-testid="deal-rank"
                  aria-label={`Rank ${rank}`}
                  className="figures type-display grid h-8 min-w-8 place-items-center rounded-full bg-marigold px-2 text-[15px] text-ink shadow-[0_2px_6px_rgb(20_26_51/0.2)]"
                >
                  {rank}
                </span>
                {verdict && (
                  <span className="type-label inline-flex h-7 items-center gap-1.5 rounded-full bg-white/95 px-2.5 text-[13px] text-ink shadow-[0_2px_6px_rgb(20_26_51/0.15)]">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: verdictToken(verdict) }} />
                    {BADGE_LABEL[verdict]}
                  </span>
                )}
              </div>
              <HeartButton id={d.id} className="absolute right-2.5 top-2.5 z-20" />
            </>
          }
        />
        <div className="flex flex-1 flex-col gap-2.5 px-2.5 pb-2.5 pt-3.5">
          <p className="figures type-display text-[26px] leading-8">
            {formatINR(d.rentInr)}
            <span className="type-label ml-1 text-[14px] font-medium text-ink-3">/mo</span>
          </p>
          <h3 className="text-[15px] leading-[22px] text-ink-2">
            <Link
              href={href}
              aria-label={`Deal ${rank}: ${formatINR(d.rentInr)} a month, ${d.localityName}, ${kind}`}
              className="font-semibold text-ink after:absolute after:inset-0 after:z-0 after:rounded-[16px] after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-purple"
            >
              {d.localityName}
            </Link>
            {' · '}
            {kind}
            {d.areaSqft ? <span className="figures">{` · ${d.areaSqft.toLocaleString('en-IN')} sq ft`}</span> : null}
          </h3>
          <p data-testid="deal-reason" title={`Deal score ${d.score.toFixed(2)}`} className="figures text-[15px] leading-[24px]">
            <span className="font-semibold text-ink underline decoration-marigold decoration-[3px] underline-offset-[5px]">{highlight}</span>
            {rest.length > 0 && <span className="mt-1 block text-[14px] leading-5 text-ink-2">{rest.join(' · ')}</span>}
          </p>
          <div className="mt-auto pt-1">
            <FairnessRuler rentInr={d.rentInr} fair={d.fair} />
          </div>
        </div>
      </Card>
    </Reveal>
  );
}
