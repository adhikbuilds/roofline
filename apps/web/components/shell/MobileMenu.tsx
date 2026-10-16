'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bookmark, LogIn, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/components/ui/cn';
import { Logo } from './Logo';
import { isActive, NAV } from './nav';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Slide-in navigation sheet for small screens: focus is trapped inside, Esc / backdrop / link click close it. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => setMounted(true), []);
  useEffect(() => close(), [pathname, close]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const opener = trigger.current;
    sheet.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        const nodes = sheet.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        const at = document.activeElement;
        if (!sheet.current?.contains(at)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && at === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [open, close]);

  const dist = reduce ? 0 : 40;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen(true)}
        className="grid h-11 w-11 place-items-center rounded-[12px] text-ink transition-colors hover:bg-purple-50 md:hidden"
      >
        <Menu size={22} strokeWidth={1.75} aria-hidden />
      </button>
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                key="menu"
                className="fixed inset-0 z-[90] md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <div className="absolute inset-0 bg-[#0b0f22]/55 backdrop-blur-[2px]" onClick={close} data-testid="menu-backdrop" />
                <motion.div
                  ref={sheet}
                  id="mobile-menu"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Site menu"
                  data-testid="mobile-menu"
                  className="absolute inset-y-0 right-0 flex w-[min(86vw,340px)] flex-col bg-surface shadow-[var(--shadow-pop)]"
                  initial={{ x: reduce ? 0 : '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: reduce ? 0 : '100%' }}
                  transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <div className="flex h-16 items-center justify-between border-b border-line pl-5 pr-3">
                    <Logo />
                    <button
                      type="button"
                      data-autofocus
                      aria-label="Close menu"
                      onClick={close}
                      className="grid h-11 w-11 place-items-center rounded-[12px] text-ink hover:bg-purple-50"
                    >
                      <X size={22} strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                  <nav aria-label="Menu" className="flex-1 overflow-y-auto px-3 py-4">
                    <ul className="flex flex-col gap-1">
                      {NAV.map((item, i) => {
                        const active = isActive(pathname, item.href);
                        return (
                          <motion.li
                            key={item.href}
                            initial={{ opacity: 0, x: dist }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.06 + i * 0.04, duration: 0.24, ease: 'easeOut' }}
                          >
                            <Link
                              href={item.href}
                              aria-current={active ? 'page' : undefined}
                              onClick={close}
                              className={cn(
                                'type-display flex min-h-12 items-center justify-between rounded-[12px] px-4 text-[22px] transition-colors',
                                active ? 'bg-purple-50 text-purple-600' : 'text-ink hover:bg-canvas',
                              )}
                            >
                              {item.label}
                              {active && <span aria-hidden className="h-2 w-2 rounded-full bg-purple" />}
                            </Link>
                          </motion.li>
                        );
                      })}
                    </ul>
                  </nav>
                  <div className="grid gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <Link
                      href="/activity"
                      onClick={close}
                      className="type-label inline-flex h-12 items-center justify-center gap-2 rounded-[12px] border border-line text-[15px] text-ink hover:bg-canvas"
                    >
                      <Bookmark size={18} strokeWidth={1.75} aria-hidden /> Saved
                    </Link>
                    <Link
                      href="/signin"
                      onClick={close}
                      className="type-label inline-flex h-12 items-center justify-center gap-2 rounded-[12px] bg-ink text-[15px] text-white hover:bg-[#232b52]"
                    >
                      <LogIn size={18} strokeWidth={1.75} aria-hidden /> Sign in
                    </Link>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
