import { defineConfig } from 'vitest/config';

// Root config only covers scripts/test; packages run their own vitest via `pnpm -r test`.
// Both patterns are listed because `test:scripts` runs with `--root scripts`.
export default defineConfig({
  test: { include: ['test/**/*.test.ts', 'scripts/test/**/*.test.ts'] },
});
