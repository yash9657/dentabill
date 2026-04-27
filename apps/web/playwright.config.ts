import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

/**
 * Playwright config for `apps/web`.
 *
 * **What this enforces (ADR-021 / ADR-022 / ADR-025):**
 *   - Three browser projects so DentaBill renders correctly in the engines
 *     billers actually use: Chromium (Chrome / Edge), WebKit (Safari),
 *     and Firefox.
 *   - Per-OS visual snapshot baselines under `e2e/__screenshots__/<test>-<project>-<platform>.png`.
 *     Threshold tightened to **0.1% pixel diff** — a stray font weight or
 *     a 1px shift fails the build, which is the point.
 *   - axe-core integration is registered per-test (see `e2e/fixtures.ts`)
 *     rather than as a global afterEach, so a test can opt into a
 *     restricted scope when needed.
 *   - Web server auto-boot via `next dev`. CI uses `next start` against a
 *     pre-built bundle for a more production-like surface (see CI yaml).
 *
 * Tests live in `apps/web/e2e/` (NOT `src/**`), so Vitest's
 * `*.test.{ts,tsx}` runner doesn't pick them up. We additionally exclude
 * `e2e/**` from `vitest.config.ts`.
 */

const config: PlaywrightTestConfig = {
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI && { workers: 2 }),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /**
   * 0.1% threshold per ADR-022. `maxDiffPixelRatio` is fraction-based;
   * `threshold` controls per-pixel similarity. Both kept tight.
   */
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      threshold: 0.1,
      animations: 'disabled',
    },
    toMatchAriaSnapshot: {
      pathTemplate: '{testFileDir}/__aria-snapshots__/{arg}{ext}',
    },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
};

/**
 * Web server selection:
 *   - `PLAYWRIGHT_BASE_URL` set    → assume the operator started a server
 *     elsewhere; Playwright connects directly.
 *   - CI                           → `next start` against the pre-built
 *     bundle (the `Build Next.js app` step in `.github/workflows/ci.yml`
 *     runs first). This avoids on-demand `next dev` route compilation —
 *     the dev server compiles each route on its first hit, which can
 *     take 10–30s and time out a 5s `toHaveURL`. It also matches the
 *     surface used to regenerate visual snapshots, so the production
 *     and snapshot-baseline rendering stay in lockstep.
 *   - Local (no CI)                → `next dev` for fast HMR while
 *     developing tests.
 */
if (!process.env.PLAYWRIGHT_BASE_URL) {
  config.webServer = {
    command: process.env.CI ? 'pnpm start' : 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  };
}

export default defineConfig(config);
