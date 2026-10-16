import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

/** Eyebrow, display title and an optional right-hand slot (link, arrows). Shared by every landing section. */
export function SectionHead({
  eyebrow,
  title,
  id,
  children,
  className,
  tone = 'light',
}: {
  eyebrow: string;
  title: string;
  id: string;
  children?: ReactNode;
  className?: string;
  tone?: 'light' | 'dark';
}) {
  return (
    <div className={cn('mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:mb-10', className)}>
      <div className="max-w-[640px]">
        <p className={cn('type-label mb-2 text-[13px] uppercase tracking-[0.08em]', tone === 'dark' ? 'text-purple-100' : 'text-purple')}>
          {eyebrow}
        </p>
        <h2
          id={id}
          className={cn('type-display text-[30px] leading-[34px] md:text-[40px] md:leading-[44px]', tone === 'dark' ? 'text-white' : 'text-ink')}
        >
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}
