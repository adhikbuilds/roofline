'use client';

import { formatINR } from '@roofline/engine';
import { MapPin } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import type { ProjectedPoint } from '@/lib/landing';
import { SectionHead } from './SectionHead';

export const MAP_W = 640;
export const MAP_H = 600;

/** Static SVG of the city (the locality centroids' padded hull) with one dot per locality, sized by listings. */
export function MapTeaser({ dots, outlinePath }: { dots: ProjectedPoint[]; outlinePath: string }) {
  const [hot, setHot] = useState<string | null>(null);
  const dot = dots.find((d) => d.slug === hot) ?? null;
  const total = dots.reduce((s, d) => s + d.listings, 0);
  // Tooltip box is 190px wide in a map that is as wide as its container; keep it inside by clamping the anchor.
  const left = dot ? (dot.x / MAP_W) * 100 : 0;
  const below = dot ? dot.y < 170 : false;

  return (
    <section aria-labelledby="map-title" className="mx-auto max-w-[1320px] px-4 pb-16 md:px-8 md:pb-24">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
        <div>
          <SectionHead id="map-title" eyebrow="Map" title="Every locality we track, at a glance" className="!mb-5 md:!mb-6" />
          <p className="max-w-[44ch] text-[17px] leading-[27px] text-ink-2">
            {dots.length} localities and {total.toLocaleString('en-IN')} active listings. Bigger dots mean more listings. Hover or tab to a
            dot to see its median 2 BHK rent.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="lg" disabled icon={<MapPin size={18} strokeWidth={1.75} aria-hidden />}>
              Map search is coming soon
            </Button>
          </div>
          <div className="mt-6 flex items-center gap-4 text-[13px] text-ink-3">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 rounded-full bg-purple/60" /> fewer listings
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-4 w-4 rounded-full bg-purple/60" /> more listings
            </span>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[20px] border border-line bg-surface p-2 shadow-card" data-testid="map-teaser">
          <svg
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            className="block h-auto w-full"
            role="group"
            aria-label="Map of Bangalore localities sized by listings"
          >
            <defs>
              <pattern id="map-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="rgb(20 26 51 / 0.07)" />
              </pattern>
              <radialGradient id="map-land" cx="50%" cy="45%" r="65%">
                <stop offset="0" stopColor="var(--color-purple-50)" />
                <stop offset="1" stopColor="#EEF2FB" />
              </radialGradient>
            </defs>
            <rect width={MAP_W} height={MAP_H} fill="url(#map-grid)" />
            {outlinePath && (
              <path d={outlinePath} fill="url(#map-land)" stroke="var(--color-purple-100)" strokeWidth={2} strokeLinejoin="round" />
            )}
            {[...dots].sort((a, b) => b.listings - a.listings).map((d) => {
              const on = d.slug === hot;
              return (
                <circle
                  key={d.slug}
                  cx={d.x}
                  cy={d.y}
                  r={on ? d.r + 2 : d.r}
                  tabIndex={0}
                  role="img"
                  aria-label={`${d.name}: ${d.listings} listings${d.median2bhkRent ? `, median 2 BHK ${formatINR(d.median2bhkRent)}` : ''}`}
                  data-testid="map-dot"
                  onPointerEnter={() => setHot(d.slug)}
                  onPointerLeave={() => setHot((h) => (h === d.slug ? null : h))}
                  onFocus={() => setHot(d.slug)}
                  onBlur={() => setHot((h) => (h === d.slug ? null : h))}
                  fill="var(--color-purple)"
                  fillOpacity={on ? 0.95 : 0.5}
                  stroke="#fff"
                  strokeWidth={on ? 2.5 : 1.5}
                  className="cursor-pointer outline-none transition-[fill-opacity,r] duration-150 focus-visible:stroke-ink"
                />
              );
            })}
            {/* north arrow */}
            <g transform={`translate(${MAP_W - 44} 40)`} aria-hidden>
              <path d="M0 -14 L7 8 L0 3 L-7 8 Z" fill="var(--color-ink)" fillOpacity={0.75} />
              <text y="24" textAnchor="middle" fontSize="11" fill="var(--color-ink-3)" fontWeight={600}>N</text>
            </g>
          </svg>
          {dot && (
            <div
              role="status"
              data-testid="map-tooltip"
              className="pop-in pointer-events-none absolute z-10 w-[190px] -translate-x-1/2 rounded-[12px] bg-ink px-3.5 py-2.5 text-white shadow-[var(--shadow-pop)]"
              style={{
                left: `clamp(100px, ${left}%, calc(100% - 100px))`,
                top: below ? `calc(${(dot.y / MAP_H) * 100}% + ${dot.r + 10}px)` : undefined,
                bottom: below ? undefined : `calc(${100 - (dot.y / MAP_H) * 100}% + ${dot.r + 10}px)`,
              }}
            >
              <p className="type-display text-[15px] leading-5">{dot.name}</p>
              <p className="figures text-[13px] leading-5 text-white/80">
                {dot.median2bhkRent ? `${formatINR(dot.median2bhkRent)} median 2 BHK` : 'No 2 BHK listed'}
              </p>
              <p className="figures text-[13px] leading-5 text-white/60">{dot.listings.toLocaleString('en-IN')} listings</p>
            </div>
          )}
          <Chip tone="neutral" className="absolute bottom-4 left-4 bg-white/90 backdrop-blur">Static preview</Chip>
        </div>
      </div>
    </section>
  );
}
