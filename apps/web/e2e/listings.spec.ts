import { expect, test } from '@playwright/test';

test('home shows ledger counts and either listing rows or the empty state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('ledger')).toContainText(/listings from .* sources/);
  const rows = page.getByTestId('listing-row');
  const count = await rows.count();
  if (count === 0) {
    await expect(page.getByText('No listings loaded yet')).toBeVisible();
    return;
  }
  expect(count).toBeLessThanOrEqual(40);
  await expect(rows.first()).toContainText('₹');
  await expect(rows.first().getByText(/move-in/i)).toBeVisible();
  if (count === 40) await expect(page.getByRole('link', { name: 'Next page' })).toBeVisible();
});

test('home tolerates a garbage page param', async ({ page }) => {
  const res = await page.goto('/?page=abc');
  expect(res?.status()).toBe(200);
});

test('localities table lists all 69 localities', async ({ page }) => {
  await page.goto('/localities');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Localities');
  await expect(page.getByRole('columnheader', { name: 'Median 2BHK rent' })).toBeVisible();
  await expect(page.getByTestId('locality-row')).toHaveCount(69);
});

test('plate route returns a deterministic svg', async ({ request }) => {
  const a = await request.get('/img/plate/demo-seed-1');
  expect(a.status()).toBe(200);
  expect(a.headers()['content-type']).toContain('image/svg+xml');
  const body = await a.text();
  expect(body).toContain('<svg');
  const b = await request.get('/img/plate/demo-seed-1');
  expect(await b.text()).toBe(body);
  const c = await request.get('/img/plate/other-seed');
  expect(await c.text()).not.toBe(body);
});

for (const bad of ['Bad_Seed', 'UPPER', 'a.b', 'x'.repeat(65), 'a%20b']) {
  test(`plate route rejects seed ${bad.slice(0, 12)}`, async ({ request }) => {
    const res = await request.get(`/img/plate/${bad}`);
    expect(res.status()).toBe(400);
  });
}
