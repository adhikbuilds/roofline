'use client';

import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useTransition } from 'react';
import { cn } from '@/components/ui/cn';

export type NavOption = { value: string; label: string; href: string };

/** A native select that navigates: the option hrefs are built on the server, so the URL stays the source of truth. */
export function NavSelect({
  label,
  value,
  options,
  className,
  hideLabel = false,
}: {
  label: string;
  value: string;
  options: NavOption[];
  className?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label htmlFor={id} className={cn('type-label text-[13px] text-ink-3', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
         
          onChange={(e) => {
            const o = options.find((x) => x.value === e.target.value);
            if (o) start(() => router.push(o.href, { scroll: false }));
          }}
          className="type-label h-10 max-w-[220px] cursor-pointer appearance-none rounded-[12px] border border-line bg-surface pl-3.5 pr-9 text-[14px] text-ink shadow-[0_1px_2px_rgb(20_26_51/0.04)] transition-colors hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden size={18} strokeWidth={1.75} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
      </div>
    </div>
  );
}
