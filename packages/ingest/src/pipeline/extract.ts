/**
 * Deterministic free-text extraction. Owner submissions carry their details only in the description as
 * `Key: value; Key: value.` segments. This is a rules-based extractor (no LLM) that fills fields the
 * structured payload left empty.
 */
export interface Extracted {
  rentText?: string;
  depositText?: string;
  maintenanceText?: string;
  areaText?: string;
  bhkText?: string;
  furnishingText?: string;
  localityText?: string;
  floorText?: string;
  facingText?: string;
  parkingText?: string;
}

const KEYS: Record<string, keyof Extracted> = {
  rent: 'rentText',
  deposit: 'depositText',
  maintenance: 'maintenanceText',
  area: 'areaText',
  bhk: 'bhkText',
  furnishing: 'furnishingText',
  locality: 'localityText',
  floor: 'floorText',
  facing: 'facingText',
  parking: 'parkingText',
};

const SEGMENT = /(?:^|[.;]\s+|\s)(Rent|Deposit|Maintenance|Area|BHK|Furnishing|Locality|Floor|Facing|Parking):\s*([^;]*?)(?=;\s|\.?\s*$|;$)/g;

export function extractFromDescription(description: unknown): Extracted {
  const out: Extracted = {};
  if (typeof description !== 'string' || description === '') return out;
  for (const m of description.matchAll(SEGMENT)) {
    const key = KEYS[(m[1] ?? '').toLowerCase()];
    const value = (m[2] ?? '').trim().replace(/\.$/, '');
    if (key && value !== '' && out[key] === undefined) out[key] = value;
  }
  return out;
}
