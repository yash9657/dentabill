# Session Context

_Last updated: 2026-04-29 (autonomous burst)_

## What was just done

**Phase 3 W2 + early W3 landed in one autonomous burst.** Nine PRs merged this session covering the full call-worker spine and the start of the API surface:

- PR #80 — P3-T10 call-job handler (8 integration tests)
- PR #81 — P3-T11 IVR navigator (pure-logic, 27 tests)
- PR #82 — P3-T12 hold detector + reschedule resolver (9 tests)
- PR #85 — P3-T13 per-call duration cap → DLQ + MANUAL_REVIEW (9 tests)
- PR #86 — P3-T14 DLQ consumer drains `calls-dlq` (9 tests)
- PR #87 — P3-T15 full lifecycle e2e (real BullMQ + Postgres + FakeRetell, 3 tests)
- PR #88 — P3-T16 `POST /v1/claims/:id/calls` enqueue route + queue plugin + business-hours guard (9 tests)
- PR #89 — P3-T17 `POST /v1/webhooks/retell` HMAC-SHA256 verify + RetellWebhookEvent replay table (9 tests)

W2 (call worker) is fully closed. W3 (API) is in flight on branch `phase-3/api-calls-list` covering **T18 + T19 + T20 in one PR**: `GET /v1/calls` (cursor-paginated list, status/payer/date filters), `GET /v1/calls/:id` (detail with embedded events + claim summary), `POST /v1/calls/:id/cancel` (idempotent soft-cancel — DB marker only). 11 new tests added to `calls.test.ts`; typecheck green; tests passing locally. **One residual lint error** at `apps/api/src/routes/v1/calls.ts` ~line 452:59 ("Use a ! assertion to more succinctly remove null and undefined from the type") needs to be resolved before the commit lands.

Stacked-PR pattern lessons: when a base branch is auto-deleted on merge, GitHub auto-closes any dependent PR. Recovery is rebase-onto-main + force-push + open fresh PR (used for #83→#85, #84→#86).

## Current state of the repo

- Branch in flight: `phase-3/api-calls-list` (P3-T18 + T19 + T20). Working tree dirty: `apps/api/src/routes/v1/calls.ts` + `calls.test.ts`. One persistent lint error.
- `dentabill_test` Postgres has the `phase3_retell_webhook_event` migration applied alongside the earlier Phase 3 migration.
- Phase 3 next-task pointer (after T18-T20 PR lands): **P3-T21 — SDK regen** (`pnpm gen:sdk` re-emits `packages/api-sdk` for the four new endpoints; SDK contract test asserts `openapi.json` matches generated TS). Then W4 UI: T22 Call-Now Pill → T23 live indicator → T24 `/dashboard/calls` page → T25 KPI tiles. Then W5 observability (T26-T28) + W6 closeout (T29-T30).

## Next task

**Resolve the residual lint error in `apps/api/src/routes/v1/calls.ts` near line 452, then commit + push + PR for T18/T19/T20.** Likely cause: the cursor narrowing where `rows[query.limit - 1]` returns `Call | undefined` and ESLint's `non-nullable-type-assertion-style` rule prefers `!` while `no-non-null-assertion` forbids it. Approaches in order of preference: (a) restructure the cursor logic so the access yields a non-nullable type via length check + explicit `if`/early return; (b) extract another tiny helper; (c) targeted `// eslint-disable-next-line @typescript-eslint/no-non-null-assertion` with a one-line WHY comment if the rule conflict is genuinely irreducible. Verify with `pnpm turbo run typecheck lint test --filter=@dentabill/api`. Commit message: `feat(api): calls list/detail/cancel endpoints (P3-T18/T19/T20)`.

After PR merges: **P3-T21 SDK regen** on branch `phase-3/api-sdk-refresh`.

P2-T52 (`PRODUCT.md` via `$impeccable teach`) is still deferred to the user.

## Open questions / ambiguities

- **Phase 3 schema gap: no `subscriberId` on Claim.** The handler currently passes `claim.claimNumber` as the `agentMetadata.subscriberId` placeholder. Payer reps can usually locate a claim by claimNumber + DOS, but a real subscriber ID column on Claim should land in Phase 4. Document in DECISIONS.md when it does.
- **Cancel endpoint is soft-only in Phase 3.** `POST /v1/calls/:id/cancel` writes the DB marker (status=FAILED, dlqReason=CANCELLED_BY_OPERATOR, Claim → MANUAL_REVIEW, CallEvent type=CANCELLED) but the live Retell call continues until natural termination because the API has no RetellPort handle. Phase 4 needs a true cancel channel — either a Redis pub/sub topic the worker subscribes to, or a `Call.cancelRequestedAt` column the worker polls each turn of `waitForCallEnd`. Capture in an ADR when implemented.
- **Stuck-`CALLING` recovery.** If `RetellPort.startCall` throws after the Claim has already transitioned to `CALLING` and BullMQ exhausts retries, the claim is stuck `CALLING` until the DLQ consumer (P3-T14) runs. The runbook (P3-T28) needs a one-paragraph recovery psql for this exact case.
- The merge-commit-on-shared-`TASKS.md` pain documented in ADR-030 §5 is the one rough edge to address early in Phase 3.
- Branch protection on `main` still not enabled in the GitHub UI.

## Trap to avoid

Regenerating Linux visual snapshots in `mcr.microsoft.com/playwright:v1.59.1-noble`
with `-v "$PWD:/work"` shares the host's `node_modules` with the container.
`pnpm install` and `prisma generate` inside the container overwrite the host's
Prisma engine (Linux replaces darwin-arm64) and `next build` leaves stale `.next/`
artifacts. When the host dev servers restart, `apps/api` throws
`PrismaClientInitializationError: could not locate the Query Engine for runtime
"darwin-arm64"` and `apps/web` throws `Cannot find module './1971.js'`. Recovery:
`pnpm --filter @dentabill/db exec prisma generate && rm -rf apps/web/.next`. Better:
isolate the container's pnpm store with a separate volume on next snapshot run.

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
