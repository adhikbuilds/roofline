import { describe, expect, it } from 'vitest';
import type { RawListing, SourceAdapter } from '../src/adapter';

const dummy: SourceAdapter = {
  id: 'csv:dummy',
  displayName: 'Dummy feed',
  license: { kind: 'licensed-feed', terms: 'test only', attributionRequired: true, imageRights: 'licensed-copy' },
  async *fetch({ signal }) {
    if (signal.aborted) return;
    const row: RawListing = {
      sourceListingId: '1',
      rentText: '₹25,000',
      pg: { sharingText: 'double' },
      photos: [{ seed: 'a' }],
    };
    yield row;
  },
};

describe('SourceAdapter types', () => {
  it('compiles with a dummy adapter and yields RawListings', async () => {
    const out: RawListing[] = [];
    for await (const l of dummy.fetch({ asOf: new Date(0), signal: new AbortController().signal })) out.push(l);
    expect(out).toHaveLength(1);
    expect(out[0]?.sourceListingId).toBe('1');
  });

  it('rejects hotlink image rights at the type level', () => {
    const bad: SourceAdapter['license'] = {
      kind: 'synthetic',
      terms: '',
      attributionRequired: false,
      // @ts-expect-error 'hotlink' must not exist as an imageRights value
      imageRights: 'hotlink',
    };
    expect(bad).toBeDefined();
  });
});
