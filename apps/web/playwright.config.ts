import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.ROOFLINE_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: BASE_URL, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
