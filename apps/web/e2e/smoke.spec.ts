import { expect, test } from '@playwright/test';
import { multiSourceId } from './helpers';
import { ROUTES } from './routes';

test('home shows the brand shell and the demo-data notice', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Roofline/);
  await expect(page.getByRole('note')).toContainText('Demo data');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Every rental in Bangalore, counted once.');
  await expect(page.locator('main[data-ready="true"]')).toBeVisible();
});

test('health endpoint reports ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(['dataMode', 'dataVersion', 'db', 'engineVersion', 'ok']);
  expect(body.ok).toBe(true);
  expect(body.db).toBe(true);
  expect(typeof body.engineVersion).toBe('string');
  expect(body.dataMode).toBe('synthetic');
  // the active model run id (stages 6-7 run in db:fresh)
  expect(Number.isInteger(body.dataVersion)).toBe(true);
});

for (const route of ROUTES) {
  test(`@overflow ${route} has no horizontal scroll`, async ({ page }) => {
    let path: string = route;
    if (route.includes('[id]')) {
      path = `/listing/${await multiSourceId()}`;
    }
    await page.goto(path);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.scrollingElement!.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}
