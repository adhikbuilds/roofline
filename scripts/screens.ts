/**
 * pnpm screens <phase> [route]
 * Writes docs/screens/phase-N.png (1440 wide, full page) and phase-N-mobile.png (390x844) from a running dev server.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2];
const route = process.argv[3] ?? '/';
const base = process.env.ROOFLINE_BASE_URL ?? 'http://localhost:3000';

if (!phase || !/^\d+[a-z0-9-]*$/i.test(phase)) {
  console.error('usage: pnpm screens <phase> [route]');
  process.exit(2);
}

const out = join(root, 'docs', 'screens');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
try {
  for (const [suffix, viewport, fullPage] of [
    ['', { width: 1440, height: 900 }, true],
    ['-mobile', { width: 390, height: 844 }, false],
  ] as const) {
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.route('**/tiles.openfreemap.org/**', (r) =>
      r.fulfill({ path: join(root, 'apps/web/e2e/fixtures/map-style.json'), contentType: 'application/json' }),
    );
    await page.goto(new URL(route, base).toString(), { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-ready="true"]', { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    const file = join(out, `phase-${phase}${suffix}.png`);
    await page.screenshot({ path: file, fullPage });
    console.log(`wrote ${file}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
