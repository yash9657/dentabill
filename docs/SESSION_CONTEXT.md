# Session Context

_Last updated: 2026-04-26 (mid-day)_

## What was just done

**Phase 2 progress: 39/55 merged to `main`. P2-T40 in flight on branch `phase-2/api-claim-state`.**

Recent merges (since previous checkpoint at T14):

- **W2 marketing site (T17–T27, PRs #31–#41)** — chrome, landing, about, pricing, security, privacy, terms, contact, faq, blog skeleton, e2e suite.
- **W3 auth + onboarding (T28–T31, PRs #42, #43, #49, #50)** — Clerk integration with conditional gating (no key → no provider mount), themed sign-in/up, /onboarding form with payer selection, auth navigation e2e.
- **W4 dashboard shell (T32–T36, PRs #44–#48)** — layout shell, sidebar nav, topbar with cmd-k + notifications stubs, overview, settings tabs.
- **W5 API + claims domain (T37–T39, PRs #51–#53)** — Clerk-aware auth plugin (test-header bypass when no Clerk keys), `/v1/claims` CRUD with `getOrgScopedDb` + `audit()` on reads, cursor pagination (base64url `${sortValue}|${id}`), status/payer/search/sort filters.

**T40 progress (uncommitted):**

- Created `apps/api/src/lib/claim-state.ts` — `CLAIM_STATE_TRANSITIONS` map + `isValidClaimTransition()`. Self-transitions allowed; RESOLVED + WRITTEN_OFF terminal.
- Created `apps/api/src/lib/claim-state.test.ts` — 6 unit tests (self-transitions, happy path, terminals, illegal jumps, denial path, FAILED retry). All pass.
- Modified `apps/api/src/routes/v1/claims.ts` — PATCH handler now reads `existing.status`, validates `(from, to)` against the map, throws `INVALID_STATE_TRANSITION` (409) on violations.
- Modified `packages/types/src/api-error.ts` — new `INVALID_STATE_TRANSITION` code mapped to 409.
- Added 3 integration tests in `apps/api/src/routes/v1/claims.test.ts` covering: illegal jump (PENDING → CALLING) returns 409, terminal block (RESOLVED is reached then re-open rejected), self-transition allowed when other fields change.
- Verification: typecheck + lint + 35 vitest tests all green locally (against real Postgres via docker compose).

## Current state of the repo

- Branch in flight: `phase-2/api-claim-state`. Not yet committed / pushed.
- All quality gates green locally for the api package.
- 39 squashed Phase 2 commits on `main`. Phase 2 critical path through to T51 (CSV upload UI) goes via T40 → T41 → T42 → W6 (T43–T51) → W7 closeout.

## Next task

**Finish P2-T40 (in flight):** commit, push, open PR, watch CI to green, merge.

After T40 merges, **P2-T41** is next on critical path: `/dashboard/claims` UI page. TanStack Query hooks generated from the SDK (T13), virtualized table (TanStack Virtual), filter chips, search input, click-through to detail. Estimate 3h. Branch `phase-2/web-claims-list`.

## Open questions / ambiguities

- None blocking. CI patterns are stable: turbo env passthrough is fixed, `--concurrency=1` in test step prevents cross-package DB races, visual baseline pattern (drop linux baseline → CI fails → grab artifact PNG → commit) is well-rehearsed.
- Branch protection on `main` still not enabled in the GitHub UI.

## Do not forget

- One task at a time. Tests are part of the task, not a follow-up.
- Update this file + `TASKS.md` + `PROGRESS.md` + `DECISIONS.md` (ADRs only) at end of every session.
- Status-active teal (`oklch(0.78 0.04 200)`) is the **only** chromatic surface allowed in the system per ADR-013.
- Visual regression baselines are per-OS — when changing landing visuals, regenerate **both** `landing-chromium-darwin.png` (locally) and `landing-chromium-linux.png` (in `mcr.microsoft.com/playwright:v1.59.1-noble`) so CI doesn't fail.
- API tests use `process.env[k] ??= v` defaults in `vitest.setup.ts` — when adding new required env vars to `getEnv()`, also add them to `TEST_DEFAULTS` so CI stays green.
- Claim PATCH's `audit()` records `metadata.clerkUserId` (Clerk userId is not yet FK to DentaBill `User.id` — that lands in Phase 4).
- For org-scoped `update`/`delete` on Prisma we use `updateMany`/`deleteMany` with composite `where {id, organizationId}` because the write middleware enforces `organizationId` on the write path while Prisma's unique-where signature for `update` does not include it.
- No em dashes in user copy; no card grids; no side-stripe banners; no glassmorphism (Impeccable design laws).
