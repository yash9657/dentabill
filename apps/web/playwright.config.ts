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
  /**
   * Pre-warm the routes the suite exercises so `next dev`'s lazy
   * route compilation does not race the per-assertion timeout on
   * slower runners. See `e2e/global-setup.ts`.
   */
  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /**
   * 0.1% threshold per ADR-022. `maxDiffPixelRatio` is fraction-based;
   * `threshold` controls per-pixel similarity. Both kept tight.
   *
   * `expect.timeout` is bumped from the 5 s default to 15 s because
   * `next dev` on the GHA `ubuntu-latest` runner takes longer to
   * stream RSC payloads than a fast developer laptop — even after
   * warming routes, a `toHaveURL` after `router.push()` can take a
   * few seconds on first hit. 15 s keeps tests fast on a healthy
   * machine and tolerant on a slow one.
   */
  expect: {
    timeout: 15_000,
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
 * Local: spin up `next dev` if no PLAYWRIGHT_BASE_URL is provided. CI
 * uses the same dev server (the build step still runs to gate-check
 * compilation, but Playwright runs against `pnpm dev` like local).
 */
if (!process.env.PLAYWRIGHT_BASE_URL) {
  config.webServer = {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  };
}

export default defineConfig(config);
