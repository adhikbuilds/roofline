'use client';

import { Info, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export const DISCLOSURE_KEY = 'roofline:disclosure-dismissed';

/**
 * Slim synthetic-data notice. Always rendered on the server (so it is present on first load); once dismissed, the choice
 * is kept in localStorage and the banner stays hidden on later visits.
 */
export function DisclosureBar({ mode }: { mode: string }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(DISCLOSURE_KEY) === '1') setHidden(true);
    } catch {
      /* storage unavailable: keep showing it */
    }
  }, []);
  if (mode !== 'synthetic' || hidden) return null;
  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(DISCLOSURE_KEY, '1');
    } catch {
      /* ignore */
    }
  }
  return (
    <div role="note" data-testid="disclosure" className="relative z-50 bg-ink text-[13px] leading-5 text-white/90">
      <div className="mx-auto flex max-w-[1320px] items-center gap-2.5 py-1.5 pl-4 pr-1.5 md:pl-8 md:pr-6">
        <Info size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-marigold" />
        <p className="min-w-0 flex-1 truncate sm:whitespace-normal">
          <span className="font-semibold text-white">Demo data.</span> These are synthetic Bangalore listings, not real offers.{' '}
          <Link href="/methodology" className="underline decoration-white/40 underline-offset-2 hover:decoration-white">
            How it is built
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss demo data notice"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );
}
