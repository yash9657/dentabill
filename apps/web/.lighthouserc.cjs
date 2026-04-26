/**
 * Lighthouse CI config — enforces ADR-020 web vitals budgets in `apps/web`.
 *
 * Authored as `.cjs` so `lhci` (which is CommonJS-only) can `require` it
 * directly. Lives under `apps/web/` so paths are relative to the app, not
 * the repo root.
 *
 * **Budgets** (per ADR-020):
 *   - Performance score      ≥ 0.90
 *   - Accessibility score    = 1.00 (WCAG 2.2 AA — ADR-021; axe-core
 *                              already enforces in Playwright, this is the
 *                              perf-tool counterpart)
 *   - Best-practices         ≥ 0.95
 *   - SEO                    ≥ 0.90
 *   - LCP                    ≤ 2500 ms
 *   - CLS                    ≤ 0.1
 *   - INP / TBT              ≤ 200 ms (TBT is the lab-time proxy for INP;
 *                              real INP shows up only in field data)
 *   - First Contentful Paint ≤ 1500 ms
 *   - Speed Index            ≤ 2500 ms
 *
 * In CI we boot `next start` against the production build and audit only
 * `/` for now — adding marketing pages comes with W2 tasks.
 */

/** @type {import('@lhci/cli').LHCIConfig} */
module.exports = {
  ci: {
    collect: {
      // `lhci` boots its own static-server / start script via the
      // `startServerCommand` option; we let the CI workflow boot
      // `next start` separately so the same build artifact powers the
      // bundle-budget job, then point lhci at it via `url`.
      url: ['http://localhost:3000/'],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        // Skip noisy categories that aren't part of the gate.
        skipAudits: ['uses-http2', 'canonical'],
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 1 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 0.9 }],

        // Core Web Vitals
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 1500 }],
        'speed-index': ['warn', { maxNumericValue: 2500 }],

        // Be strict about layout-shift sources to surface CLS regressions
        // before the aggregate score drifts.
        'unsized-images': 'error',
      },
    },
    upload: {
      // Anonymous public storage on temporary lhci servers. Reports are
      // deleted after a few days; we don't want to keep historical perf
      // dashboards yet (deferred to Phase 5 with the cloud target).
      target: 'temporary-public-storage',
    },
  },
};
