import { expect, test } from '@playwright/test';
import { multiSourceId } from './helpers';

test.describe('listing detail', () => {
  test('lightbox opens and closes with the keyboard and returns focus', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'desktop gallery grid');
    await page.goto(`/listing/${await multiSourceId()}`);
    const main = page.getByTestId('gallery-main');
    await main.focus();
    await page.keyboard.press('Enter');
    const box = page.getByTestId('lightbox');
    await expect(box).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(box).toContainText('2 /');
    await page.keyboard.press('Escape');
    await expect(box).toBeHidden();
    await expect(main).toBeFocused();
  });

  test('gallery, facts, fair panel, sources, history, cost card and similar render', async ({ page }) => {
    await page.goto(`/listing/${await multiSourceId()}`);
    await expect(page.getByTestId('gallery')).toBeVisible();
    await expect(page.getByTestId('facts')).toBeVisible();
    await expect(page.getByTestId('fair-panel')).toBeVisible();
    await expect(page.getByTestId('source-row')).toHaveCount(2);
    await expect(page.getByRole('img', { name: /price history/i })).toBeVisible();
    await expect(page.getByTestId('contact-button')).toBeDisabled();
    await expect(page.getByTestId('similar')).toBeAttached();
  });

  test('Save persists to localStorage', async ({ page }) => {
    const id = await multiSourceId();
    await page.goto(`/listing/${id}`);
    const save = page.getByTestId('save-button');
    // the click can land before hydration; retry until the handler is attached
    await expect(async () => {
      await save.click();
      await expect(save).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
    }).toPass();
    expect(await page.evaluate(() => localStorage.getItem('roofline:saved'))).toContain(id);
    await page.reload();
    await expect(page.getByTestId('save-button')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('shell', () => {
  test('mobile menu traps focus, closes on Escape and returns focus', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await page.goto('/deals');
    const opener = page.getByRole('button', { name: 'Open menu' });
    await opener.click();
    const menu = page.getByTestId('mobile-menu');
    await expect(menu).toBeVisible();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="mobile-menu"]'))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="mobile-menu"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('demo banner is shown first, and dismissal persists', async ({ page }) => {
    await page.goto('/deals');
    const note = page.getByRole('note');
    await expect(note).toContainText('Demo data');
    await expect(async () => {
      await page.getByRole('button', { name: 'Dismiss demo data notice' }).click({ timeout: 1000 });
      await expect(note).toBeHidden({ timeout: 500 });
    }).toPass();
    await page.reload();
    await expect(page.getByRole('note')).toHaveCount(0);
  });

  test('header is solid off the landing page and the footer has four columns', async ({ page }) => {
    await page.goto('/deals');
    await expect(page.getByTestId('site-header')).toHaveAttribute('data-transparent', 'false');
    const foot = page.getByRole('navigation', { name: 'Footer' });
    for (const h of ['Product', 'Data', 'Company', 'Legal']) await expect(foot.getByRole('heading', { name: h })).toBeVisible();
    await expect(page.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeVisible();
  });

  test('@overflow listing detail at the project viewport', async ({ page }) => {
    await page.goto(`/listing/${await multiSourceId()}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const o = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
    expect(o).toBeLessThanOrEqual(0);
  });
});
