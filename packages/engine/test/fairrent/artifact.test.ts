import { describe, expect, it } from 'vitest';
import { parseArtifact } from '../../src/fairrent/artifact';
import { fitHedonic } from '../../src/fairrent/hedonic';
import { fitRobustMedian } from '../../src/fairrent/robust-median';
import { ENGINE_VERSION } from '../../src/version';
import { ALL } from './fixtures';

const ASOF = '2026-01-01T00:00:00.000Z';
const rows = ALL(200);
const rm = fitRobustMedian(rows, { asOf: ASOF });
const hd = fitHedonic(rows, { asOf: ASOF, pg: rm.pg });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = <T>(a: T): any => JSON.parse(JSON.stringify(a));

describe('ENGINE_VERSION', () => {
  it('is 0.3.0', () => expect(ENGINE_VERSION).toBe('0.3.0'));
});

describe('parseArtifact', () => {
  it('accepts both artifact kinds after a JSON round trip', () => {
    expect(parseArtifact(clone(rm))).toEqual(rm);
    expect(parseArtifact(clone(hd))).toEqual(hd);
    expect(parseArtifact(clone(rm)).kind).toBe('robust_median');
    expect(parseArtifact(clone(hd)).kind).toBe('hedonic');
  });
  it.each([null, undefined, 3, 'x', [], {}])('rejects non-artifact %j', (v) => {
    expect(() => parseArtifact(v)).toThrow(/artifact/i);
  });
  it('rejects an unknown schema', () => {
    expect(() => parseArtifact({ ...clone(hd), schema: 'other' })).toThrow(/schema/);
  });
  it('rejects an unknown schemaVersion', () => {
    expect(() => parseArtifact({ ...clone(hd), schemaVersion: 2 })).toThrow(/schemaVersion/);
    expect(() => parseArtifact({ ...clone(rm), schemaVersion: 0 })).toThrow(/schemaVersion/);
  });
  it('rejects an unknown kind', () => {
    expect(() => parseArtifact({ ...clone(hd), kind: 'neural' })).toThrow(/kind/);
  });
  it('rejects a bad header', () => {
    expect(() => parseArtifact({ ...clone(hd), fitIds: [1, 2] })).toThrow(/fitIds/);
    expect(() => parseArtifact({ ...clone(hd), asOf: 5 })).toThrow(/asOf/);
    expect(() => parseArtifact({ ...clone(hd), counts: { flats: 'a', pg: 1 } })).toThrow(/counts/);
    expect(() => parseArtifact({ ...clone(rm), engineVersion: undefined })).toThrow(/engineVersion/);
  });
  it('rejects inconsistent hedonic payloads', () => {
    const a = clone(hd);
    expect(() => parseArtifact({ ...a, beta: a.beta.slice(1) })).toThrow(/beta/);
    expect(() => parseArtifact({ ...a, cholL: a.cholL.slice(1) })).toThrow(/cholL/);
    expect(() => parseArtifact({ ...a, penalized: a.penalized.slice(1) })).toThrow(/penalized/);
    expect(() => parseArtifact({ ...a, huberScale: 'x' })).toThrow(/huberScale/);
    expect(() => parseArtifact({ ...a, pg: undefined })).toThrow(/pg/);
    const b = clone(hd);
    b.beta[3] = null; // what JSON makes of NaN
    expect(() => parseArtifact(b)).toThrow(/beta/);
  });
  it('rejects inconsistent robust-median payloads', () => {
    const a = clone(rm);
    expect(() => parseArtifact({ ...a, flat: undefined })).toThrow(/flat/);
    const b = clone(rm);
    b.flat.cells.l1[Object.keys(b.flat.cells.l1)[0]!].n = 'many';
    expect(() => parseArtifact(b)).toThrow(/cell|n/);
    expect(() => parseArtifact({ ...a, constants: null })).toThrow(/constants/);
  });
});
