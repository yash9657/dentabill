/**
 * Root Vitest workspace. Aggregates per-package vitest configs so a single
 * `vitest run` command at the repo root runs every workspace's tests in
 * one process — used locally and in CI.
 *
 * Per-package configs live in `apps/<x>/vitest.config.ts` and
 * `packages/<x>/vitest.config.ts` and all extend `@dentabill/config/vitest`.
 */
export default ['./apps/*/vitest.config.ts', './packages/*/vitest.config.ts'];
