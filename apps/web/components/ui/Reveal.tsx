'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Fade and rise 12px once when scrolled into view (400ms ease-out). `index` staggers grid children by 60ms.
 * Reduced motion: globals.css pins revealed sections visible with no transform (the initial state must not
 * depend on the media query, or SSR and hydration disagree).
 */
export function Reveal({
  children,
  index = 0,
  className,
  as = 'div',
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article';
}) {
  const M = motion[as];
  return (
    <M
      data-reveal
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.4, ease: 'easeOut', delay: Math.min(index, 12) * 0.06 }}
    >
      {children}
    </M>
  );
}
