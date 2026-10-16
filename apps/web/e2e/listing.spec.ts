import { expect, test } from '@playwright/test';
import { multiSourceId } from './helpers';

test('home header shows the duplicates-merged number', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('dupes-merged')).toHaveText(/^[\d,]+$/);
  await expect(page.getByTestId('ledger')).toContainText('duplicates merged');
});

test('listing cards link to their page', async ({ page }) => {
  await page.goto('/homes');
  await expect(page.getByTestId('listing-card').first().locator('h3 a')).toHaveAttribute('href', /^\/listing\/[0-9a-f-]{36}$/);
});

test('a multi-source listing shows its sources and a price history', async ({ page }) => {
  const id = await multiSourceId();
  await page.goto(`/listing/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(' in ');
  await expect(page.getByRole('heading', { name: 'Also on 2 sources' })).toBeVisible();
  const rows = page.getByTestId('source-row');
  await expect(rows).toHaveCount(2);
  for (const r of await rows.all()) await expect(r).toContainText('₹');
  await expect(page.getByText(/move-in/i).first()).toBeVisible();
  const chart = page.getByRole('img', { name: /price history/i });
  await expect(chart).toBeVisible();
  expect(await chart.locator('[data-testid="history-point"]').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('gallery')).toBeVisible();
});

test('a malformed id is a 404', async ({ page }) => {
  const res = await page.goto('/listing/not-a-uuid');
  expect(res?.status()).toBe(404);
});

test('an unknown uuid is a 404', async ({ page }) => {
  const res = await page.goto('/listing/00000000-0000-4000-8000-000000000000');
  expect(res?.status()).toBe(404);
});

test('an old id permanently redirects to the current listing', async ({ page, request }) => {
  const { withReadOnly } = await import('@roofline/db');
  const pair = await withReadOnly(async (c) =>
    (await c.query<{ old_id: string; new_id: string }>(
      `SELECT r.old_id, r.new_id FROM listing_redirects r JOIN listings l ON l.id = r.new_id AND l.is_active LIMIT 1`,
    )).rows[0],
  );
  test.skip(!pair, 'no redirects in this dataset');
  const res = await request.get(`/listing/${pair!.old_id}`, { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()['location']).toContain(`/listing/${pair!.new_id}`);
  await page.goto(`/listing/${pair!.old_id}`);
  await expect(page).toHaveURL(new RegExp(`/listing/${pair!.new_id}$`));
});

test('the deposit-not-listed variant reads plainly', async ({ page }) => {
  const { withReadOnly } = await import('@roofline/db');
  const id = await withReadOnly(async (c) =>
    (await c.query<{ id: string }>(`SELECT id FROM listings WHERE is_active AND deposit_inr IS NULL LIMIT 1`)).rows[0]?.id,
  );
  test.skip(!id, 'every listing has a deposit in this dataset');
  await page.goto(`/listing/${id}`);
  await expect(page.getByTestId('cost-card').getByText('Deposit not listed')).toBeVisible();
});
