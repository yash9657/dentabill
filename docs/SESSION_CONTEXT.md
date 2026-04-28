# Session Context

_Last updated: 2026-04-29 (Phase 3 closeout)._

## What was just done

**Phase 3 — Queue + Voice — COMPLETE.** All 31 tasks (T0 + T30) merged across PRs #80–#99 in one autonomous execution burst. The platform now places real outbound calls via Retell, navigates payer IVRs via DTMF per PRD §6, persists structured `Call` + `CallEvent` rows, and surfaces the live phase to the operator through the dashboard. The muted-teal status accent (`oklch(0.78 0.04 200)`) — locked in ADR-013 and dormant since Phase 2 — finally activates for `IN_QUEUE` / `CALLING`.

W0 ADR cluster (ADR-031 → ADR-040) + Phase 3 retro ADR-041 = 11 new ADRs in `docs/DECISIONS.md`. 41 total.

## Current state of the repo

- Branch in flight: `phase-3/docs-closeout` — this PR (T30). PRs #95 (T25), #96 (T26), #97 (T27), #98 (T28), #99 (T29) all in CI or merged depending on order; this closeout PR depends on none of them functionally.
- The web bundle invariant (no `@dentabill/db` from `apps/web`) is preserved — every Phase 3 UI surface consumes `@dentabill/api-sdk` only.
- `dentabill_test` Postgres has every Phase 3 migration applied; CI runs the full lifecycle e2e against real BullMQ + real Postgres + `FakeRetell`.

## Next task

**P4-T0 — Phase 4 ADR cluster.** Phase 4 (Intelligence + Realtime + Billing) is the natural next phase. The ADRs that should land in P4-T0 (per ADR-041 retrospective):

1. **`SummarizerPort`** mirroring `RetellPort` — `summarize(callId)` → structured outcome; `FakeClaude` for CI; `LiveClaude` wrapping `@anthropic-ai/sdk`. Land before any code that calls Claude.
2. **Stripe metered billing** — wired off the existing `audit()` spine: iterate `AuditLog` rows with `action='call.end'` whose Claim transitioned to RESOLVED in the billing window, sum recovered $, post a usage record.
3. **Clerk Organizations migration** — retire the synthetic `clerkOrgId="local_<userId>"` (ADR-031) with a `User → DentaBillUser` reconciliation pass _before_ the org-switch UI.
4. **`Claim.subscriberId` schema migration** — retire the `claim.claimNumber` placeholder used by P3-T10's agent metadata. Aetna in particular needs the subscriber id verbatim.
5. **Live transcript SSE surface** — `/dashboard/calls/[id]` transcript view as Server-Sent Events. Now that we have transcript text from Phase 3, the Phase 4 deferral from ADR-034 expires.

After ADRs land: Phase 4 W1 (queue + summarizer + DB schema). The exact task list will land in the same PR as the ADR cluster.

**Carry-over (deferred, user-driven):** P2-T52 — `PRODUCT.md` via `$impeccable teach`. Interactive skill, cannot be done autonomously.

## Open questions / ambiguities

- **Cancel endpoint is soft-only in Phase 3.** `POST /v1/calls/:id/cancel` writes the DB marker (status=FAILED, dlqReason=CANCELLED_BY_OPERATOR, Claim → MANUAL_REVIEW, CallEvent type=CANCELLED) but the live Retell call continues until natural termination because the API has no `RetellPort` handle. Phase 4 needs a true cancel channel — either a Redis pub/sub topic the worker subscribes to, or a `Call.cancelRequestedAt` column the worker polls each turn of `waitForCallEnd`. Capture in an ADR when implemented.
- **Phase 3 schema gap: no `subscriberId` on Claim.** P3-T10 currently passes `claim.claimNumber` as the `agentMetadata.subscriberId` placeholder. Most payer reps locate a claim by `claimNumber + DOS` so the agents work, but the semantic mismatch is a Phase 4 schema migration (covered above).
- **API + call-worker test DB concurrency.** Both suites truncate the same Postgres test DB; running them in parallel under turbo intermittently trips the webhook-replay test on the unique-on-`eventId` constraint. CI sidesteps this (separate jobs); local turbo doesn't. Fix in Phase 4 (per-suite schema namespaces).
- **Empty-string env defaults bit twice in Phase 3.** Bandaid landed in `vitest.setup.ts` and `apps/api/scripts/dump-openapi.mts`. Real fix: env loader normalises empty strings to `undefined` at the boundary. Phase 4 cleanup ticket.
- **Branch protection on `main`** still not enabled in the GitHub UI.
- **Retell + Anthropic credentials** still placeholder in `.env.example`. Populate before any Phase 4 task that hits live Claude.

## Trap to avoid

When a PR is part of a stacked chain (its base is another phase-3 branch, not `main`), GitHub's "delete branch on merge" auto-closes every dependent PR. Recovery: rebase the dependent branch onto `main` + force-push + open a fresh PR. Phase 4 should land squashed PRs against `main` directly — no stacking unless the dependency is genuinely sequential.

## Do not forget

- One task at a time. Tests are part of the task, not a follow-up.
- Update this file + `TASKS.md` + `PROGRESS.md` + `DECISIONS.md` (ADRs only) at end of every session.
- Status-active teal (`oklch(0.78 0.04 200)`) is the **only** chromatic surface allowed in the system per ADR-013. Phase 3 unlocked it for `IN_QUEUE` / `CALLING` — keep it scarce.
- Visual regression baselines are per-OS — when changing landing visuals, regenerate **both** `landing-chromium-darwin.png` (locally) and `landing-chromium-linux.png` (in `mcr.microsoft.com/playwright:v1.59.1-noble`) so CI doesn't fail.
- API tests use `process.env[k] ??= v` defaults in `vitest.setup.ts` — when adding new required env vars to `getEnv()`, also add them to `TEST_DEFAULTS` so CI stays green. (Phase 4 should fix the empty-string slip-through at the loader.)
- For org-scoped `update`/`delete` on Prisma we use `updateMany`/`deleteMany` with composite `where {id, organizationId}` because the write middleware enforces `organizationId` on the write path while Prisma's unique-where signature for `update` does not include it.
- Patient DOB is on disk only as `patientDOBHash` (org-scoped + secret-keyed SHA-256 from T45) + last-4 of birth year. Cleartext DOB never lands.
- No em dashes in user copy; no card grids; no side-stripe banners; no glassmorphism (Impeccable design laws + ADR-013 visual lock).
- The web bundle invariant (no `@dentabill/db` from `apps/web`) is **load-bearing** — every UI feature must consume `@dentabill/api-sdk` only. Phase 3 preserved this; Phase 4 must too.
