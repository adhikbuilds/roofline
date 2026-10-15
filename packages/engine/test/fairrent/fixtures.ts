import type { FlatInput, FitListing, PgInput, Zone } from '../../src/fairrent/types';

export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const LOCS: Array<{ id: number; zone: Zone; eff: number }> = [
  { id: 1, zone: 'central', eff: 0.1 },
  { id: 2, zone: 'central', eff: -0.05 },
  { id: 3, zone: 'east', eff: 0.04 },
  { id: 4, zone: 'east', eff: -0.03 },
  { id: 5, zone: 'south', eff: 0.0 },
  { id: 6, zone: 'south', eff: 0.06 },
];
const ZONE_EFF: Record<string, number> = { central: 0.25, east: 0, south: 0.1 };
const BHK_EFF: Record<number, number> = { 1: 0, 2: 0.4, 3: 0.85 };
const TYP: Record<number, number> = { 1: 600, 2: 1000, 3: 1500 };
export const FURN_EFF = { furnished: Math.log(1.18), semi: 0, unfurnished: Math.log(0.9) };
export const AREA_EXP = 0.35;

/** Noise-free log rent of the synthetic world. */
export function truthLog(f: Pick<FlatInput, 'localityId' | 'bhk' | 'areaSqft' | 'furnishing'>): number {
  const loc = LOCS.find((l) => l.id === f.localityId)!;
  return (
    10 + ZONE_EFF[loc.zone]! + loc.eff + BHK_EFF[f.bhk]! +
    AREA_EXP * Math.log((f.areaSqft ?? TYP[f.bhk]!) / TYP[f.bhk]!) +
    (f.furnishing ? FURN_EFF[f.furnishing] : 0)
  );
}

export function syntheticFlats(n: number, seed = 7, sigma = 0.03): { rows: FlatInput[]; truth: Map<string, number> } {
  const rnd = lcg(seed);
  const rows: FlatInput[] = [];
  const truth = new Map<string, number>();
  const furns = ['furnished', 'semi', 'unfurnished'] as const;
  for (let i = 0; i < n; i++) {
    const loc = LOCS[Math.floor(rnd() * LOCS.length)]!;
    const bhk = 1 + Math.floor(rnd() * 3);
    const furnishing = furns[Math.floor(rnd() * 3)]!;
    const areaSqft = Math.round(TYP[bhk]! * (0.8 + 0.4 * rnd()));
    const t = truthLog({ localityId: loc.id, bhk, areaSqft, furnishing });
    const noise = (rnd() + rnd() + rnd() - 1.5) * 2 * sigma;
    const id = `f-${String(i).padStart(4, '0')}`;
    rows.push({
      kind: 'flat', id, localityId: loc.id, zone: loc.zone, unitKind: 'bhk', bhk, furnishing, areaSqft,
      rentInr: Math.round(Math.exp(t + noise)), parking: i % 5 === 0 ? 'car' : null,
      tags: i % 4 === 0 ? ['Lift'] : [], floor: i % 9, totalFloors: 12,
    });
    truth.set(id, Math.exp(t));
  }
  return { rows, truth };
}

export function syntheticPgs(n: number): PgInput[] {
  const rnd = lcg(99);
  return Array.from({ length: n }, (_, i) => ({
    kind: 'pg', id: `p-${i}`, localityId: 1 + (i % 3), zone: 'central' as Zone,
    sharing: 'double' as const, food: i % 2 === 0, rentInr: 8000 + Math.round(rnd() * 2000),
  }));
}

export const ALL = (n: number): FitListing[] => [...syntheticFlats(n).rows, ...syntheticPgs(20)];
