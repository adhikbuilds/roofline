import { expect, test } from '@playwright/test';

test('homes shows a card grid with load more, or the empty state', async ({ page }) => {
  await page.goto('/homes');
  const cards = page.getByTestId('listing-card');
  const count = await cards.count();
  if (count === 0) {
    await expect(page.getByTestId('homes-empty')).toBeVisible();
    return;
  }
  expect(count).toBeLessThanOrEqual(24);
  await expect(cards.first()).toContainText('₹');
  await expect(cards.first().getByTestId('fairness-ruler')).toBeVisible();
  if (count === 24) await expect(page.getByRole('button', { name: 'Load more homes' })).toBeVisible();
});

test('homes tolerates garbage params', async ({ page }) => {
  const res = await page.goto('/homes?page=abc&bhk=zzz&sort=nope&min=-1&cursor=%00');
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('homes-count')).toBeVisible();
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
