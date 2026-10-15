const CITY_TAIL = /(?:^|\s+)(?:bangalore|bengaluru|bengalooru|bangaluru|karnataka|india)$/;
const SUFFIXES = [
  /(?:^|\s+)phase\s*\d+(?:\s+\d+)?$/,
  /(?:^|\s+)sector\s*\d+$/,
  /(?:^|\s+)\d+(?:st|nd|rd|th)\s+(?:stage|block|cross|main)$/,
];

const STOP = new Set([
  'from', 'bangalore', 'bengaluru', 'near', 'near metro', 'prime location',
  'n a', 'na', 'other', 'india', 'karnataka',
]);

/** NFKC, lowercase, drop city tail and punctuation, collapse spaces, strip phase/sector/stage/block/cross/main suffixes. */
export function normLocality(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
  for (;;) {
    const next = [CITY_TAIL, ...SUFFIXES].reduce((acc, re) => acc.replace(re, ''), s).trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/** True when the text carries no usable locality ("From", "Bangalore", "Near", "", ...). */
export function isStopLocality(raw: unknown): boolean {
  const n = normLocality(raw);
  return n === '' || STOP.has(n);
}
