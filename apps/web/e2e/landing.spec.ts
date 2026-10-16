import { expect, test } from '@playwright/test';

const submitText = (t: string | null) => Number((t ?? '').replace(/[^0-9]/g, ''));

test.describe('landing (/)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('counted once');
  });

  test('no horizontal overflow', async ({ page }) => {
    await page.getByTestId('cta-console').scrollIntoViewIfNeeded();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
  });

  test('console count changes when BHK changes', async ({ page }) => {
    const c = page.getByTestId('hero-console');
    const btn = c.getByTestId('hero-console-submit');
    await expect(btn).toContainText(/Search [\d,]+ homes/);
    const before = submitText(await btn.textContent());
    await c.getByRole('radio', { name: '3', exact: true }).click();
    // The first call may compile the count route in dev, so allow longer than the default.
    await expect(btn).not.toHaveText(new RegExp(`Search ${before.toLocaleString('en-IN')} homes`), { timeout: 15_000 });
    const after = submitText(await btn.textContent());
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  test('submitting goes to /homes with matching params', async ({ page }) => {
    const c = page.getByTestId('hero-console');
    await c.getByRole('combobox', { name: 'Locality' }).fill('koram');
    await page.getByRole('option').first().click();
    await c.getByRole('radio', { name: '2', exact: true }).click();
    await c.getByRole('slider', { name: 'Budget, maximum' }).focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await c.getByTestId('hero-console-submit').click();
    await page.waitForURL(/\/homes\?/);
    const q = new URL(page.url()).searchParams;
    expect(q.get('loc')).toBe('koramangala');
    expect(q.get('bhk')).toBe('2');
    expect(Number(q.get('max'))).toBeLessThan(150000);
    expect(q.has('min')).toBe(false);
  });

  test('fair-rent slider changes the badge text', async ({ page }) => {
    const t = page.getByTestId('tryit');
    await t.scrollIntoViewIfNeeded();
    const badge = t.getByTestId('tryit-badge');
    const thumb = t.getByRole('slider', { name: 'Monthly rent' });
    await thumb.focus();
    await page.keyboard.press('End');
    await expect(badge).toHaveText('Overpriced');
    await expect(t.getByTestId('tryit-sentence')).toContainText('above the fair rent');
    await page.keyboard.press('Home');
    await expect(badge).toHaveText('Great deal');
    await expect(t.getByTestId('tryit-sentence')).toContainText('below the fair rent');
  });

  test('deals carousel arrows scroll', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'arrows are hidden on touch layouts; swipe is native');
    const region = page.getByRole('region', { name: 'Deals this week' });
    await region.scrollIntoViewIfNeeded();
    const track = region.getByLabel('Deals this week slides');
    await expect(region.getByRole('group').first()).toBeVisible();
    await region.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);
    await region.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeLessThan(5);
  });

  test('how it works tabs switch', async ({ page }) => {
    const panel = page.getByTestId('how-panel');
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toHaveAttribute('data-tab', 'merged');
    await expect(panel.getByTestId('merged-chip')).toHaveText('Also on 3 sources');
    await page.getByRole('tab', { name: /Ranked/ }).click();
    await expect(panel).toHaveAttribute('data-tab', 'ranked');
    await expect(panel.getByRole('listitem')).toHaveCount(4);
  });

  test('map dot shows a tooltip with the median rent', async ({ page }) => {
    const dot = page.getByTestId('map-dot').first();
    await dot.scrollIntoViewIfNeeded();
    await dot.focus();
    await expect(page.getByTestId('map-tooltip')).toContainText('listings');
  });

  test('locality card links to /homes?loc=', async ({ page }) => {
    const link = page.getByRole('link', { name: 'Bilekahalli' });
    await expect(link.first()).toHaveAttribute('href', /\/homes\?loc=/);
  });
});
