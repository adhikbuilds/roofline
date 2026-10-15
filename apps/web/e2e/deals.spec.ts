import { expect, test } from '@playwright/test';

test('every deal row says how far below fair rent and how many comps', async ({ page }) => {
  await page.goto('/deals');
  const rows = page.getByTestId('deal-row');
  const n = await rows.count();
  expect(n, 'seeded data has deals; run pnpm db:fresh and pnpm model:fit').toBeGreaterThan(0);
  for (const r of await rows.all()) {
    const reason = r.getByTestId('deal-reason');
    await expect(reason).toContainText('below fair rent');
    await expect(reason).toContainText('comps');
    await expect(r.getByTestId('fairness-ruler')).toBeVisible();
  }
  await expect(page.locator('body')).not.toContainText(/verified/i);
});

test('the locality filter narrows the feed', async ({ page }) => {
  await page.goto('/deals');
  const select = page.getByLabel('Locality');
  const options = await select.locator('option').evaluateAll((o) => o.map((x) => ({ v: (x as HTMLOptionElement).value, t: x.textContent ?? '' })));
  const pick = options.find((o) => o.v);
  expect(pick, 'at least one locality has a deal').toBeTruthy();
  await select.selectOption(pick!.v);
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(new RegExp(`locality=${pick!.v}`));
  const rows = page.getByTestId('deal-row');
  expect(await rows.count()).toBeGreaterThan(0);
  for (const r of await rows.all()) await expect(r).toContainText(pick!.t);
});

test('the BHK filter narrows the feed', async ({ page }) => {
  await page.goto('/deals?bhk=2');
  const rows = page.getByTestId('deal-row');
  const n = await rows.count();
  if (n === 0) {
    await expect(page.getByTestId('deals-empty')).toBeVisible();
    return;
  }
  for (const r of await rows.all()) await expect(r).toContainText('2 BHK');
});

test('bad filter values are ignored and the full feed shows', async ({ page }) => {
  await page.goto('/deals');
  const all = await page.getByTestId('deal-row').count();
  const res = await page.goto("/deals?bhk=abc&locality=x'%20OR%201=1--");
  expect(res?.status()).toBe(200);
  expect(await page.getByTestId('deal-row').count()).toBe(all);
  await page.goto('/deals?locality=not-a-real-place');
  expect(await page.getByTestId('deal-row').count()).toBe(all);
});

test('a filter with no matches shows an honest empty state', async ({ page }) => {
  // 6 BHK is valid input but no deal exists for it in the seed.
  await page.goto('/deals?bhk=6');
  await expect(page.getByTestId('deals-empty')).toContainText('No deals match these filters');
  await expect(page.getByTestId('deal-row')).toHaveCount(0);
});

test('a deal links to a listing page with its ruler, interval and explanation', async ({ page }) => {
  await page.goto('/deals');
  await page.getByTestId('deal-row').first().getByRole('link').first().click();
  await expect(page).toHaveURL(/\/listing\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('fair-panel').getByTestId('fairness-ruler')).toBeVisible();
  await expect(page.getByTestId('fair-interval')).toContainText('to');
  await expect(page.getByTestId('fair-explanation')).not.toBeEmpty();
  await expect(page.getByTestId('fair-badge')).toBeVisible();
});

test('a low-confidence listing says there are not enough comparable listings and shows no badge', async ({ page }) => {
  const { withReadOnly } = await import('@roofline/db');
  const id = await withReadOnly(async (c) =>
    (await c.query<{ id: string }>(`SELECT id FROM listings WHERE is_active AND confidence = 'low' ORDER BY id LIMIT 1`)).rows[0]?.id,
  );
  test.skip(!id, 'no low-confidence listing in this dataset');
  await page.goto(`/listing/${id}`);
  await expect(page.getByTestId('fair-unavailable')).toContainText('Not enough comparable listings');
  await expect(page.getByTestId('fair-badge')).toHaveCount(0);
  await expect(page.getByTestId('fairness-ruler')).toHaveCount(0);
});

test('home rows carry a badge and ruler or the not-enough-comps note', async ({ page }) => {
  await page.goto('/');
  const rows = page.getByTestId('listing-row');
  for (const r of (await rows.all()).slice(0, 10)) {
    const hasRuler = await r.getByTestId('fairness-ruler').count();
    const noVerdict = await r.getByTestId('no-verdict').count();
    expect(hasRuler + noVerdict).toBe(1);
  }
});
