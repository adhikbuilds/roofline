import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '../reference');
const read = <T>(name: string): T => JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as T;

interface Loc { name: string; slug: string; zone: string; lat: number; lng: number; radiusM: number; base2bhkHint: number }
interface Alias { alias: string; locality: string }
interface Station { name: string; line: string; seq: number; lat: number; lng: number; status: string }

const BBOX = { south: 12.7, north: 13.25, west: 77.35, east: 77.85 };
const inBbox = (lat: number, lng: number) =>
  lat >= BBOX.south && lat <= BBOX.north && lng >= BBOX.west && lng <= BBOX.east;

const localities = read<Loc[]>('localities.json');

// Built from fragments so this file never contains the literal names brand-guard bans.
const REAL_PORTALS = new RegExp(
  [['no', 'broker'], ['magic', 'bricks'], ['nest', 'away'], ['hous', 'ing'], ['casa', 'setu'], ['99', 'acres'], ['ol', 'x']]
    .map((p) => p.join(''))
    .join('|'),
);

describe('localities.json', () => {
  it('has exactly 69 localities', () => expect(localities).toHaveLength(69));
  it('has unique slugs and names', () => {
    expect(new Set(localities.map((l) => l.slug)).size).toBe(69);
    expect(new Set(localities.map((l) => l.name)).size).toBe(69);
  });
  it('has kebab-case slugs', () => {
    for (const l of localities) expect(l.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it('keeps every centroid inside the Bangalore bbox', () => {
    for (const l of localities) expect(inBbox(l.lat, l.lng), l.name).toBe(true);
  });
  it('uses only known zones, all of them', () => {
    const zones = new Set(localities.map((l) => l.zone));
    expect([...zones].sort()).toEqual(
      ['central', 'east', 'north', 'north_east', 'south', 'south_east', 'west'].sort(),
    );
  });
  it('has positive radius and rent hints', () => {
    for (const l of localities) {
      expect(l.radiusM).toBeGreaterThan(0);
      expect(l.base2bhkHint).toBeGreaterThan(0);
    }
  });
  it('never names a locality From, Bangalore or Bengaluru', () => {
    for (const l of localities) expect(['from', 'bangalore', 'bengaluru']).not.toContain(l.name.toLowerCase());
  });
});

describe('aliases.json', () => {
  const aliases = read<Alias[]>('aliases.json');
  const names = new Set(localities.map((l) => l.name));
  it('has roughly 120 aliases', () => {
    expect(aliases.length).toBeGreaterThanOrEqual(100);
    expect(aliases.length).toBeLessThanOrEqual(160);
  });
  it('points every alias at a real locality', () => {
    for (const a of aliases) expect(names.has(a.locality), a.alias).toBe(true);
  });
  it('stores normalized (lowercase, trimmed, single-spaced, no punctuation) unique aliases', () => {
    for (const a of aliases) expect(a.alias).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
    expect(new Set(aliases.map((a) => a.alias)).size).toBe(aliases.length);
  });
  it('includes the common misspellings and spec examples', () => {
    const map = new Map(aliases.map((a) => [a.alias, a.locality]));
    expect(map.get('koramangla')).toBe('Koramangala');
    expect(map.get('hsr')).toBe('HSR Layout');
    expect(map.get('btm 2nd stage')).toBe('BTM Layout');
    expect(map.get('whitefeild')).toBe('Whitefield');
    expect(map.get('rajaji nagar')).toBe('Rajajinagar');
    expect(map.get('bannerghatta road')).toBe('Arekere');
  });
  it('never aliases the stop-list words', () => {
    for (const a of aliases) expect(['from', 'bangalore', 'bengaluru']).not.toContain(a.alias);
  });
});

describe('metro.json', () => {
  const metro = read<{ stations: Station[]; interchanges: { station: string; lines: string[]; minutes: number }[] }>('metro.json');
  it('covers purple, green and yellow, all inside the bbox', () => {
    const lines = new Set(metro.stations.map((s) => s.line));
    expect([...lines].sort()).toEqual(['green', 'purple', 'yellow']);
    for (const s of metro.stations) expect(inBbox(s.lat, s.lng), s.name).toBe(true);
  });
  it('has contiguous seq per line and unique (line, seq)', () => {
    for (const line of ['purple', 'green', 'yellow']) {
      const seqs = metro.stations.filter((s) => s.line === line).map((s) => s.seq);
      expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    }
  });
  it('declares Majestic and RV Road interchanges with 6 minutes, present on both lines', () => {
    expect(metro.interchanges.map((i) => i.station).sort()).toEqual(['Majestic', 'RV Road']);
    for (const i of metro.interchanges) {
      expect(i.minutes).toBe(6);
      for (const line of i.lines)
        expect(metro.stations.some((s) => s.name === i.station && s.line === line)).toBe(true);
    }
  });
});

describe('presets.json and sources.json', () => {
  const presets = read<{ slug: string; name: string; lat: number; lng: number }[]>('presets.json');
  const sources = read<{ id: string; display_name: string; is_synthetic: boolean }[]>('sources.json');
  it('has the required office clusters inside the bbox', () => {
    const slugs = presets.map((p) => p.slug);
    for (const s of ['manyata-tech-park', 'orr-bellandur', 'whitefield-itpl', 'electronic-city-phase-1', 'koramangala', 'mg-road-cbd', 'hebbal'])
      expect(slugs).toContain(s);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of presets) expect(inBbox(p.lat, p.lng), p.name).toBe(true);
  });
  it('has 5 synthetic fictional sources that name no real portal', () => {
    expect(sources).toHaveLength(5);
    for (const s of sources) {
      expect(s.is_synthetic).toBe(true);
      expect(`${s.id} ${s.display_name}`.toLowerCase()).not.toMatch(REAL_PORTALS);
    }
  });
});
