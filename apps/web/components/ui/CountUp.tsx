'use client';

import { animate, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/** Counts from 0 to `value` once when scrolled into view. Server HTML and reduced motion show the final figure. */
export function CountUp({ value, className, duration = 1.1 }: { value: number; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -5% 0px' });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduce) { setShown(value); return; }
    if (!inView) { setShown(0); return; }
    const controls = animate(0, value, { duration, ease: [0.2, 0.8, 0.2, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [inView, reduce, value, duration]);

  return (
    <span ref={ref} className={className} data-value={value} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {shown.toLocaleString('en-IN')}
    </span>
  );
}
