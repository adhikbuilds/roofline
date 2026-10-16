import { expect, test } from '@playwright/test';

// Hydration mismatches surface as console errors; reduced motion (the project default) is where Reveal once diverged.
for (const route of ['/', '/homes', '/deals']) {
  test(`${route} logs no console errors or page errors`, async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text().slice(0, 200)));
    page.on('pageerror', (e) => problems.push(e.message.slice(0, 200)));
    await page.goto(route);
    await page.locator('main[data-ready="true"]').waitFor();
    await page.waitForTimeout(500);
    expect(problems, problems.join(' || ')).toEqual([]);
  });
}
