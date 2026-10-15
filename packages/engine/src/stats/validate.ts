export function assertFinite(xs: readonly number[], fn: string): void {
  for (const x of xs) {
    if (!Number.isFinite(x)) throw new RangeError(`${fn}: values must be finite numbers`);
  }
}

export function sortedCopy(xs: readonly number[], fn: string): number[] {
  assertFinite(xs, fn);
  return [...xs].sort((a, b) => a - b);
}
