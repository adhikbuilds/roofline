'use client';

import * as Slider from '@radix-ui/react-slider';
import { formatINR, formatINRShort } from '@roofline/engine';
import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Chip } from '@/components/ui/Chip';
import { BADGE_LABEL, verdictToken, type BadgeName } from '@/lib/fairness';
import { tryItVerdict } from '@/lib/landing';
import { SectionHead } from './SectionHead';

export type TryItData = {
  id: string;
  localityName: string;
  bhk: number;
  rentInr: number;
  areaSqft: number | null;
  comps: number;
  fairInr: number;
  lowInr: number;
  highInr: number;
  confidence: 'high' | 'medium' | 'low';
};

const STEP = 100;
const EDGES: Array<{ at: number; badge: BadgeName }> = [
  { at: 0.8, badge: 'great_deal' },
  { at: 0.92, badge: 'good_price' },
  { at: 1.08, badge: 'fair' },
  { at: 1.2, badge: 'above_market' },
];

/**
 * "Is this rent fair? Try it". A presentational demo over one real listing's STORED estimate, interval and comps:
 * dragging re-bins the rent against those numbers with the engine's own badge edges. It is not a fair-rent model.
 */
export function TryIt({ data }: { data: TryItData }) {
  const { fairInr, lowInr, highInr } = data;
  const lo = Math.floor((fairInr * 0.6) / STEP) * STEP;
  const hi = Math.ceil((fairInr * 1.45) / STEP) * STEP;
  const [rent, setRent] = useState(data.rentInr);
  const where = `a ${data.bhk} BHK in ${data.localityName}`;
  const v = useMemo(() => tryItVerdict(rent, fairInr, data.confidence, where), [rent, fairInr, data.confidence, where]);
  const pct = (r: number) => `${Math.min(100, Math.max(0, ((r - lo) / (hi - lo)) * 100))}%`;
  const colour = v.badge ? verdictToken(v.badge) : 'var(--color-fair)';
  const moved = rent !== data.rentInr;

  // Verdict bands under the track: the engine's edges, as fractions of the stored fair estimate.
  const bounds = [lo, ...EDGES.map((e) => fairInr * e.at), hi];
  const order: BadgeName[] = ['great_deal', 'good_price', 'fair', 'above_market', 'overpriced'];
  const bands = order.map((badge, i) => ({ badge, from: bounds[i]!, to: bounds[i + 1]! }));

  return (
    <section id="try-it" aria-labelledby="tryit-title" className="bg-surface py-16 md:py-24">
      <div className="mx-auto max-w-[1320px] px-4 md:px-8">
        <SectionHead id="tryit-title" eyebrow="Try it" title="Is this rent fair? Drag it and see.">
          <Chip tone="purple">Real listing · stored estimate</Chip>
        </SectionHead>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
          <div>
            <p className="max-w-[44ch] text-[17px] leading-[27px] text-ink-2">
              Below is a real {data.bhk} BHK in {data.localityName}
              {data.areaSqft ? `, ${data.areaSqft.toLocaleString('en-IN')} sq ft` : ''}. Roofline priced it against{' '}
              <span className="figures font-semibold text-ink">{data.comps}</span> comparable homes and stored a fair rent of{' '}
              <span className="figures font-semibold text-ink">{formatINR(fairInr)}</span>, with most comparables between{' '}
              <span className="figures">{formatINRShort(lowInr)}</span> and <span className="figures">{formatINRShort(highInr)}</span>.
            </p>
            <p className="mt-4 max-w-[44ch] text-[15px] leading-6 text-ink-3">
              Move the slider to ask &ldquo;what if the rent were different?&rdquo; The demo only re-labels the stored numbers. The fair
              rent itself was computed once, when the listing was loaded.
            </p>
            <Link
              href={`/listing/${data.id}`}
              className="type-label mt-6 inline-flex min-h-11 items-center text-[15px] text-purple underline underline-offset-4 hover:text-purple-600"
            >
              Open this listing
            </Link>
          </div>

          <div data-testid="tryit" className="rounded-[20px] border border-line bg-canvas p-5 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="type-label text-[13px] uppercase tracking-wide text-ink-3">If the rent were</p>
                <p data-testid="tryit-rent" className="figures type-display text-[44px] leading-[48px] text-ink md:text-[56px] md:leading-[60px]">
                  {formatINR(rent)}
                  <span className="type-label ml-1.5 text-[16px] font-medium text-ink-3">/mo</span>
                </p>
              </div>
              <span
                data-testid="tryit-badge"
                className="type-label inline-flex h-10 items-center gap-2 rounded-full border-2 bg-surface px-4 text-[16px] transition-colors duration-200"
                style={{ borderColor: colour }}
              >
                <span aria-hidden className="h-2.5 w-2.5 rounded-full transition-colors duration-200" style={{ background: colour }} />
                {v.badge ? BADGE_LABEL[v.badge] : 'Not enough comparables'}
              </span>
            </div>
            <p data-testid="tryit-sentence" aria-live="polite" className="figures mt-2 min-h-[26px] text-[16px] text-ink-2">
              {v.sentence}
            </p>

            <div className="mt-12">
              <div className="relative h-14">
                <div className="absolute top-0 h-6" style={{ left: pct(lowInr), width: `calc(${pct(highInr)} - ${pct(lowInr)})` }}>
                  <div className="absolute inset-x-0 bottom-0 h-1.5 rounded-full bg-purple-100" />
                  <span className="figures absolute -bottom-2.5 right-full mr-2 whitespace-nowrap text-[12px] leading-4 text-ink-3">P10 {formatINRShort(lowInr)}</span>
                  <span className="figures absolute -bottom-2.5 left-full ml-2 whitespace-nowrap text-[12px] leading-4 text-ink-3">P90 {formatINRShort(highInr)}</span>
                </div>
                <Slider.Root
                  className="absolute inset-x-0 top-6 flex h-7 touch-none select-none items-center"
                  min={lo}
                  max={hi}
                  step={STEP}
                  value={[rent]}
                  onValueChange={([r]) => setRent(r!)}
                >
                  <Slider.Track className="relative h-2.5 grow overflow-hidden rounded-full bg-line">
                    {bands.map((b) => (
                      <span
                        key={b.badge}
                        aria-hidden
                        className="absolute inset-y-0 opacity-35"
                        style={{ left: pct(b.from), width: `calc(${pct(b.to)} - ${pct(b.from)})`, background: verdictToken(b.badge) }}
                      />
                    ))}
                  </Slider.Track>
                  <Slider.Thumb
                    aria-label="Monthly rent"
                    aria-valuetext={`${formatINR(rent)} a month`}
                    className="block h-7 w-7 rounded-full border-[3px] bg-surface shadow-[0_2px_8px_rgb(20_26_51/0.25)] transition-[transform,border-color] duration-150 hover:scale-110 focus-visible:scale-110 data-[state=active]:scale-110 motion-reduce:transition-none"
                    style={{ borderColor: colour }}
                  />
                </Slider.Root>
                <div aria-hidden className="pointer-events-none absolute top-[30px] z-0 -translate-x-1/2" style={{ left: pct(fairInr) }}>
                  <span className="block h-5 w-1 rounded-full bg-ink" />
                </div>
              </div>
              <div className="relative mt-1 h-11 text-[12px] leading-4 text-ink-3">
                <span className="figures absolute left-0 top-0">{formatINRShort(lo)}</span>
                <span className="figures absolute right-0 top-0">{formatINRShort(hi)}</span>
                <span className="type-label absolute top-0 -translate-x-1/2 text-center text-ink" style={{ left: pct(fairInr) }}>
                  <span className="block">Fair rent</span>
                  <span className="figures block font-normal text-ink-2">{formatINRShort(fairInr)}</span>
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-[13px] leading-5 text-ink-3">
                Listed at <span className="figures text-ink-2">{formatINR(data.rentInr)}</span>. Confidence: {data.confidence}.
              </p>
              <button
                type="button"
                onClick={() => setRent(data.rentInr)}
                disabled={!moved}
                className="type-label inline-flex min-h-11 items-center gap-1.5 rounded-[12px] px-3 text-[14px] text-ink-2 transition-colors hover:bg-purple-50 hover:text-purple-600 disabled:pointer-events-none disabled:opacity-40"
              >
                <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
                Back to listed rent
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
