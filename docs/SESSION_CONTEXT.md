# Session Context

_Last updated: 2026-04-25 (late evening)_

## What was just done

**Phase 2 W1 foundation gates: complete (16/16). Total Phase 2 progress: 17/55 tasks merged to `main`.**

This session, in dependency order, the merges since the morning checkpoint:

1. **P2-T12** — `apps/api` Fastify v5 scaffold with ZodTypeProvider, request-id, structured logger, CORS, rate-limit, `/v1/healthz` + `/v1/readyz`. PR #23.
2. **P2-T15** — `react-hook-form` + `@hookform/resolvers` Zod resolver wired into `@dentabill/ui` Form component. PR #24.
3. **P2-T7** — Playwright + axe foundation. `apps/web/e2e/`, base fixture, axe-core integration, per-OS visual snapshots, 0.1% diff threshold; new `e2e` job in `ci.yml`. PR #25.
4. **P2-T9** — Bundle budget enforcement. `@next/bundle-analyzer` + custom CI assertion script (≤200 KB initial JS per route, ≤350 KB total). PR #26.
5. **P2-T8** — Lighthouse CI via `treosh/lighthouse-ci-action`. Budgets per ADR-020 (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms, perf ≥ 90, a11y = 100). PR #27.
6. **P2-T16** — Web observability: `web-vitals` reporter with `sendBeacon` + `keepalive` fallback, `<ErrorBoundary>` posting to `/v1/errors`, `x-request-id` propagation via `<meta>` + fetch wrapper. PR #28.
7. **P2-T13** — OpenAPI spec generated from Zod via `@fastify/swagger` + `jsonSchemaTransform`; typed `@dentabill/api-sdk` codegen via `openapi-typescript` + `openapi-fetch`. PR #29.
8. **P2-T14 (this PR)** — TanStack Query v5 setup at `@dentabill/ui/query`. `DENTABILL_QUERY_DEFAULTS` (30s staleTime, 5min gcTime, retry 3 with exp backoff capped at 30s, `throwOnError` true for boundary integration, mutations no retry to avoid double-sending claims). `<QueryProvider>` with lazy-loaded devtools (dev-only chunk). Wired into `apps/web` via a Client `<Providers>` wrapper.
   - **Bundled CI hardening**:
     - `apps/api/vitest.setup.ts` seeds test defaults (DATABASE_URL/REDIS_URL/NEXT_PUBLIC_APP_URL/NEXT_PUBLIC_API_URL) via `process.env[k] ??= v` so tests are hermetic against missing CI env vars (the `test` job didn't export `NEXT_PUBLIC_APP_URL`, crashing T13's PR).
     - Added `landing-chromium-linux.png` Playwright baseline (generated in a clean Docker container) so visual regression passes on Ubuntu CI runners.

Test totals after this session: `@dentabill/ui` 138/138, `@dentabill/web` ~25/25, `@dentabill/api` 10/10 (with empty env), `@dentabill/db` 30/30.

## Current state of the repo

- Branch in flight: `phase-2/web-tanstack-query`. After merge, `main` has 17 squashed Phase 2 commits.
- New deps in `@dentabill/ui`: `@tanstack/react-query@^5.62.0`, `@tanstack/react-query-devtools@^5.62.0`. New subpath export `./query`.
- New deps in `apps/web`: none added by T14 — uses workspace `@dentabill/ui/query` re-export.
- All quality gates green: typecheck / lint / test / build / prettier / Playwright (5 chromium tests).
- W1 foundation gates 16/16 complete: tokens, Tailwind preset, shadcn primitives, brand primitives, web scaffold, security headers, Playwright + axe + visual, Lighthouse, bundle budget, eslint a11y/react, eslint tailwind (deferred to prettier), Fastify scaffold, OpenAPI + SDK, TanStack Query, Forms foundation, web observability.

## Next task

**Phase 2 W2 marketing site begins, OR jump to W3 critical path.** Two viable next moves:

1. **W2 critical path: P2-T17 — Marketing chrome.** Header (sticky white, pill CTA), Footer (multi-column), CookieBanner, NewsletterSignupStub. Estimate 2h. Branch `phase-2/marketing-chrome`. Depends on T4 (✓). Unblocks all 9 marketing pages T18–T26.
2. **W3 critical path: P2-T28 — Clerk integration.** `<ClerkProvider>` themed via tokens, `clerkMiddleware()` protecting `/dashboard/**`. Estimate 2h. Depends on T5 (✓), T6 (✓). Unblocks T29–T31 auth flow and W5 API auth middleware (T37).

Recommendation: **start T17** so the W2 lane runs in parallel while W3 (auth) is prepped — the critical path through to T51 (CSV upload UI) goes via W3+W4+W5+W6, but marketing is naturally parallel-friendly.

## Open questions / ambiguities

- Branch protection on `main` still not enabled in the GitHub UI.
- Lighthouse CI runs against a `next start` preview but doesn't yet reflect the `<QueryProvider>` overhead — should remain well under budget (devtools is dev-only) but worth watching after T17 lands real marketing UI.

## Do not forget

- One task at a time. Tests are part of the task, not a follow-up.
- Update this file + `TASKS.md` + `PROGRESS.md` + `DECISIONS.md` (ADRs only) at end of every session.
- `@dentabill/ui` ships sources directly. `@dentabill/ui/query` is a separate subpath export so marketing pages don't pull TanStack Query into their bundles.
- Status-active teal (`oklch(0.78 0.04 200)`) is the **only** chromatic surface allowed in the system per ADR-013.
- Visual regression baselines are per-OS — when changing landing visuals, regenerate **both** `landing-chromium-darwin.png` (locally) and `landing-chromium-linux.png` (in `mcr.microsoft.com/playwright:v1.59.1-noble`) so CI doesn't fail.
- API tests use `process.env[k] ??= v` defaults in `vitest.setup.ts` — when adding new required env vars to `getEnv()`, also add them to `TEST_DEFAULTS` so CI stays green.
