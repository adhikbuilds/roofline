'use client';

import { Check, ChevronDown, MapPin, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from './cn';

export type ComboOption = { value: string; label: string; meta?: string };

/** Case-insensitive match; prefix matches rank above substring matches. */
export function filterOptions(options: ComboOption[], query: string, limit = 50): ComboOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  const starts: ComboOption[] = [];
  const contains: ComboOption[] = [];
  for (const o of options) {
    const l = o.label.toLowerCase();
    if (l.startsWith(q)) starts.push(o);
    else if (l.includes(q)) contains.push(o);
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * ARIA 1.2 combobox with a list popup. Focus stays on the input; the highlighted option is exposed through
 * aria-activedescendant. Keys: Down/Up move (Down opens), Home/End jump, Enter selects, Esc closes then clears, Tab closes.
 */
export function Combobox({
  options,
  value,
  onChange,
  label,
  placeholder = 'Search',
  emptyText = 'No match',
  className,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  placeholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const selected = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel = selected?.label ?? null;

  // Keep the visible text in step when the parent changes the value.
  useEffect(() => {
    if (selectedLabel !== null) setQuery(selectedLabel);
  }, [selectedLabel]);

  // When the text equals the selection the user has not started typing: show everything.
  const typing = selectedLabel === null || query !== selectedLabel;
  const shown = useMemo(() => filterOptions(options, typing ? query : ''), [options, query, typing]);
  const optId = (i: number) => `${uid}-opt-${i}`;

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[id="${optId(active)}"]`)?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(true);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedLabel]);

  function close(restore: boolean) {
    setOpen(false);
    if (restore) setQuery(selectedLabel ?? '');
  }
  function choose(o: ComboOption) {
    onChange(o.value);
    setQuery(o.label);
    setOpen(false);
  }
  function openAt(i: number) {
    setOpen(true);
    setActive(Math.max(0, Math.min(i, shown.length - 1)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openAt(Math.max(0, shown.findIndex((o) => o.value === value)));
        else setActive((a) => (a + 1) % Math.max(1, shown.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openAt(shown.length - 1);
        else setActive((a) => (a - 1 + shown.length) % Math.max(1, shown.length));
        break;
      case 'Home':
        if (open) { e.preventDefault(); setActive(0); }
        break;
      case 'End':
        if (open) { e.preventDefault(); setActive(Math.max(0, shown.length - 1)); }
        break;
      case 'Enter':
        if (open && shown[active]) { e.preventDefault(); choose(shown[active]!); }
        break;
      case 'Escape':
        if (open) { e.preventDefault(); close(true); }
        else if (query) { e.preventDefault(); setQuery(''); onChange(null); }
        break;
      case 'Tab':
        if (open) close(true);
        break;
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <label htmlFor={`${uid}-input`} className="type-label mb-2 block text-[13px] uppercase tracking-wide text-ink-3">
        {label}
      </label>
      <div className="relative">
        <MapPin aria-hidden size={18} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          ref={inputRef}
          id={`${uid}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? optId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            if (value !== null) onChange(null);
          }}
          onFocus={(e) => e.currentTarget.select()}
          onClick={() => !open && openAt(Math.max(0, shown.findIndex((o) => o.value === value)))}
          onKeyDown={onKeyDown}
          className="h-12 w-full rounded-[12px] border border-line bg-surface pl-11 pr-16 text-[16px] text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 hover:border-ink-3 focus:border-purple focus:shadow-[0_0_0_4px_var(--color-purple-50)] focus:outline-none"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {query && (
            <button
              type="button"
              aria-label="Clear locality"
              onClick={() => { setQuery(''); onChange(null); inputRef.current?.focus(); }}
              className="grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-canvas hover:text-ink"
            >
              <X size={16} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? 'Hide localities' : 'Show localities'}
            onClick={() => { if (open) close(true); else { inputRef.current?.focus(); openAt(0); } }}
            className="grid h-8 w-6 place-items-center text-ink-3"
          >
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden className={cn('transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')} />
          </button>
        </div>
      </div>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="pop-in absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-auto rounded-[12px] border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)]"
      >
        {shown.length === 0 && (
          <li role="presentation" className="px-3 py-3 text-[14px] text-ink-3">{emptyText}</li>
        )}
        {shown.map((o, i) => (
          <li
            key={o.value}
            id={optId(i)}
            role="option"
            aria-selected={o.value === value}
            data-active={i === active}
            onPointerMove={() => i !== active && setActive(i)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => choose(o)}
            className={cn(
              'flex cursor-pointer items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 text-[15px]',
              i === active ? 'bg-purple-50 text-purple-600' : 'text-ink',
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{o.label}</span>
              {o.value === value && <Check size={16} strokeWidth={2} aria-hidden className="shrink-0" />}
            </span>
            {o.meta && <span className="figures shrink-0 text-[13px] text-ink-3">{o.meta}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
