import { expect, test } from '@playwright/test';

const cards = (page: import('@playwright/test').Page) => page.getByTestId('listing-card');
const total = async (page: import('@playwright/test').Page) =>
  Number(((await page.getByTestId('homes-count').textContent()) ?? '').replace(/,/g, '').match(/\d+/)![0]);

test('a BHK chip updates the URL and every card matches', async ({ page }) => {
  await page.goto('/homes');
  const all = await total(page);
  await page.getByTestId('chip-bhk-2').click();
  await expect(page).toHaveURL(/bhk=2/);
  await expect(page.getByTestId('chip-bhk-2')).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => total(page)).toBeLessThan(all);
  const n = await cards(page).count();
  expect(n).toBeGreaterThan(0);
  for (const c of await cards(page).all()) await expect(c).toContainText('2 BHK');
});

test('verdict and budget chips combine and back restores the previous results', async ({ page }) => {
  await page.goto('/homes');
  const all = await total(page);
  await page.getByTestId('chip-verdict-great_deal').click();
  await expect(page).toHaveURL(/verdict=great_deal/);
  const afterVerdict = await total(page);
  await page.getByTestId('chip-budget-15-30').click();
  await expect(page).toHaveURL(/min=15000&max=30000/);
  await expect.poll(() => total(page)).toBeLessThanOrEqual(afterVerdict);
  for (const c of await cards(page).all()) await expect(c.getByTestId('verdict-chip')).toContainText('Great deal');
  await page.goBack();
  await expect(page).not.toHaveURL(/min=/);
  await expect(page).toHaveURL(/verdict=great_deal/);
  await expect.poll(() => total(page)).toBe(afterVerdict);
  await page.goBack();
  await expect(page).not.toHaveURL(/verdict=/);
  await expect.poll(() => total(page)).toBe(all);
});

test('sort by rent orders the first cards', async ({ page }) => {
  await page.goto('/homes');
  await page.getByLabel('Sort by').selectOption('rent_up');
  await expect(page).toHaveURL(/sort=rent_up/);
  await expect(page.getByLabel('Sort by')).toHaveValue('rent_up');
  await expect.poll(async () => (await cards(page).count()) > 0).toBe(true);
  const rents = (await cards(page).locator('p.type-display').allTextContents()).map((t) => Number(t.replace(/[^\d]/g, '')));
  expect(rents.length).toBeGreaterThan(1);
  expect(rents).toEqual([...rents].sort((a, b) => a - b));
});

test('load more appends the next page without duplicates', async ({ page }) => {
  await page.goto('/homes?sort=new');
  const first = await cards(page).count();
  expect(first).toBe(24);
  await page.getByTestId('load-more').click();
  await expect(cards(page)).toHaveCount(48);
  const hrefs = await cards(page).locator('h3 a').evaluateAll((a) => a.map((x) => (x as HTMLAnchorElement).getAttribute('href')));
  expect(new Set(hrefs).size).toBe(hrefs.length);
  await expect(page.getByTestId('homes-progress')).toContainText('Showing 48 of');
});

test('load more respects the filters and ends cleanly', async ({ page }) => {
  await page.goto('/homes?bhk=4plus');
  const n = await total(page);
  test.skip(n > 24 * 5, 'too many rows to exhaust in a test');
  while (await page.getByTestId('load-more').count()) {
    await page.getByTestId('load-more').click();
    await page.waitForTimeout(150);
  }
  await expect(cards(page)).toHaveCount(n);
});

test('every card carries a verdict chip or the not-enough-comps note, plus a heart', async ({ page }) => {
  await page.goto('/homes');
  for (const c of (await cards(page).all()).slice(0, 12)) {
    const chip = await c.getByTestId('verdict-chip').count();
    const note = await c.getByText('Not enough comparable listings').count();
    expect(chip + note).toBeGreaterThan(0);
    await expect(c.getByRole('button', { name: /save listing/i })).toBeVisible();
  }
});

test('the heart persists in local storage', async ({ page }) => {
  await page.goto('/homes');
  const heart = cards(page).first().getByRole('button', { name: 'Save listing' });
  await heart.click();
  await expect(cards(page).first().getByRole('button', { name: 'Remove from saved' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(cards(page).first().getByRole('button', { name: 'Remove from saved' })).toBeVisible();
});

test('garbage params are dropped: same results as the unfiltered page', async ({ page }) => {
  await page.goto('/homes');
  const all = await total(page);
  const res = await page.goto("/homes?bhk=abc&loc=x'%20OR%201=1--&min=zzz&verdict=meh&furn=lava&kind=castle&sort=zzz");
  expect(res?.status()).toBe(200);
  expect(await total(page)).toBe(all);
});

test('a filter with no matches shows an honest empty state with a way out', async ({ page }) => {
  await page.goto('/homes?bhk=rk&min=140000&verdict=overpriced&furn=furnished');
  await expect(page.getByTestId('homes-empty')).toContainText('No homes match these filters');
  await page.getByRole('link', { name: 'Clear all filters' }).click();
  await expect(page).toHaveURL(/\/homes$/);
  await expect(cards(page).first()).toBeVisible();
});

test('a removable pill clears just that filter', async ({ page }) => {
  await page.goto('/homes?bhk=2,3');
  await page.getByRole('link', { name: 'Remove filter: 2 BHK' }).click();
  await expect(page).toHaveURL(/bhk=3(&|$)/);
});

test('copy never uses the banned word', async ({ page }) => {
  await page.goto('/homes');
  await expect(page.locator('body')).not.toContainText(/verified/i);
});
