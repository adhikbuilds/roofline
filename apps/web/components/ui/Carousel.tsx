'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * Scroll-snap carousel. Native touch/trackpad scrolling, arrow buttons that page by one card, and dots that follow
 * the scroll position. Each child is one slide; pass `slideClassName` to size slides.
 */
export function Carousel({
  children,
  label,
  slideClassName = 'w-[78%] sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-3rem)/4)]',
  className,
  dots = true,
}: {
  children: ReactNode;
  label: string;
  slideClassName?: string;
  className?: string;
  dots?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: false });
  const slides = Children.toArray(children);

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const first = el.children[0] as HTMLElement | undefined;
    const step = first ? first.offsetWidth + 16 : 1;
    setIndex(Math.round(el.scrollLeft / step));
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, slides.length]);

  function page(dir: 1 | -1) {
    const el = track.current;
    if (!el) return;
    const first = el.children[0] as HTMLElement | undefined;
    const step = (first ? first.offsetWidth : el.clientWidth) + 16;
    const per = Math.max(1, Math.floor(el.clientWidth / step));
    el.scrollBy({ left: dir * step * per, behavior: 'smooth' });
  }

  const arrow =
    'absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-ink shadow-[var(--shadow-pop)] transition-[opacity,transform] duration-150 hover:scale-105 disabled:pointer-events-none disabled:opacity-0 md:grid';
  return (
    <div role="region" aria-roledescription="carousel" aria-label={label} className={cn('group/carousel relative', className)}>
      <div
        role="group"
        ref={track}
        onScroll={measure}
        tabIndex={0}
        aria-label={`${label} slides`}
        className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 pb-4 pt-1 md:-mx-1 md:px-1"
      >
        {slides.map((s, i) => (
          <div key={i} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`} className={cn('shrink-0 snap-start', slideClassName)}>
            {s}
          </div>
        ))}
      </div>
      <button type="button" aria-label="Previous" disabled={edges.start} onClick={() => page(-1)} className={cn(arrow, '-left-5')}>
        <ChevronLeft size={20} strokeWidth={1.75} aria-hidden />
      </button>
      <button type="button" aria-label="Next" disabled={edges.end} onClick={() => page(1)} className={cn(arrow, '-right-5')}>
        <ChevronRight size={20} strokeWidth={1.75} aria-hidden />
      </button>
      {dots && slides.length > 1 && (
        <div className="mt-1 flex justify-center gap-1.5" aria-hidden>
          {slides.map((_, i) => (
            <span key={i} className={cn('h-1.5 rounded-full transition-all duration-200', i === index ? 'w-5 bg-purple' : 'w-1.5 bg-line')} />
          ))}
        </div>
      )}
    </div>
  );
}
