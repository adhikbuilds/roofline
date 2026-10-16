/** Maps a slider position (0..STEPS) to a value on a linear or logarithmic scale, and back. */
export const STEPS = 1000;

export function posToValue(pos: number, min: number, max: number, log: boolean): number {
  const t = Math.min(1, Math.max(0, pos / STEPS));
  return log ? Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min))) : min + t * (max - min);
}

export function valueToPos(value: number, min: number, max: number, log: boolean): number {
  const v = Math.min(max, Math.max(min, value));
  const t = log ? (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (v - min) / (max - min);
  return Math.round(t * STEPS);
}

/** Round to a friendly step: 500 below 20K, 1K below 50K, 5K above. */
export function niceRent(v: number): number {
  const step = v < 20000 ? 500 : v < 50000 ? 1000 : 5000;
  return Math.round(v / step) * step;
}
