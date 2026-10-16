'use client';

import { useId, useRef, type KeyboardEvent } from 'react';
import { cn } from './cn';

export type Segment<T extends string> = { value: T; label: string };

/** Radio-group semantics with roving tabindex: arrows move and select, Home/End jump. */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  className,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const idx = Math.max(0, segments.findIndex((s) => s.value === value));

  function move(next: number) {
    const n = (next + segments.length) % segments.length;
    onChange(segments[n]!.value);
    refs.current[n]?.focus();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(idx + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(segments.length - 1); }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      className={cn('grid gap-1 rounded-[12px] border border-line bg-canvas p-1', className)}
      style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
    >
      {segments.map((s, i) => {
        const on = i === idx;
        return (
          <button
            key={s.value}
            ref={(el) => { refs.current[i] = el; }}
            id={`${id}-${s.value}`}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(s.value)}
            className={cn(
              'type-label h-9 rounded-[9px] px-2 text-[14px] transition-[background-color,color,box-shadow] duration-150',
              on
                ? 'bg-surface text-purple-600 shadow-[0_1px_2px_rgb(20_26_51/0.1),0_0_0_1px_var(--color-purple-100)]'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
