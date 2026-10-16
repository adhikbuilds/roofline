'use client';

import { Heart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/components/ui/cn';

const KEY = 'roofline:saved';

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Local-only save toggle (browser storage). Sign-in and server-side saved lists arrive later. */
export function HeartButton({ id, className }: { id: string; className?: string }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(read().includes(id)), [id]);
  function toggle() {
    const next = !saved;
    setSaved(next);
    try {
      const rest = read().filter((x) => x !== id);
      localStorage.setItem(KEY, JSON.stringify(next ? [...rest, id] : rest));
    } catch {
      /* storage unavailable: keep the in-memory state */
    }
  }
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved' : 'Save listing'}
      onClick={toggle}
      className={cn(
        'grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-[0_2px_8px_rgb(20_26_51/0.18)] transition-transform duration-150 hover:scale-110 active:scale-95 motion-reduce:transition-none',
        saved ? 'text-over' : 'text-ink-2',
        className,
      )}
    >
      <Heart size={18} strokeWidth={1.75} aria-hidden fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
}
