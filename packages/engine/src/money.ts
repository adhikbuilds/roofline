/** Money formatting for INR with Indian digit grouping. Pure: no locale/Intl dependence. */

const SYMBOL = '₹';
const EMPTY = '—';
const LAKH = 100_000;
const CRORE = 10_000_000;

export interface FormatINROptions {
  /** Use K / L / Cr short forms. */
  short?: boolean;
}

function isUsable(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Round half away from zero to `dp` decimals (avoids float drift via toFixed on a scaled integer). */
function roundHalfAway(n: number, dp: number): number {
  const f = 10 ** dp;
  const scaled = Math.round(Math.abs(n) * f * (1 + Number.EPSILON));
  return (scaled / f) * (n < 0 ? -1 : 1);
}

/** Group an integer string 12345678 -> 1,23,45,678. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

function sign(negative: boolean): string {
  return negative ? '-' : '';
}

function trim(n: number, dp: number): string {
  return String(Number(n.toFixed(dp)));
}

/** Full form: 125000 -> "₹1,25,000". Rounds to whole rupees. */
function formatFull(n: number): string {
  const rounded = roundHalfAway(n, 0);
  const negative = rounded < 0;
  return `${sign(negative)}${SYMBOL}${groupIndian(String(Math.abs(rounded)))}`;
}

/** Short form: 42000 -> "₹42K", 150000 -> "₹1.5L", 10000000 -> "₹1Cr". */
export function formatINRShort(n: number | null | undefined): string {
  if (!isUsable(n)) return EMPTY;
  const abs = Math.abs(n);
  const s = (body: string) => `${sign(n < 0 && body !== `${SYMBOL}0`)}${body}`;

  if (abs < 1000) {
    const r = roundHalfAway(abs, 0);
    if (r < 1000) return s(`${SYMBOL}${r}`);
  }
  if (abs < LAKH) {
    const k = roundHalfAway(abs / 1000, 1);
    if (k < 100) return s(`${SYMBOL}${trim(k, 1)}K`);
  }
  if (abs < CRORE) {
    const l = roundHalfAway(abs / LAKH, 2);
    if (l < 100) return s(`${SYMBOL}${trim(l, 2)}L`);
  }
  const cr = roundHalfAway(abs / CRORE, 2);
  return s(`${SYMBOL}${trim(cr, 2)}Cr`);
}

export function formatINR(n: number | null | undefined, opts: FormatINROptions = {}): string {
  if (!isUsable(n)) return EMPTY;
  return opts.short ? formatINRShort(n) : formatFull(n);
}
