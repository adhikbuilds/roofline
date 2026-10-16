import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type ChipTone = 'neutral' | 'purple' | 'marigold' | 'deal' | 'over';

const TONE: Record<ChipTone, string> = {
  neutral: 'border-line bg-surface text-ink-2',
  purple: 'border-purple-100 bg-purple-50 text-purple-600',
  marigold: 'border-[#fde4ae] bg-marigold-50 text-[#92400e]',
  deal: 'border-[#a7f3d0] bg-[#ecfdf5] text-deal',
  over: 'border-[#fecaca] bg-[#fef2f2] text-over',
};

const BASE = 'type-label inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px]';

/** Static pill label. */
export function Chip({ tone = 'neutral', icon, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone; icon?: ReactNode }) {
  return (
    <span className={cn(BASE, TONE[tone], className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}

/** Toggle pill (a filter). `selected` is exposed as aria-pressed. */
export function ChipButton({
  selected = false,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        BASE,
        'cursor-pointer transition-colors duration-150',
        selected
          ? 'border-ink bg-ink text-white hover:bg-[#232b52]'
          : 'border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
