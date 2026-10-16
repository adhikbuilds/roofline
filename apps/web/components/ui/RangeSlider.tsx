'use client';

import * as Slider from '@radix-ui/react-slider';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from './cn';
import { STEPS, posToValue, valueToPos } from './scale';

/**
 * Dual-thumb range slider (Radix). Values are real units (rupees); with `log` the track is logarithmic so
 * the cheap end of the market is not squeezed into a sliver. `snap` rounds the emitted values.
 */
export function RangeSlider({
  min,
  max,
  value,
  onValueChange,
  log = false,
  snap = (v) => Math.round(v),
  format = (v) => String(v),
  label,
  className,
}: {
  min: number;
  max: number;
  value: [number, number];
  onValueChange: (v: [number, number]) => void;
  log?: boolean;
  snap?: (v: number) => number;
  format?: (v: number) => string;
  label: string;
  className?: string;
}) {
  const id = useId();
  // Thumb positions are kept separately from the (snapped) values: otherwise a keyboard step smaller than the
  // snap increment would round straight back to the same value and the thumb would never move.
  const fromValue = (v: [number, number]): [number, number] => [valueToPos(v[0], min, max, log), valueToPos(v[1], min, max, log)];
  const [pos, setPos] = useState<[number, number]>(() => fromValue(value));
  const emitted = useRef<[number, number]>(value);
  useEffect(() => {
    if (value[0] !== emitted.current[0] || value[1] !== emitted.current[1]) {
      setPos(fromValue(value));
      emitted.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value[0], value[1]]);
  const thumb =
    'block h-6 w-6 rounded-full border-2 border-purple bg-surface shadow-[0_2px_6px_rgb(20_26_51/0.2)] ' +
    'transition-transform duration-150 hover:scale-110 focus-visible:scale-110 data-[state=active]:scale-110 motion-reduce:transition-none';
  return (
    <div className={cn('w-full', className)}>
      <div className="figures mb-2 flex items-baseline justify-between text-[15px]">
        <span id={id} className="type-label text-[13px] uppercase tracking-wide text-ink-3">{label}</span>
        <span data-testid="range-label" className="type-label text-ink">
          {format(value[0])} <span className="text-ink-3">to</span> {format(value[1])}
        </span>
      </div>
      <Slider.Root
        aria-labelledby={id}
        className="relative flex h-6 w-full touch-none select-none items-center"
        min={0}
        max={STEPS}
        step={10}
        minStepsBetweenThumbs={2}
        value={pos}
        onValueChange={(p) => {
          setPos([p[0]!, p[1]!]);
          const lo = snap(posToValue(p[0]!, min, max, log));
          const hi = snap(posToValue(p[1]!, min, max, log));
          const next: [number, number] = [Math.max(min, lo), Math.min(max, Math.max(lo, hi))];
          emitted.current = next;
          onValueChange(next);
        }}
      >
        <Slider.Track className="relative h-1.5 grow rounded-full bg-line">
          <Slider.Range className="absolute h-full rounded-full bg-purple" />
        </Slider.Track>
        <Slider.Thumb className={thumb} aria-label={`${label}, minimum`} aria-valuetext={format(value[0])} />
        <Slider.Thumb className={thumb} aria-label={`${label}, maximum`} aria-valuetext={format(value[1])} />
      </Slider.Root>
    </div>
  );
}
