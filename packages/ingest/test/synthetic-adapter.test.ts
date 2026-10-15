import { describe, expect, it } from 'vitest';
import type { RawListing } from '../src/adapter';
import { createSyntheticAdapters, generateSeed, weekAsOf, SOURCES } from '../src/adapters/synthetic';
import { loadRefs } from './helpers/refs';

const ds = generateSeed(loadRefs());
const adapters = createSyntheticAdapters(ds);
const byKey = new Map(adapters.map((a) => [a.key, a]));

async function fetchAll(key: string, week: number): Promise<RawListing[]> {
  const out: RawListing[] = [];
  for await (const r of byKey.get(key as never)!.fetch({ asOf: weekAsOf(week), signal: new AbortController().signal })) out.push(r);
  return out;
}

describe('SyntheticAdapter', () => {
  it('declares fictional, synthetic, no-image-rights sources with "(demo)" display names', () => {
    expect(adapters.map((a) => a.id)).toEqual(SOURCES.map((s) => s.sourceId));
    for (const a of adapters) {
      expect(a.license).toMatchObject({ kind: 'synthetic', imageRights: 'none' });
      expect(a.displayName).toMatch(/ \(demo\)$/);
    }
  });

  it('serves each row only while it is listed and never repeats an id within a week', async () => {
    for (const w of [0, 13, 25]) {
      const rows = await fetchAll('tamarind', w);
      expect(new Set(rows.map((r) => r.sourceListingId)).size).toBe(rows.length);
      const expected = ds.rows.filter((r) => r.sourceKey === 'tamarind' && r.startWeek <= w && w <= r.endWeek).length;
      expect(rows).toHaveLength(expected);
    }
  });

  it('is a pure lookup: fetching weeks in a different order gives identical payloads', async () => {
    const a = JSON.stringify(await fetchAll('banyan', 10));
    await fetchAll('banyan', 3);
    await fetchAll('banyan', 25);
    expect(JSON.stringify(await fetchAll('banyan', 10))).toBe(a);
  });

  it('shows the new price from the week of the change onward', async () => {
    const row = ds.rows.find((r) => r.versions.length > 1)!;
    const v1 = row.versions[1]!;
    const before = (await fetchAll(row.sourceKey, v1.fromWeek - 1)).find((r) => r.sourceListingId === row.sourceListingId);
    const after = (await fetchAll(row.sourceKey, v1.fromWeek)).find((r) => r.sourceListingId === row.sourceListingId);
    expect(before?.rentText).not.toBe(after?.rentText);
    expect(after).toEqual(v1.listing);
  });

  it('yields nothing for weeks outside the 26-week window and stops when aborted', async () => {
    expect(await fetchAll('tamarind', 26)).toEqual([]);
    expect(await fetchAll('tamarind', -1)).toEqual([]);
    const ctl = new AbortController();
    ctl.abort();
    const out: RawListing[] = [];
    for await (const r of byKey.get('tamarind')!.fetch({ asOf: weekAsOf(0), signal: ctl.signal })) out.push(r);
    expect(out).toEqual([]);
  });

  it('owner-submission rows carry their details only in the free-text description', async () => {
    const rows = await fetchAll('gulmohar', 0);
    expect(rows.length).toBeGreaterThan(50);
    for (const r of rows.slice(0, 50)) {
      expect(r.rentText).toBeUndefined();
      expect(r.bhkText).toBeUndefined();
      expect(r.description).toMatch(/Rent: /);
    }
  });
});
