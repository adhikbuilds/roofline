import { expect } from '@playwright/test';

/** A two-source listing whose canonical row has at least two price observations (history is change-only). */
export async function multiSourceId(): Promise<string> {
  const { withReadOnly } = await import('@roofline/db');
  const id = await withReadOnly(async (c) =>
    (await c.query<{ id: string }>(
      `SELECT l.id FROM listings l
        WHERE l.is_active AND l.source_count = 2 AND l.member_count = 2
          AND (SELECT count(*) FROM price_observations p WHERE p.source_listing_id = l.canonical_source_listing_id) >= 2
        ORDER BY l.id LIMIT 1`,
    )).rows[0]?.id,
  );
  expect(id, 'dataset has a two-source listing with price history').toBeTruthy();
  return id!;
}
