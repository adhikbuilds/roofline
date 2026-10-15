const MASK = (1n << 64n) - 1n;

/** Parse a stored photo hash (signed 64-bit decimal, or 16 hex digits) to unsigned 64-bit. */
export function parsePhotoHash(s: string): bigint | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  try {
    if (/^-?\d+$/.test(t)) {
      const v = BigInt(t);
      if (v < -(1n << 63n) || v > MASK) return null;
      return BigInt.asUintN(64, v);
    }
    if (/^[0-9a-fA-F]{16}$/.test(t)) return BigInt('0x' + t);
  } catch {
    return null;
  }
  return null;
}

/** Number of set bits in an unsigned 64-bit value. */
export function popcount64(x: bigint): number {
  let v = BigInt.asUintN(64, x);
  let n = 0;
  while (v !== 0n) {
    v &= v - 1n;
    n++;
  }
  return n;
}

/** Hamming distance between two unsigned 64-bit hashes. */
export function hamming64(a: bigint, b: bigint): number {
  return popcount64(a ^ b);
}

/** Minimum Hamming distance over all cross pairs; null if either list is empty. */
export function minHamming(a: readonly bigint[], b: readonly bigint[]): number | null {
  if (a.length === 0 || b.length === 0) return null;
  let best = 64;
  for (const x of a) {
    for (const y of b) {
      const h = hamming64(x, y);
      if (h < best) {
        best = h;
        if (best === 0) return 0;
      }
    }
  }
  return best;
}
