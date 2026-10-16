'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type LightboxItem = { src: string; alt: string };

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Modal image viewer. Esc closes, Left/Right navigate, Tab is trapped inside the dialog, focus returns to the
 * element that opened it, and page scroll is locked while open.
 */
export function Lightbox({
  items,
  index,
  open,
  onClose,
  onIndexChange,
  renderItem,
}: {
  items: LightboxItem[];
  index: number;
  open: boolean;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  /** Optional custom body, e.g. a placeholder tile when there is no real photo. */
  renderItem?: (i: number) => React.ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const n = items.length;
  const go = useCallback((d: number) => n > 0 && onIndexChange((index + d + n) % n), [index, n, onIndexChange]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      document.body.style.overflow = prev;
      opener.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'Tab') {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        const at = document.activeElement;
        if (!dialog.current?.contains(at)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, go, onClose]);

  if (!open || n === 0 || typeof document === 'undefined') return null;
  const item = items[Math.min(index, n - 1)]!;
  const btn =
    'grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20';
  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      data-testid="lightbox"
      className="fixed inset-0 z-[100] grid place-items-center bg-[#0b0f22]/90 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <button type="button" data-autofocus aria-label="Close" onClick={onClose} className={`${btn} absolute right-4 top-4`}>
        <X size={20} strokeWidth={1.75} aria-hidden />
      </button>
      {n > 1 && (
        <>
          <button type="button" aria-label="Previous photo" onClick={() => go(-1)} className={`${btn} absolute left-3 top-1/2 -translate-y-1/2 md:left-6`}>
            <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
          </button>
          <button type="button" aria-label="Next photo" onClick={() => go(1)} className={`${btn} absolute right-3 top-1/2 -translate-y-1/2 md:right-6`}>
            <ChevronRight size={22} strokeWidth={1.75} aria-hidden />
          </button>
        </>
      )}
      <figure className="flex max-h-full w-full max-w-5xl flex-col items-center gap-3">
        <div className="aspect-[4/3] max-h-[80dvh] w-full overflow-hidden rounded-[16px]">
          {renderItem ? renderItem(index) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.src} alt={item.alt} className="h-full w-full object-contain" />
          )}
        </div>
        <figcaption className="figures text-[14px] text-white/80" aria-live="polite">
          {item.alt} <span className="text-white/50">· {index + 1} / {n}</span>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}
