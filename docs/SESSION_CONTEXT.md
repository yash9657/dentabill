# Session Context

_Last updated: 2026-04-26 (late afternoon)_

## What was just done

**Phase 2 substantively complete: 54 of 55 tasks merged across 52 PRs.** The final substantive PR (T51, /dashboard/claims/import upload UI) merged earlier today. W7 closeout is in flight — this PR ships ADR-030 (retro), the DESIGN.md final pass replacing the TBD font picks with the ADR-013 lock, and these doc updates.

W6 ingestion pipeline summary (the final lane): T43 upload endpoint → T44 streaming parser (Dentrix / Eaglesoft / Open Dental detection + per-source schemas) → T45 DOB hashing helper → T46 payer-name canonicalisation → T47 PRD §5 priority scoring → T48 bulk insert with `(organizationId, claimNumber)` idempotency and DB-asserting integration tests (T49 satisfied here) → T50 fixtures → T51 drag-drop upload UI.

Across Phase 2 we shipped: 9 marketing pages, full Clerk auth flow, dashboard shell with sidebar/topbar/overview/page-stubs, claims router with cursor pagination + state machine + manual-edit UI, full CSV ingestion + bulk insert with cross-org leak guards, 7-gate CI on every PR, ADRs 013–030.

## Current state of the repo

- Branch in flight: `phase-2/docs-closeout`. After merge, `main` has 52 squashed Phase 2 commits.
- All quality gates green: typecheck / lint / test / build / prettier / Playwright (chromium) / axe / Lighthouse / bundle budget / CodeQL / GitGuardian.
- Test totals: api 54, db 56, ui 138+, web 193, payer-ivr 21, types 14, db.audit + with-org integration covered.
- Bundle: every authenticated route ≤ 200 KB first-load JS. Marketing routes ≤ 170 KB.
- New ADRs since checkpoint: ADR-029 (terms-template), ADR-030 (Phase 2 retro).

## Next task

**P2-T52 (deferred to user) — `PRODUCT.md` via `$impeccable teach`.** This is the only Phase 2 task that requires interactive skill invocation; it cannot be done autonomously. The user runs `$impeccable teach` from the repo root in Claude Code, walks through the bootstrap dialog, and commits the resulting `PRODUCT.md`. After that lands, Phase 2 is officially closed and Phase 3 (Queue + Voice — BullMQ workers, Retell wiring, IVR navigation) can open.

In the meantime: this PR (`phase-2/docs-closeout`) lands the doc closeout. After it merges, `main` is in a green steady-state ready for Phase 3 task generation.

## Open questions / ambiguities

- None blocking. The merge-commit-on-shared-`TASKS.md` pain documented in ADR-030 §5 is the one rough edge to address early in Phase 3.
- Branch protection on `main` still not enabled in the GitHub UI.

## Do not forget

- One task at a time. Tests are part of the task, not a follow-up.
- Update this file + `TASKS.md` + `PROGRESS.md` + `DECISIONS.md` (ADRs only) at end of every session.
- Status-active teal (`oklch(0.78 0.04 200)`) is the **only** chromatic surface allowed in the system per ADR-013.
- Visual regression baselines are per-OS — when changing landing visuals, regenerate **both** `landing-chromium-darwin.png` (locally) and `landing-chromium-linux.png` (in `mcr.microsoft.com/playwright:v1.59.1-noble`) so CI doesn't fail.
- API tests use `process.env[k] ??= v` defaults in `vitest.setup.ts` — when adding new required env vars to `getEnv()`, also add them to `TEST_DEFAULTS` so CI stays green.
- Claim PATCH's `audit()` records `metadata.clerkUserId` (Clerk userId is not yet FK to DentaBill `User.id` — that lands in Phase 4).
- For org-scoped `update`/`delete` on Prisma we use `updateMany`/`deleteMany` with composite `where {id, organizationId}` because the write middleware enforces `organizationId` on the write path while Prisma's unique-where signature for `update` does not include it.
- Patient DOB is on disk only as `patientDOBHash` (org-scoped + secret-keyed SHA-256 from T45) + last-4 of birth year. Cleartext DOB never lands.
- No em dashes in user copy; no card grids; no side-stripe banners; no glassmorphism (Impeccable design laws + ADR-013 visual lock).
