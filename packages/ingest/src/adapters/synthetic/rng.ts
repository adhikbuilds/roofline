/** mulberry32: tiny seeded PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience wrapper over one mulberry32 stream. Every draw advances the same stream. */
export class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Standard normal (Box-Muller). */
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  /** Standard normal truncated to [-clip, clip]. */
  clippedNormal(clip: number): number {
    return Math.max(-clip, Math.min(clip, this.normal()));
  }
  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new RangeError('pick from empty array');
    return xs[Math.floor(this.next() * xs.length)] as T;
  }
  /** Index drawn proportionally to non-negative weights. */
  weightedIndex(weights: readonly number[]): number {
    const total = weights.reduce((s, w) => s + w, 0);
    let x = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      x -= weights[i] as number;
      if (x < 0) return i;
    }
    return weights.length - 1;
  }
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    return items[this.weightedIndex(weights)] as T;
  }
  /** Fisher-Yates, returns a new array. */
  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
  /** Sample k distinct items proportionally to weights. */
  weightedSample<T>(items: readonly T[], weights: readonly number[], k: number): T[] {
    const pool = items.map((item, i) => ({ item, w: weights[i] as number }));
    const out: T[] = [];
    while (out.length < k && pool.length > 0) {
      const i = this.weightedIndex(pool.map((p) => p.w));
      out.push((pool.splice(i, 1)[0] as { item: T }).item);
    }
    return out;
  }
}
