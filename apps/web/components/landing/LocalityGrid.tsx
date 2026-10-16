import { formatINR } from '@roofline/engine';
import { TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { Card, Chip, Reveal } from '@/components/ui';
import { sparkPaths } from '@/lib/landing';
import type { LandingLocality, LocalityTrend } from '@/lib/queries';
import { SectionHead } from './SectionHead';

const ZONE: Record<string, string> = {
  central: 'Central', north: 'North', south: 'South', east: 'East', west: 'West', north_east: 'North-east', south_east: 'South-east',
};

/** The busiest localities, each with its real 26-week median 2 BHK rent line. */
export function LocalityGrid({ localities, trends }: { localities: LandingLocality[]; trends: LocalityTrend[] }) {
  if (localities.length === 0) return null;
  const byslug = new Map(trends.map((t) => [t.slug, t.weeks]));
  return (
    <section aria-labelledby="loc-title" className="mx-auto max-w-[1320px] px-4 py-16 md:px-8 md:py-24">
      <SectionHead id="loc-title" eyebrow="Explore localities" title="Where the listings are, and where rents are heading">
        <p className="max-w-[36ch] text-[14px] leading-5 text-ink-3">
          Lines show the weekly median 2 BHK rent over the last 26 weeks.
        </p>
      </SectionHead>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {localities.map((l, i) => {
          const sp = sparkPaths(byslug.get(l.slug) ?? [], 220, 56);
          const up = (sp.changePct ?? 0) >= 0;
          const flat = Math.abs(sp.changePct ?? 0) < 0.5;
          const Trend = up ? TrendingUp : TrendingDown;
          return (
            <Reveal as="li" key={l.slug} index={i % 4}>
              <Card interactive className="group relative h-full p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="type-display text-[16px] leading-5 text-ink sm:text-[20px] sm:leading-6">
                    <Link
                      href={`/homes?loc=${l.slug}`}
                      className="after:absolute after:inset-0 after:rounded-[16px] after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-purple"
                    >
                      {l.name}
                    </Link>
                  </h3>
                  <span className="hidden sm:block"><Chip tone="neutral" className="h-7 text-[12px]">{ZONE[l.zone] ?? l.zone}</Chip></span>
                </div>
                <p className="mt-4 text-[13px] leading-4 text-ink-3">Median 2 BHK</p>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className="figures type-display text-[20px] leading-7 text-ink sm:text-[28px] sm:leading-8">
                    {l.median2bhkRent ? formatINR(l.median2bhkRent) : 'No 2 BHK yet'}
                  </p>
                  {sp.changePct != null && (
                    <span
                      className={`figures inline-flex items-center gap-1 text-[13px] font-semibold ${flat ? 'text-ink-3' : up ? 'text-above-text' : 'text-deal'}`}
                      title="Change in median 2 BHK rent over 26 weeks"
                    >
                      <Trend size={14} strokeWidth={2} aria-hidden />
                      {up ? '+' : ''}
                      {sp.changePct.toFixed(1)}%
                    </span>
                  )}
                </div>
                <svg
                  viewBox="0 0 220 56"
                  className="mt-3 h-14 w-full overflow-visible"
                  role="img"
                  aria-label={
                    sp.changePct == null
                      ? `${l.name}: not enough history for a trend`
                      : `${l.name}: median 2 BHK rent ${up ? 'rose' : 'fell'} ${Math.abs(sp.changePct).toFixed(1)} percent over 26 weeks`
                  }
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id={`sg-${l.slug}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="var(--color-purple)" stopOpacity="0.22" />
                      <stop offset="1" stopColor="var(--color-purple)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {sp.line && (
                    <>
                      <path d={sp.area} fill={`url(#sg-${l.slug})`} />
                      <path d={sp.line} fill="none" stroke="var(--color-purple)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    </>
                  )}
                </svg>
                <p className="figures mt-3 border-t border-line pt-3 text-[14px] text-ink-2">
                  <span className="font-semibold text-ink">{l.listings.toLocaleString('en-IN')}</span> listings
                </p>
              </Card>
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}
