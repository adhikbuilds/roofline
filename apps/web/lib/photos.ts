/**
 * Listing photography. Originals are generated locally and listed in public/photos/manifest.json
 * ({ file, kind, alt }[]). No portal images, ever. `photosFor` picks 3 to 5 of them per listing by hashing the
 * listing id, so a listing always shows the same photos. When the manifest has nothing for a listing it returns
 * placeholder specs (locality-hued gradient tile + plate watermark + BHK label) that ListingPhoto draws.
 *
 * Server-side loader: do not import `loadManifest` from a client component (it reads the filesystem).
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const PHOTO_KINDS = ['living', 'bedroom', 'kitchen', 'exterior', 'pg'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
/** What the listing is: 'flat' mixes living/bedroom/kitchen/exterior shots; a specific kind picks only that kind. */
export type PhotoRequest = PhotoKind | 'flat';

const entry = z.object({
  file: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/).refine((f) => !f.includes('..'), 'no path traversal'),
  kind: z.enum(PHOTO_KINDS),
  alt: z.string().min(1).max(200),
});
export type ManifestEntry = z.infer<typeof entry>;

export type PhotoContext = { locality?: string | null; bhk?: number | null; unitKind?: string | null };

export type PhotoSpec =
  | { type: 'photo'; src: string; alt: string; kind: PhotoKind }
  | {
      type: 'placeholder';
      /** Matches PLATE_SEED, so it can be fed straight to plateSvg. */
      seed: string;
      /** 0..359, derived from the locality name. */
      hue: number;
      kind: PhotoKind;
      /** Room caption, e.g. "Living room". */
      label: string;
      /** "2 BHK", "1 RK", "Studio", "PG bed". */
      bhkLabel: string;
      alt: string;
    };

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string): () => number {
  let a = hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], r: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Invalid entries are dropped, not fatal: a typo in the manifest must not take the site down. */
export function parseManifest(raw: unknown): ManifestEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    const p = entry.safeParse(e);
    return p.success ? [p.data] : [];
  });
}

const MANIFEST_PATH = path.join(process.cwd(), 'public', 'photos', 'manifest.json');
let cache: { mtimeMs: number; entries: ManifestEntry[] } | null = null;

/** Reads the manifest, re-reading only when the file changes (so new photos show up in dev without a restart). */
export function loadManifest(file: string = MANIFEST_PATH): ManifestEntry[] {
  try {
    const { mtimeMs } = statSync(file);
    if (cache && cache.mtimeMs === mtimeMs) return cache.entries;
    const entries = parseManifest(JSON.parse(readFileSync(file, 'utf8')));
    cache = { mtimeMs, entries };
    return entries;
  } catch {
    return [];
  }
}

export function bhkLabel(unitKind?: string | null, bhk?: number | null): string {
  switch (unitKind) {
    case 'pg_bed': return 'PG bed';
    case 'studio': return 'Studio';
    case 'rk': return '1 RK';
    default: return bhk ? `${bhk} BHK` : 'Home';
  }
}

export function localityHue(locality?: string | null): number {
  return hashString((locality ?? 'bengaluru').trim().toLowerCase()) % 360;
}

const FLAT_ORDER: PhotoKind[] = ['exterior', 'living', 'bedroom', 'kitchen'];
const ROOM_LABEL: Record<PhotoKind, string> = {
  living: 'Living room',
  bedroom: 'Bedroom',
  kitchen: 'Kitchen',
  exterior: 'Building',
  pg: 'Shared room',
};
const PG_LABELS = ['Bed and desk', 'Common area', 'Wardrobe and window', 'Dining'];

/** Number of photos for a listing: 3, 4 or 5, fixed per id. */
export function photoCount(listingId: string): number {
  return 3 + (hashString(`${listingId}:count`) % 3);
}

function placeholders(listingId: string, kind: PhotoRequest, ctx: PhotoContext, count: number): PhotoSpec[] {
  const hue = localityHue(ctx.locality);
  const label = bhkLabel(ctx.unitKind, ctx.bhk);
  const r = rng(`${listingId}:ph`);
  const start = Math.floor(r() * 4);
  return Array.from({ length: count }, (_, i): PhotoSpec => {
    const k: PhotoKind = kind === 'flat' ? FLAT_ORDER[(start + i) % 4]! : kind;
    const caption = k === 'pg' ? PG_LABELS[(start + i) % PG_LABELS.length]! : ROOM_LABEL[k];
    const lid = listingId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 56) || 'listing';
    return {
      type: 'placeholder',
      seed: `${lid}-${i}`,
      hue: (hue + i * 7) % 360,
      kind: k,
      label: caption,
      bhkLabel: label,
      alt: `${label} in ${ctx.locality ?? 'Bangalore'}, ${caption.toLowerCase()} (illustration)`,
    };
  });
}

/**
 * Deterministic 3 to 5 photos for a listing. Same id and manifest always gives the same list.
 * Empty (or no matching) manifest falls back to placeholder specs of the same count.
 */
export function photosFor(
  listingId: string,
  kind: PhotoRequest,
  ctx: PhotoContext = {},
  manifest: ManifestEntry[] = loadManifest(),
  /** Position in a row or grid. When given, the lead photo cycles with it so neighbouring cards never open alike. */
  slot?: number,
): PhotoSpec[] {
  const want = photoCount(listingId);
  const r = rng(`${listingId}:pick`);
  const pool = manifest.filter((m) => (kind === 'flat' ? m.kind !== 'pg' : m.kind === kind));
  if (pool.length === 0) return placeholders(listingId, kind, ctx, want);

  const toSpec = (m: ManifestEntry): PhotoSpec => ({ type: 'photo', src: `/photos/${m.file}`, alt: m.alt, kind: m.kind });
  if (kind !== 'flat') {
    const mixed = shuffled(pool, r);
    if (slot !== undefined) {
      const lead = [...pool].sort((a, b) => a.file.localeCompare(b.file))[slot % pool.length]!;
      return [lead, ...mixed.filter((m) => m !== lead)].slice(0, want).map(toSpec);
    }
    return mixed.slice(0, want).map(toSpec);
  }

  // Round-robin across kinds so a flat shows a mix (building, living, bedroom, kitchen). The starting kind varies by
  // id, or by slot when the caller lays cards side by side.
  const rot = slot !== undefined ? slot % FLAT_ORDER.length : Math.floor(r() * FLAT_ORDER.length);
  const order = FLAT_ORDER.map((_, i) => FLAT_ORDER[(rot + i) % FLAT_ORDER.length]!);
  const buckets = order.map((k) => shuffled(pool.filter((m) => m.kind === k), r)).filter((b) => b.length > 0);
  const out: ManifestEntry[] = [];
  for (let round = 0; out.length < want && buckets.some((b) => b.length > round); round++) {
    for (const b of buckets) {
      if (out.length < want && b[round]) out.push(b[round]!);
    }
  }
  return out.map(toSpec);
}

/** The landing collage: the first living room, building and bedroom in the manifest, in that order (empty if none). */
export function heroCollage(manifest: ManifestEntry[] = loadManifest()): PhotoSpec[] {
  const out: PhotoSpec[] = [];
  for (const k of ['living', 'exterior', 'bedroom'] as const) {
    const m = manifest.find((e) => e.kind === k);
    if (m) out.push({ type: 'photo', src: `/photos/${m.file}`, alt: m.alt, kind: m.kind });
  }
  return out.length === 3 ? out : [];
}
