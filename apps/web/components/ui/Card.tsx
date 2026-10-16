import type { HTMLAttributes } from 'react';
import { cn } from './cn';

/** 16px radius, 1px line border, layered shadow. `interactive` lifts 2px on hover (reduced motion: shadow only). */
export function Card({
  interactive = false,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-[16px] border border-line bg-surface shadow-card',
        interactive &&
          'transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] motion-reduce:hover:translate-y-0',
        className,
      )}
      {...rest}
    />
  );
}
