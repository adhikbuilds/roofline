import { describe, expect, it } from 'vitest';
import { PLATE_SEED } from '../lib/plate';
import { parseManifest, photoCount, photosFor, bhkLabel, localityHue, type ManifestEntry } from '../lib/photos';

const ID = '5b0c1a5e-1111-4111-8111-aaaaaaaaaaaa';
const manifest: ManifestEntry[] = [
  ...['a', 'b', 'c', 'd'].map((x) => ({ file: `living-${x}.jpg`, kind: 'living' as const, alt: `Living ${x}` })),
  ...['a', 'b', 'c'].map((x) => ({ file: `bed-${x}.jpg`, kind: 'bedroom' as const, alt: `Bedroom ${x}` })),
  ...['a', 'b'].map((x) => ({ file: `kit-${x}.jpg`, kind: 'kitchen' as const, alt: `Kitchen ${x}` })),
  ...['a', 'b'].map((x) => ({ file: `ext-${x}.jpg`, kind: 'exterior' as const, alt: `Exterior ${x}` })),
  ...['a', 'b', 'c', 'd'].map((x) => ({ file: `pg-${x}.jpg`, kind: 'pg' as const, alt: `PG ${x}` })),
];

describe('photosFor', () => {
  it('is deterministic for the same id', () => {
    expect(photosFor(ID, 'flat', {}, manifest)).toEqual(photosFor(ID, 'flat', {}, manifest));
  });
  it('returns 3 to 5 photos, never repeating one', () => {
    for (let i = 0; i < 200; i++) {
      const p = photosFor(`id-${i}`, 'flat', {}, manifest);
      expect(p.length).toBeGreaterThanOrEqual(3);
      expect(p.length).toBeLessThanOrEqual(5);
      const src = p.map((x) => (x.type === 'photo' ? x.src : ''));
      expect(new Set(src).size).toBe(src.length);
    }
  });
  it('varies across ids', () => {
    const firsts = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(photosFor(`id-${i}`, 'flat', {}, manifest))));
    expect(firsts.size).toBeGreaterThan(10);
  });
  it('pg listings get only pg photos; flats never get pg photos', () => {
    expect(photosFor(ID, 'pg', {}, manifest).every((p) => p.type === 'photo' && p.kind === 'pg')).toBe(true);
    for (let i = 0; i < 50; i++) {
      expect(photosFor(`f${i}`, 'flat', {}, manifest).every((p) => p.type === 'photo' && p.kind !== 'pg')).toBe(true);
    }
  });
  it('flats mix kinds', () => {
    const kinds = new Set(photosFor(ID, 'flat', {}, manifest).map((p) => p.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });
  it('falls back to placeholders on an empty manifest, with the same count', () => {
    const p = photosFor(ID, 'flat', { locality: 'Indiranagar', bhk: 2, unitKind: 'bhk' }, []);
    expect(p).toHaveLength(photoCount(ID));
    for (const s of p) {
      expect(s.type).toBe('placeholder');
      if (s.type === 'placeholder') {
        expect(s.bhkLabel).toBe('2 BHK');
        expect(s.seed).toMatch(PLATE_SEED);
        expect(s.hue).toBe(s.hue % 360);
      }
    }
    expect(p).toEqual(photosFor(ID, 'flat', { locality: 'Indiranagar', bhk: 2, unitKind: 'bhk' }, []));
  });
  it('falls back when nothing matches the requested kind', () => {
    expect(photosFor(ID, 'pg', {}, manifest.filter((m) => m.kind !== 'pg'))[0]?.type).toBe('placeholder');
  });
});

describe('helpers', () => {
  it('derives the same hue per locality, case-insensitively', () => {
    expect(localityHue('Koramangala')).toBe(localityHue(' koramangala '));
    expect(localityHue('Koramangala')).not.toBe(localityHue('Whitefield'));
  });
  it('labels units', () => {
    expect(bhkLabel('rk', 1)).toBe('1 RK');
    expect(bhkLabel('studio', null)).toBe('Studio');
    expect(bhkLabel('pg_bed', null)).toBe('PG bed');
    expect(bhkLabel('bhk', 3)).toBe('3 BHK');
  });
  it('drops malformed manifest entries instead of throwing', () => {
    expect(parseManifest(null)).toEqual([]);
    expect(parseManifest([{ file: '../etc/passwd', kind: 'living', alt: 'x' }, { file: 'ok.jpg', kind: 'nope', alt: 'x' }, { file: 'ok.jpg', kind: 'living', alt: 'fine' }])).toEqual([
      { file: 'ok.jpg', kind: 'living', alt: 'fine' },
    ]);
  });
});

describe('photosFor slot', () => {
  const manifest = [
    ...['a', 'b', 'c'].map((x) => ({ file: `living-${x}.jpg`, kind: 'living' as const, alt: 'l' })),
    ...['a', 'b', 'c'].map((x) => ({ file: `bedroom-${x}.jpg`, kind: 'bedroom' as const, alt: 'b' })),
    ...['a', 'b', 'c'].map((x) => ({ file: `kitchen-${x}.jpg`, kind: 'kitchen' as const, alt: 'k' })),
    ...['a', 'b', 'c'].map((x) => ({ file: `exterior-${x}.jpg`, kind: 'exterior' as const, alt: 'e' })),
    ...['a', 'b', 'c'].map((x) => ({ file: `pg-${x}.jpg`, kind: 'pg' as const, alt: 'p' })),
  ];
  const lead = (id: string, kind: 'flat' | 'pg', slot: number) => {
    const p = photosFor(id, kind, {}, manifest, slot)[0]!;
    return p.type === 'photo' ? p.src : '';
  };
  it('gives neighbouring cards different lead photos', () => {
    for (const kind of ['flat', 'pg'] as const) {
      const leads = Array.from({ length: 24 }, (_, i) => lead(`listing-${i}`, kind, i));
      for (let i = 1; i < leads.length; i++) expect(leads[i]).not.toBe(leads[i - 1]);
    }
  });
  it('is still deterministic for the same id and slot', () => {
    expect(photosFor('x', 'flat', {}, manifest, 3)).toEqual(photosFor('x', 'flat', {}, manifest, 3));
  });
});
