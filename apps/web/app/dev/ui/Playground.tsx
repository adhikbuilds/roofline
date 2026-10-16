'use client';

import { ArrowRight, Bookmark, Search } from 'lucide-react';
import { useState } from 'react';
import { PhotoCarousel } from '@/components/listing/PhotoCarousel';
import { ListingPhoto } from '@/components/listing/ListingPhoto';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipButton } from '@/components/ui/Chip';
import { Combobox, type ComboOption } from '@/components/ui/Combobox';
import { CountUp } from '@/components/ui/CountUp';
import { Lightbox } from '@/components/ui/Lightbox';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { Reveal } from '@/components/ui/Reveal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { niceRent } from '@/components/ui/scale';
import type { PhotoSpec } from '@/lib/photos';

const BHK = [
  { value: 'any', label: 'Any' },
  { value: 'rk', label: '1RK' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4plus', label: '4+' },
];
const inr = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L` : `₹${Math.round(v / 1000)}K`);

function Block({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="type-display mb-5 text-[28px] leading-8">{title}</h2>
      {children}
    </section>
  );
}

export function Playground({
  options,
  lightboxPhotos,
  lightboxSpecs,
}: {
  options: ComboOption[];
  lightboxPhotos: Array<{ src: string; alt: string }>;
  lightboxSpecs: PhotoSpec[];
}) {
  const [loc, setLoc] = useState<string | null>(null);
  const [bhk, setBhk] = useState('2');
  const [range, setRange] = useState<[number, number]>([15000, 60000]);
  const [chips, setChips] = useState<string[]>(['Furnished']);
  const [lb, setLb] = useState<number | null>(null);

  return (
    <>
      <Block id="buttons" title="Buttons and chips">
        <div className="flex flex-wrap items-center gap-3">
          <Button iconRight={<ArrowRight size={18} strokeWidth={1.75} />}>Primary</Button>
          <Button variant="secondary" icon={<Bookmark size={18} strokeWidth={1.75} />}>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="dark">Dark</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" variant="secondary">Small</Button>
          <Button size="lg" icon={<Search size={18} strokeWidth={1.75} />}>Search 5,202 homes</Button>
          <ButtonLink href="/deals" variant="secondary">As a link</ButtonLink>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {['Furnished', 'Semi-furnished', 'Unfurnished', 'Great deal'].map((c) => (
            <ChipButton key={c} selected={chips.includes(c)} onClick={() => setChips((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}>
              {c}
            </ChipButton>
          ))}
          <span className="mx-2 h-5 w-px bg-line" />
          <Chip>Neutral</Chip>
          <Chip tone="purple">Indiranagar</Chip>
          <Chip tone="marigold">New</Chip>
          <Chip tone="deal">22% below fair</Chip>
          <Chip tone="over">Overpriced</Chip>
        </div>
      </Block>

      <Block id="console" title="Search controls">
        <Card className="grid gap-6 p-5 md:grid-cols-3 md:p-6">
          <Combobox label="Locality" options={options} value={loc} onChange={setLoc} placeholder="Try Indiranagar" />
          <div>
            <p className="type-label mb-2 text-[13px] uppercase tracking-wide text-ink-3">Bedrooms</p>
            <SegmentedControl label="Bedrooms" segments={BHK} value={bhk} onChange={setBhk} />
          </div>
          <RangeSlider label="Budget" min={5000} max={150000} log value={range} onValueChange={setRange} snap={niceRent} format={inr} />
        </Card>
        <p data-testid="playground-state" className="figures mt-3 text-[13px] text-ink-3">
          loc={loc ?? 'any'} · bhk={bhk} · budget={range[0]}–{range[1]}
        </p>
      </Block>

      <Block id="motion" title="Reveal and count-up">
        <div className="grid gap-4 sm:grid-cols-3">
          {[['flats', 3902], ['PG beds', 1164], ['duplicates merged', 1106]].map(([l, v], i) => (
            <Reveal key={String(l)} index={i}>
              <Card className="p-5">
                <p className="type-display figures text-[40px] leading-[44px]"><CountUp value={v as number} /></p>
                <p className="text-ink-2">{l}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Block>

      <Block id="photos" title="Photos, placeholders and lightbox">
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <PhotoCarousel photos={lightboxSpecs} onOpen={setLb} openLabel="Open photo" />
            <p className="mt-2 text-[13px] text-ink-3">Carousel, click opens the lightbox</p>
          </div>
          {lightboxSpecs.slice(0, 2).map((s, i) => (
            <div key={i}>
              <div className="aspect-[4/3] overflow-hidden rounded-[12px]"><ListingPhoto spec={s} /></div>
              <p className="mt-2 text-[13px] text-ink-3">{s.type === 'placeholder' ? `${s.kind}, hue ${Math.round(s.hue)}` : s.kind}</p>
            </div>
          ))}
        </div>
        <Lightbox
          items={lightboxPhotos}
          index={lb ?? 0}
          open={lb !== null}
          onClose={() => setLb(null)}
          onIndexChange={setLb}
          renderItem={(i) => <ListingPhoto spec={lightboxSpecs[i]!} showLabel />}
        />
      </Block>

      <Block id="skeletons" title="Skeleton">
        <div className="max-w-sm space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>
      </Block>
    </>
  );
}
