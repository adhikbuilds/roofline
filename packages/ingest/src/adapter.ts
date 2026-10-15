/** SourceAdapter contract (PLAN §4.5). Adapters must not fetch from any site without a written licence. */

export interface SourceAdapter {
  readonly id: string; // 'tamarind' | 'csv:<feed>' | 'owner'
  readonly displayName: string;
  readonly license: {
    kind: 'synthetic' | 'licensed-feed' | 'owner-submitted';
    terms: string; // human-readable licence summary
    attributionRequired: boolean;
    imageRights: 'none' | 'licensed-copy' | 'owner-uploaded'; // never 'hotlink'
  };
  fetch(ctx: { asOf: Date; since?: Date; signal: AbortSignal }): AsyncIterable<RawListing>;
}

export interface RawListing {
  sourceListingId: string;
  url?: string;
  postedAt?: string;
  title?: string;
  description?: string;
  rentText?: string;
  depositText?: string;
  maintenanceText?: string;
  areaText?: string;
  bhkText?: string;
  furnishingText?: string;
  localityText?: string;
  lat?: number;
  lng?: number;
  pg?: { sharingText?: string; foodText?: string; genderText?: string };
  tags?: string[];
  photos?: { seed?: string; storageKey?: string; dhash?: string }[];
}
