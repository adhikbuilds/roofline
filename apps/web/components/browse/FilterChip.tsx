import Link from 'next/link';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

const BASE =
  'type-label inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[14px] transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple';

/**
 * A filter chip is a link to the page with that filter toggled, so the URL is the single source of truth:
 * back/forward restore the previous filters and the chips work before any JavaScript has loaded.
 */
export function FilterChip({
  href,
  selected,
  dot,
  children,
  testId,
}: {
  href: string;
  selected: boolean;
  dot?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? 'true' : undefined}
      data-selected={selected}
      data-testid={testId ?? 'filter-chip'}
      className={cn(
        BASE,
        selected
          ? 'border-ink bg-ink text-white shadow-[0_2px_6px_rgb(20_26_51/0.2)] hover:bg-[#232b52]'
          : 'border-line bg-surface text-ink-2 hover:border-ink-3 hover:bg-canvas hover:text-ink',
      )}
    >
      {dot && <span aria-hidden className="h-2 w-2 rounded-full ring-2 ring-white/70" style={{ background: dot }} />}
      {children}
    </Link>
  );
}

/** An applied filter shown as a removable pill. */
export function ActiveChip({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      data-testid="active-chip"
      aria-label={`Remove filter: ${typeof children === 'string' ? children : ''}`}
      className="type-label inline-flex h-8 items-center gap-1.5 rounded-full border border-purple-100 bg-purple-50 pl-3 pr-2 text-[13px] text-purple-600 transition-colors hover:bg-purple-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
    >
      {children}
      <X size={14} strokeWidth={2} aria-hidden />
    </Link>
  );
}
