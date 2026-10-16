import { plateSvg } from '@/lib/plate';
import type { PhotoSpec } from '@/lib/photos';
import { cn } from '@/components/ui/cn';

/**
 * One listing photo: either a real image from the manifest or an intentional placeholder (locality-hued gradient,
 * faint floor-plan watermark, BHK label). Fills its parent; the parent sets the aspect ratio and radius.
 */
export function ListingPhoto({
  spec,
  priority = false,
  sizes,
  className,
  showLabel = true,
  labelClassName = 'bottom-3 left-3',
}: {
  spec: PhotoSpec;
  priority?: boolean;
  sizes?: string;
  className?: string;
  showLabel?: boolean;
  /** Placement of the BHK label chip on placeholders. */
  labelClassName?: string;
}) {
  if (spec.type === 'photo') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={spec.src}
        alt={spec.alt}
        sizes={sizes}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        draggable={false}
        className={cn('h-full w-full object-cover', className)}
      />
    );
  }
  const h = spec.hue;
  const plate = `data:image/svg+xml;utf8,${encodeURIComponent(plateSvg(spec.seed))}`;
  return (
    <div
      role="img"
      aria-label={spec.alt}
      data-testid="photo-placeholder"
      className={cn('relative h-full w-full overflow-hidden', className)}
      style={{
        background: `radial-gradient(120% 90% at 85% 10%, hsl(${(h + 40) % 360} 80% 92%) 0%, transparent 60%), linear-gradient(135deg, hsl(${h} 62% 90%) 0%, hsl(${(h + 26) % 360} 58% 78%) 100%)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={plate}
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute -right-[8%] -top-[6%] h-[112%] w-auto max-w-none -rotate-3 opacity-[0.14] mix-blend-multiply"
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: `linear-gradient(to top, hsl(${h} 45% 30% / 0.22), transparent 55%)` }}
      />
      {showLabel && (
        <div aria-hidden className={cn('absolute flex flex-col gap-0.5 rounded-[10px] bg-white/80 px-2.5 py-1.5 shadow-[0_1px_2px_rgb(20_26_51/0.1)] backdrop-blur-md', labelClassName)}>
          {/* pseudo-element text: decorative, and keeps link/button accessible names equal to the visible text (WCAG 2.5.3) */}
          <span data-t={spec.bhkLabel} className="type-display text-[17px] leading-5 text-ink after:content-[attr(data-t)]" />
          <span data-t={spec.label} className="type-label text-[11px] uppercase leading-3 tracking-wide text-ink-2 after:content-[attr(data-t)]" />
        </div>
      )}
    </div>
  );
}
