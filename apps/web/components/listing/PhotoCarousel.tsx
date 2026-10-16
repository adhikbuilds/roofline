'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import type { PhotoSpec } from '@/lib/photos';
import { ListingPhoto } from './ListingPhoto';

/**
 * Swipeable photo strip for a card. Native scroll-snap (touch swipe, trackpad), arrow buttons on hover or focus,
 * dots at the bottom. Slides link to `href` when given, or call `onOpen(i)` (e.g. to open a lightbox).
 * `overlay` is positioned over the photo (verdict chip, heart button).
 */
export function PhotoCarousel({
  photos,
  href,
  onOpen,
  priority = false,
  sizes,
  className,
  overlay,
  openLabel,
}: {
  photos: PhotoSpec[];
  href?: string;
  onOpen?: (index: number) => void;
  priority?: boolean;
  sizes?: string;
  className?: string;
  overlay?: ReactNode;
  openLabel?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const n = photos.length;

  const onScroll = useCallback(() => {
    const el = track.current;
    if (el && el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  useEffect(() => {
    const el = track.current;
    if (el) el.scrollTo({ left: 0 });
  }, [n]);

  function go(i: number) {
    const el = track.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(n - 1, i)) * el.clientWidth, behavior: 'smooth' });
  }

  const arrow =
    'absolute top-1/2 z-20 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-ink shadow-[0_2px_8px_rgb(20_26_51/0.2)] ' +
    'opacity-0 transition-[opacity,transform] duration-150 hover:scale-105 focus-visible:opacity-100 group-hover/photo:opacity-100 group-focus-within/photo:opacity-100 ' +
    'disabled:pointer-events-none disabled:!opacity-0 max-md:hidden';

  return (
    <div className={cn('group/photo relative z-10 aspect-[4/3] overflow-hidden rounded-[12px] bg-canvas', className)}>
      <div
        ref={track}
        onScroll={onScroll}
        role="group"
        aria-roledescription="carousel"
        aria-label="Photos"
        className="scrollbar-none flex h-full snap-x snap-mandatory overflow-x-auto scroll-smooth"
      >
        {photos.map((p, i) => {
          const body = (
            <ListingPhoto
              spec={p}
              priority={priority && i === 0}
              sizes={sizes}
              className="transition-transform duration-500 ease-out group-hover/photo:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover/photo:scale-100"
            />
          );
          const slide = 'relative block h-full w-full shrink-0 snap-center overflow-hidden';
          return href ? (
            <Link key={i} href={href} tabIndex={i === 0 ? 0 : -1} aria-label={`${p.alt}, photo ${i + 1} of ${n}`} className={slide}>
              {body}
            </Link>
          ) : onOpen ? (
            <button key={i} type="button" onClick={() => onOpen(i)} aria-label={openLabel ?? `Open photo ${i + 1} of ${n}`} className={cn(slide, 'cursor-zoom-in')}>
              {body}
            </button>
          ) : (
            <div key={i} className={slide}>{body}</div>
          );
        })}
      </div>
      {overlay}
      {n > 1 && (
        <>
          <button type="button" aria-label="Previous photo" disabled={index === 0} onClick={() => go(index - 1)} className={cn(arrow, 'left-2')}>
            <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <button type="button" aria-label="Next photo" disabled={index === n - 1} onClick={() => go(index + 1)} className={cn(arrow, 'right-2')}>
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-2.5 z-10 flex justify-center gap-1" aria-hidden>
            {photos.map((_, i) => (
              <span
                key={i}
                className={cn('h-1.5 rounded-full shadow-[0_0_0_1px_rgb(20_26_51/0.12)] transition-all duration-200', i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/60')}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
