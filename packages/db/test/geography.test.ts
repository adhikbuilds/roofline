import { describe, expect, it } from 'vitest';
import { parseEwkbPoint } from '../src/schema/custom.js';

// ST_AsEWKB(ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)) as little-endian hex
function ewkbHex(lng: number, lat: number, srid = true): string {
  const b = Buffer.alloc(srid ? 25 : 21);
  b.writeUInt8(1, 0);
  b.writeUInt32LE(srid ? 0x20000001 : 1, 1);
  let o = 5;
  if (srid) { b.writeUInt32LE(4326, o); o += 4; }
  b.writeDoubleLE(lng, o);
  b.writeDoubleLE(lat, o + 8);
  return b.toString('hex');
}

describe('parseEwkbPoint', () => {
  it('decodes an EWKB point with SRID', () => {
    expect(parseEwkbPoint(ewkbHex(77.6245, 12.9352))).toEqual({ lat: 12.9352, lng: 77.6245 });
  });
  it('decodes a plain WKB point without SRID', () => {
    expect(parseEwkbPoint(ewkbHex(77.5, 13.0, false))).toEqual({ lat: 13.0, lng: 77.5 });
  });
  it('rejects non-point or truncated input', () => {
    expect(() => parseEwkbPoint('00')).toThrow();
    expect(() => parseEwkbPoint('')).toThrow();
  });
});
