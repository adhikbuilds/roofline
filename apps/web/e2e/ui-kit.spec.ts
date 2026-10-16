import { expect, test } from '@playwright/test';

test.describe('ui kit (/dev/ui)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/ui');
    await expect(page.getByTestId('dev-ui')).toBeVisible();
  });

  test('no horizontal overflow', async ({ page }) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
  });

  test('combobox: type, arrow, enter selects', async ({ page }) => {
    const box = page.getByRole('combobox', { name: 'Locality' });
    await box.click();
    await box.fill('indi');
    await expect(page.getByRole('option').first()).toContainText('Indiranagar');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('playground-state')).toContainText('loc=indiranagar');
  });

  test('segmented control moves with arrow keys', async ({ page }) => {
    await page.getByRole('radio', { name: '2', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('playground-state')).toContainText('bhk=3');
  });

  test('range slider thumbs respond to the keyboard', async ({ page }) => {
    const before = await page.getByTestId('range-label').textContent();
    await page.getByRole('slider', { name: 'Budget, maximum' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('range-label')).not.toHaveText(before!);
  });

  test('lightbox: opens, arrows navigate, Esc closes and returns focus', async ({ page }) => {
    const opener = page.getByRole('button', { name: 'Open photo' }).first();
    await opener.focus();
    await page.keyboard.press('Enter');
    const lb = page.getByTestId('lightbox');
    await expect(lb).toBeVisible();
    await expect(lb).toContainText('1 /');
    await page.keyboard.press('ArrowRight');
    await expect(lb).toContainText('2 /');
    await page.keyboard.press('ArrowLeft');
    await expect(lb).toContainText('1 /');
    // focus stays trapped
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid=lightbox]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(lb).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('listing card: photo (or placeholder), verdict chip, heart toggles, links to the listing', async ({ page }) => {
    const card = page.getByTestId('listing-card').first();
    // Real photos once the manifest is filled; the placeholder when it is empty.
    await expect(card.locator('img, [data-testid="photo-placeholder"]').first()).toBeVisible();
    const heart = card.getByRole('button', { name: 'Save listing' });
    await heart.click();
    await expect(card.getByRole('button', { name: 'Remove from saved' })).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByRole('link').first()).toHaveAttribute('href', /\/listing\/[0-9a-f-]{36}/);
  });

  test('carousel arrows page the track', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'arrows are hidden on touch widths');
    const region = page.getByRole('region', { name: 'Top deals' });
    await region.scrollIntoViewIfNeeded();
    const track = region.getByLabel('Top deals slides');
    await region.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => track.evaluate((e) => e.scrollLeft)).toBeGreaterThan(50);
  });

  test('count API reflects filters', async ({ request }) => {
    const all = await (await request.get('/api/v1/listings/count')).json();
    const two = await (await request.get('/api/v1/listings/count?bhk=2&kind=flat')).json();
    expect(two.count).toBeGreaterThan(0);
    expect(two.count).toBeLessThan(all.count);
    expect((await request.get('/api/v1/listings/count?bhk=99')).status()).toBe(400);
  });
});
