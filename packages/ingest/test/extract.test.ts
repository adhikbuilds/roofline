import { describe, expect, it } from 'vitest';
import { extractFromDescription } from '../src/pipeline/extract';

describe('extractFromDescription', () => {
  it('pulls Key: value segments out of an owner description', () => {
    const d =
      'Quiet street, good sunlight. Rent: ₹42,000 per month; Deposit: 3 months; Maintenance: ₹2,500; Area: 1,100 sq.ft; ' +
      'Furnishing: Semi-Furnished; BHK: 2 BHK; Locality: Indiranagar; Floor: 3/5; Facing: east; Parking: bike & car.';
    expect(extractFromDescription(d)).toEqual({
      rentText: '₹42,000 per month',
      depositText: '3 months',
      maintenanceText: '₹2,500',
      areaText: '1,100 sq.ft',
      furnishingText: 'Semi-Furnished',
      bhkText: '2 BHK',
      localityText: 'Indiranagar',
      floorText: '3/5',
      facingText: 'east',
      parkingText: 'bike & car',
    });
  });

  it('handles the structured-source tail (floor, facing, parking only)', () => {
    expect(extractFromDescription('Clean rooms. Floor: 2/4; Facing: north west; Parking: none.')).toEqual({
      floorText: '2/4', facingText: 'north west', parkingText: 'none',
    });
  });

  it.each([undefined, null, '', 42, 'no structured text here'])('returns {} for %s', (v) => {
    expect(extractFromDescription(v)).toEqual({});
  });

  it('keeps the first occurrence and ignores empty values', () => {
    expect(extractFromDescription('Rent: 10000; Rent: 20000; Area: ; Floor: 1/2.')).toEqual({ rentText: '10000', floorText: '1/2' });
  });
});
