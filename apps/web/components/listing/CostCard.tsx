'use client';

import { Bookmark, BookmarkCheck, Lock, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatINR } from '@roofline/engine';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FairBadge } from '@/components/fair/FairnessRuler';
import type { FairInfo } from '@/lib/fairness';

const KEY = 'roofline:saved';

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Sticky cost summary. "Save" writes to the same localStorage list as the heart on listing cards. */
export function CostCard({
  id,
  rentInr,
  depositInr,
  moveInInr,
  fair,
}: {
  id: string;
  rentInr: number;
  depositInr: number | null;
  moveInInr: number | null;
  fair: FairInfo | null;
}) {
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
    <Card data-testid="cost-card" className="p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="figures type-display text-[36px] leading-[40px]">
            {formatINR(rentInr)}
            <span className="type-label ml-1 text-[15px] font-medium text-ink-3">/month</span>
          </p>
        </div>
        {fair?.badge && <FairBadge fair={fair} />}
      </div>

      <dl className="figures mt-5 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2.5 border-t border-line pt-4 text-[15px]">
        <dt className="text-ink-2">Monthly rent</dt>
        <dd className="text-right font-medium">{formatINR(rentInr)}</dd>
        <dt className="text-ink-2">Deposit</dt>
        <dd className="text-right font-medium">{depositInr == null ? 'Deposit not listed' : formatINR(depositInr)}</dd>
        <dt className="text-ink-2">Brokerage</dt>
        <dd className="text-right font-medium text-deal">{formatINR(0)}</dd>
      </dl>
      <div className="figures mt-4 flex items-baseline justify-between gap-4 rounded-[12px] bg-purple-50 px-4 py-3">
        <span className="type-label text-[14px] text-purple-600">Move-in total</span>
        <span className="type-display text-[22px] leading-7 text-ink" data-testid="move-in-total">
          {moveInInr == null ? 'Not stated' : formatINR(moveInInr)}
        </span>
      </div>
      {moveInInr == null && <p className="mt-2 text-[13px] text-ink-3">Add the deposit when you ask the owner.</p>}

      <div className="mt-5 grid gap-2.5">
        <Button variant="primary" size="lg" disabled icon={<Phone size={18} strokeWidth={1.75} aria-hidden />} data-testid="contact-button">
          Contact via source
          <span className="type-label ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] uppercase tracking-wide">Demo</span>
        </Button>
        <Button
          variant="secondary"
          size="lg"
          aria-pressed={saved}
          onClick={toggle}
          data-testid="save-button"
          icon={saved ? <BookmarkCheck size={18} strokeWidth={1.75} aria-hidden className="text-purple" /> : <Bookmark size={18} strokeWidth={1.75} aria-hidden />}
        >
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      <p className="mt-4 flex items-start gap-2 text-[13px] leading-5 text-ink-3">
        <Lock size={14} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
        Demo data: contact is switched off because this listing is synthetic. Saved homes stay in this browser.
      </p>
    </Card>
  );
}
