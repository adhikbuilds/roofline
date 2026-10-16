import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { multiSourceId } from './helpers';

/** Let entrance animations (opacity fades) finish so contrast is measured on settled colours. */
async function settle(page: import('@playwright/test').Page) {
  await page.locator('main[data-ready="true"]').waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await page.waitForTimeout(700);
}

/** Top deal by the same ordering /deals uses: first listing link on the page. */
async function topDealPath(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/deals');
  const href = await page.locator('a[href^="/listing/"]').first().getAttribute('href');
  expect(href, '/deals links to a listing').toBeTruthy();
  return href!;
}

const STATIC = ['/', '/homes', '/deals'];

for (const route of STATIC) {
  test(`@a11y ${route} has no serious or critical axe violations`, async ({ page }) => {
    await page.goto(route);
    await settle(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  });
}

test('@a11y /listing/[id] has no serious or critical axe violations', async ({ page }) => {
  await page.goto(`/listing/${await multiSourceId()}`);
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
});

test('@a11y top-deal listing has no serious or critical axe violations', async ({ page }) => {
  await page.goto(await topDealPath(page));
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
});
