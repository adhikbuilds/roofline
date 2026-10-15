/** Deterministic procedural floor-plan SVG. Same seed, same plate. Colours are the Roofline tokens. */

export const PLATE_SEED = /^[a-z0-9-]{1,64}$/;

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function plateSvg(seed: string): string {
  const r = rng(seed);
  const W = 320, H = 240, m = 16;
  const splitX = Math.round(m + (W - 2 * m) * (0.35 + r() * 0.3));
  const splitY = Math.round(m + (H - 2 * m) * (0.4 + r() * 0.25));
  const rooms: Array<[number, number, number, number]> = [
    [m, m, splitX - m, splitY - m],
    [splitX, m, W - m - splitX, splitY - m],
    [m, splitY, splitX - m, H - m - splitY],
    [splitX, splitY, W - m - splitX, H - m - splitY],
  ];
  const parts: string[] = [];
  rooms.forEach(([x, y, w, h], i) => {
    const fill = i === Math.floor(r() * 4) ? 'var(--color-purple-soft, #F1E6F4)' : '#FFFFFF';
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="#1C2342" stroke-width="3"/>`);
    // door gap on a random wall, drawn as a line in the surface colour with an arc
    const side = Math.floor(r() * 2);
    const dx = side === 0 ? x + Math.round(w * (0.2 + r() * 0.4)) : x;
    const dy = side === 0 ? y + h : y + Math.round(h * (0.2 + r() * 0.4));
    parts.push(
      side === 0
        ? `<line x1="${dx}" y1="${dy}" x2="${dx + 22}" y2="${dy}" stroke="#EEF1F4" stroke-width="5"/>`
        : `<line x1="${dx}" y1="${dy}" x2="${dx}" y2="${dy + 22}" stroke="#EEF1F4" stroke-width="5"/>`,
    );
  });
  const wx = m + Math.round(r() * (W - 2 * m - 40));
  parts.push(`<line x1="${wx}" y1="${m}" x2="${wx + 36}" y2="${m}" stroke="#7B2D8E" stroke-width="5" stroke-linecap="round"/>`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Floor plan placeholder">` +
    `<rect width="${W}" height="${H}" fill="#EEF1F4"/>${parts.join('')}</svg>`
  );
}
