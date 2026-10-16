'use client';

import { Expand } from 'lucide-react';
import { useState } from 'react';
import { Lightbox } from '@/components/ui/Lightbox';
import { cn } from '@/components/ui/cn';
import type { PhotoSpec } from '@/lib/photos';
import { ListingPhoto } from './ListingPhoto';
import { PhotoCarousel } from './PhotoCarousel';

/** Grid cell classes: one large photo (2x2) plus up to four thumbs that fill the right half whatever the count. */
function cellClass(i: number, n: number): string {
  if (i === 0) return 'col-span-2 row-span-2';
  if (n === 2) return 'col-span-2 row-span-2';
  if (n === 3) return 'col-span-2';
  if (n === 4) return i === 1 ? 'col-span-2' : '';
  return '';
}

/**
 * Detail gallery: one large photo plus up to four thumbs on desktop, a swipeable strip on mobile. Any photo opens the
 * lightbox (Esc closes, arrows navigate, Tab is trapped, focus returns to the thumb that opened it).
 */
export function ListingGallery({ photos, title }: { photos: PhotoSpec[]; title: string }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const shown = photos.slice(0, 5);
  const show = (i: number) => {
    setIndex(i);
    setOpen(true);
  };
  return (
    <div data-testid="gallery">
      {/* mobile: swipeable strip */}
      <div className="md:hidden">
        <PhotoCarousel
          photos={photos}
          onOpen={show}
          priority
          sizes="100vw"
          openLabel={`Open photo of ${title}`}
          className="aspect-[4/3] rounded-[16px]"
        />
      </div>

      {/* desktop: 1 large + 4 thumbs */}
      <div className="relative hidden aspect-[2/1] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-[20px] md:grid">
        {shown.map((p, i) => (
          <button
            key={i}
            type="button"
            data-testid={i === 0 ? 'gallery-main' : 'gallery-thumb'}
            aria-label={`Open photo ${i + 1} of ${photos.length}: ${p.alt}`}
            onClick={() => show(i)}
            className={cn('group relative min-h-0 overflow-hidden bg-canvas', cellClass(i, shown.length))}
          >
            <span className="block h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              <ListingPhoto spec={p} priority={i === 0} sizes={i === 0 ? '(min-width: 1320px) 660px, 50vw' : '330px'} showLabel={i === 0} />
            </span>
            <span aria-hidden className="absolute inset-0 bg-ink/0 transition-colors duration-200 group-hover:bg-ink/10" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => show(0)}
          className="type-label absolute bottom-3 right-3 inline-flex h-10 items-center gap-2 rounded-[12px] bg-white/95 px-4 text-[14px] text-ink shadow-[0_2px_10px_rgb(20_26_51/0.2)] backdrop-blur transition-transform hover:scale-[1.03]"
        >
          <Expand size={16} strokeWidth={1.75} aria-hidden />
          Show all {photos.length} photos
        </button>
      </div>
      {photos.some((p) => p.type === 'photo') && (
        <p className="mt-2 text-[12px] text-ink-3" data-testid="photo-disclosure">
          Photos are AI-generated illustrations of typical Bangalore rentals, not pictures of this home.
        </p>
      )}

      <Lightbox
        open={open}
        index={index}
        onClose={() => setOpen(false)}
        onIndexChange={setIndex}
        items={photos.map((p) => ({ src: p.type === 'photo' ? p.src : '', alt: p.alt }))}
        renderItem={(i) => <ListingPhoto spec={photos[i]!} className="object-contain" />}
      />
    </div>
  );
}
