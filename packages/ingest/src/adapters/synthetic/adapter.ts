import type { RawListing, SourceAdapter } from '../../adapter';
import type { SeedDataset, SeedRow } from './generate';
import { weekIndexOf, SOURCES, type SourceKey } from './params';

const DISPLAY: Record<SourceKey, string> = {
  tamarind: 'NestLane (demo)',
  banyan: 'RentBarn (demo)',
  peepal: 'KeyLoft (demo)',
  jacaranda: 'DoorVale (demo)',
  gulmohar: 'HearthGrid (demo)',
};

/** Serves one fictional source's slice of the pre-generated timeline. Fetching is a pure lookup. */
export class SyntheticAdapter implements SourceAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly license = {
    kind: 'synthetic' as const,
    terms: 'Fictional demo source. Generated data, no real listings.',
    attributionRequired: true,
    imageRights: 'none' as const,
  };
  private readonly rows: SeedRow[];

  constructor(dataset: SeedDataset, readonly key: SourceKey) {
    const src = SOURCES.find((s) => s.key === key);
    if (!src) throw new Error(`unknown synthetic source ${key}`);
    this.id = src.sourceId;
    this.displayName = DISPLAY[key];
    this.rows = dataset.rows.filter((r) => r.sourceKey === key);
  }

  async *fetch({ asOf, signal }: { asOf: Date; since?: Date; signal: AbortSignal }): AsyncIterable<RawListing> {
    const week = weekIndexOf(asOf);
    for (const row of this.rows) {
      if (signal.aborted) return;
      if (week < row.startWeek || week > row.endWeek) continue;
      let current = row.versions[0];
      for (const v of row.versions) if (v.fromWeek <= week) current = v;
      if (current) yield current.listing;
    }
  }
}

export function createSyntheticAdapters(dataset: SeedDataset): SyntheticAdapter[] {
  return SOURCES.map((s) => new SyntheticAdapter(dataset, s.key));
}
