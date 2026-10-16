import { formatINR } from '@roofline/engine';
import Link from 'next/link';
import { FairnessRuler } from '@/components/fair/FairnessRuler';
import { ListingPhoto } from '@/components/listing/ListingPhoto';
import { Chip } from '@/components/ui/Chip';
import { CountUp, Reveal } from '@/components/ui';
import { splitReason } from '@/lib/fairness';
import { bhkLabel, heroCollage, photosFor } from '@/lib/photos';
import type { DealRow, Ledger, LandingStats } from '@/lib/queries';
import { SearchConsole, type ConsoleLocality } from './SearchConsole';

const photoOf = (d: DealRow, i = 0) =>
  photosFor(d.id, d.unitKind === 'pg_bed' ? 'pg' : 'flat', { locality: d.localityName, bhk: d.bhk, unitKind: d.unitKind })[i]!;

export function Hero({
  deals,
  stats,
  ledger,
  localities,
  total,
}: {
  deals: DealRow[];
  stats: LandingStats | null;
  ledger: Ledger | null;
  localities: ConsoleLocality[];
  total: number | null;
}) {
  return (
    <section aria-labelledby="hero-title" className="hero-mesh">
      <div className="relative mx-auto grid max-w-[1320px] gap-12 px-4 pb-16 pt-14 md:px-8 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] lg:gap-10 lg:pb-14 lg:pt-16">
        <div className="min-w-0">
          <Chip tone="purple" className="mb-5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-marigold" />
            Fair-rent check on every listing
          </Chip>
          <h1
            id="hero-title"
            className="type-display max-w-[16ch] text-[40px] leading-[44px] text-ink md:text-[64px] md:leading-[68px]"
          >
            Every rental in Bangalore, <span className="text-purple">counted once.</span>
          </h1>
          <p className="mt-5 max-w-[52ch] text-[17px] leading-[27px] text-ink-2 md:text-[18px] md:leading-[28px]">
            Roofline merges the same flat posted on several sites into one listing, then tells you whether the rent is fair
            for that locality, size and furnishing.
          </p>
          <div className="mt-8 max-w-[600px]">
            <SearchConsole testId="hero-console" localities={localities} initialCount={total} />
          </div>
          {stats && (
            <p data-testid="live-counts" className="figures mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[15px] text-ink-2">
              <Figure n={stats.flats} label="flats" />
              <Dot />
              <Figure n={stats.pgBeds} label="PG beds" />
              {ledger && (
                <>
                  <Dot />
                  <Figure n={ledger.merged} label="duplicates merged" testId="ledger" numTestId="dupes-merged" />
                </>
              )}
            </p>
          )}
          <p className="mt-2 text-[13px] leading-5 text-ink-3">
            Demo data: the listings are synthetic. The counts and fair rents are computed live from them.
          </p>
        </div>
        <Collage deals={deals} />
      </div>
    </section>
  );
}

function Figure({ n, label, testId, numTestId }: { n: number; label: string; testId?: string; numTestId?: string }) {
  return (
    <span className="whitespace-nowrap" data-testid={testId}>
      <span data-testid={numTestId}>
        <CountUp value={n} className="type-display text-[22px] text-ink" />
      </span>{' '}
      <span>{label}</span>
    </span>
  );
}
const Dot = () => <span aria-hidden className="text-ink-3">·</span>;

function Collage({ deals }: { deals: DealRow[] }) {
  const [feature, a, b, c] = deals;
  const tiles = [a ?? feature, b ?? feature, c ?? feature].filter(Boolean) as DealRow[];
  const collage = heroCollage();
  if (!feature || tiles.length === 0) return <div aria-hidden className="hidden lg:block" />;
  const { highlight } = splitReason(feature.reason);
  const kind = bhkLabel(feature.unitKind, feature.bhk);
  return (
    <div className="relative min-w-0 pb-10 lg:self-start lg:pb-14" data-testid="hero-collage">
      <div className="grid h-[400px] grid-cols-[1.15fr_1fr] gap-3 sm:h-[520px] lg:h-[680px] lg:gap-4">
        <Reveal className="mb-14 overflow-hidden rounded-[20px] shadow-card lg:mb-20">
          <ListingPhoto spec={collage[0] ?? photoOf(tiles[0]!, 0)} priority labelClassName="left-4 top-4" sizes="(min-width: 1024px) 340px, 50vw" />
        </Reveal>
        <div className="mt-10 flex min-h-0 flex-col gap-3 lg:mt-16 lg:gap-4">
          <Reveal index={1} className="min-h-0 flex-[1.15] overflow-hidden rounded-[20px] shadow-card">
            <ListingPhoto spec={collage[1] ?? photoOf(tiles[1] ?? tiles[0]!, 1)} sizes="(min-width: 1024px) 300px, 45vw" />
          </Reveal>
          <Reveal index={2} className="min-h-0 flex-1 overflow-hidden rounded-[20px] shadow-card">
            <ListingPhoto spec={collage[2] ?? photoOf(tiles[2] ?? tiles[0]!, 2)} sizes="(min-width: 1024px) 300px, 45vw" />
          </Reveal>
        </div>
      </div>
      <Reveal index={3} className="absolute bottom-0 left-2 z-10 w-[min(300px,calc(100%-1rem))] sm:left-0 lg:-left-6 lg:bottom-2">
        <Link
          href={`/listing/${feature.id}`}
          data-testid="hero-deal-card"
          className="group block rounded-[16px] border border-line bg-surface p-3.5 shadow-[var(--shadow-pop)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0"
        >
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[10px]">
              <ListingPhoto spec={photoOf(feature, 3)} showLabel={false} sizes="56px" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[14px] leading-5 text-ink-2">
                {feature.localityName} · {kind}
              </p>
              <p className="figures type-display text-[24px] leading-7 text-ink">
                {formatINR(feature.rentInr)}
                <span className="type-label ml-1 text-[13px] font-medium text-ink-3">/mo</span>
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
            <FairnessRuler rentInr={feature.rentInr} fair={feature.fair} />
            <span className="text-right text-[13px] font-semibold leading-4 text-deal">{highlight}</span>
          </div>
          <p className="mt-2 text-[12px] leading-4 text-ink-3">A real deal from the live ranking</p>
        </Link>
      </Reveal>
    </div>
  );
}
