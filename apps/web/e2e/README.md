# `apps/web/e2e/` — Playwright suites

End-to-end tests live here, separate from the Vitest unit/integration
suites under `src/**`. The split mirrors the test pyramid in ADR-025:

- **Vitest** — unit + integration tests close to the source. jsdom env.
- **Playwright** (this dir) — full-browser e2e + axe-core a11y + visual
  regression. Real Chromium/WebKit/Firefox.

## Running locally

```bash
# First time: install browsers (cached at ~/Library/Caches/ms-playwright on macOS).
pnpm --filter @dentabill/web exec playwright install --with-deps

# Run everything (auto-boots `next dev`).
pnpm --filter @dentabill/web exec playwright test

# Single project, single file.
pnpm --filter @dentabill/web exec playwright test --project=chromium landing

# Update visual baselines (after an intentional UI change). Diff goes through code review.
pnpm --filter @dentabill/web exec playwright test --update-snapshots

# Targeted run while iterating; opens browser, freezes on failure.
pnpm --filter @dentabill/web exec playwright test --headed --debug
```

## Authoring conventions

- Import from `./fixtures.js`, not `@playwright/test` directly. The
  fixture export gives you `makeAxeBuilder()` (WCAG 2.2 AA preconfig)
  and `consoleErrors` (an array auto-populated with any
  `console.error()` or uncaught page error during the test).
- Visual snapshots: prefer `await page.evaluate(() => document.fonts.ready)`
  before screenshotting so the comparison is deterministic.
- `expect.toHaveScreenshot()` thresholds are tight (0.1% pixel-ratio,
  0.1 per-pixel) per ADR-022. Don't loosen them locally — fix the test
  or update the baseline intentionally.
- Test files are `*.spec.ts` (not `*.test.ts`) so Vitest's
  `*.test.{ts,tsx}` glob doesn't accidentally match them.

## CI

The `e2e` job in `.github/workflows/ci.yml` runs the matrix against a
production-style `next start` build. Browsers are cached across runs by
the Playwright version key. Only chromium runs on CI by default to keep
the gate fast; webkit + firefox are nightly (TBD).
