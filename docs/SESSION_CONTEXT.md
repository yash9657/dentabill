# Session Context

_Last updated: 2026-04-28 (evening)_

## What was just done

**P3-T10 — real call-job handler — implemented + tested on branch `phase-3/call-job-handler` (not yet pushed).** Replaces the stub processor with a full lifecycle: validate at the dequeue trust boundary → `getOrgScopedDb` claim load → resolve IVR map + agent prompt → transition Claim → CALLING → `RetellPort.startCall` → persist Call + CallEvent rows → wait for `call.ended` → write final state. 8 new integration tests against real Postgres (`dentabill_test`) + `FakeRetell`: happy path, denial path (`collectedInfo.claimStatus = denied` → `Claim.status = DENIED`), malformed payload rejection, cross-org isolation (org B can't reach org A's claim), missing-NPI guard, three E.164 canonicalisation cases. All gates green: typecheck + lint + 19/19 tests pass.

Two corrections caught while writing tests:

1. Original handler used `findUnique` on the org-scoped client, but `getOrgScopedDb` deliberately doesn't intercept `findUnique` (see `with-org.ts`). Switched to `findFirst`, matching the established pattern in `apps/api/src/routes/v1/claims.ts`.
2. Original handler used `prisma.claim.update({ where: { id } })`, but the org-scope write middleware (ADR-009 layer 1) requires `organizationId` in every `where`. Switched to `prisma.claim.updateMany({ where: { id, organizationId } })`, again matching the API pattern.
3. Real race condition fixed in `waitForCallEnd`: transcript-event-driven `Call.status = NAVIGATING_IVR` writes were firing concurrently and could land AFTER the handler's final status update. Now serialized via a chained promise so terminal updates always win.

Test infrastructure: integration test seeds Org + Claim with `hashPatientDOB`; afterEach truncates 8 tables; `FakeRetell` constructed with a deterministic `retellCallIdFactory` so the test can drive `simulateHappyPath` / `simulateDenial` without racing the handler's startCall → DB-write → subscribe path. The buffered-emit pattern in `FakeRetell` (events emitted before subscribe are replayed on subscribe) bridges any remaining microtask ordering.

Phase 3 in-flight progress before this task: T0 ADR cluster, T1 queue foundations, T2 retry/DLQ, T3 IVR maps, T4 business hours, T5 RetellPort, T6 FakeRetell, T7 LiveRetell, T8 Prisma migration (Call.attemptNumber + dlqReason + composite index), T9 worker bootstrap — all merged. The CI optimisation PR (#75, paths-filter web/code) also landed.

## Current state of the repo

- Branch in flight: `phase-3/call-job-handler` (P3-T10). 8 new tests pass; all gates green; ready to commit + push + PR.
- `dentabill_test` Postgres has the Phase 3 migration applied (`prisma migrate deploy` against `TEST_DATABASE_URL` ran during this session).
- Test DB cleanup pattern is per-test-file `beforeAll/afterEach` truncate (not a setupFile) so unit tests in env/health/processor don't pay the DB-connection cost.
- Phase 3 next-task pointer (after T10 lands): **P3-T11 — IVR navigator** (DTMF replies during a live call, retry-on-misdetect, fallback to operator after 2 failures; pure logic, exhaustively unit-tested). Branch: `phase-3/ivr-navigator`. After T11: T12 hold detector, T13 per-call cap, T14 DLQ consumer, T15 e2e.

## Next task

**Commit + push + PR for P3-T10.** Conventional message: `feat(call-worker): real call-job handler with Retell + DB persistence (P3-T10)`. Body should call out the three corrections (findFirst over findUnique, updateMany with composite where, serialized waitForCallEnd chain), the 8 new integration tests, and the accepted Phase 3 trade-offs (subscriberId placeholder = claimNumber until Phase 4 schema migration; "claim stuck CALLING after retry exhaustion" handled by DLQ consumer P3-T14 + runbook P3-T28).

After PR merges: start **P3-T11 — IVR navigator** on a fresh branch. The navigator is pure logic against the `IvrStep[]` arrays in `packages/payer-ivr/src/ivr/maps/*.ts`; reads `RetellPort` events, emits DTMF responses, handles the 2-failure → operator fallback. Unit-test exhaustively against `DELTA_DENTAL_PPO_IVR` / `CIGNA_DENTAL_IVR` / `METLIFE_DENTAL_IVR`.

P2-T52 (`PRODUCT.md` via `$impeccable teach`) is still deferred to the user.

## Open questions / ambiguities

- **Phase 3 schema gap: no `subscriberId` on Claim.** The handler currently passes `claim.claimNumber` as the `agentMetadata.subscriberId` placeholder. Payer reps can usually locate a claim by claimNumber + DOS, but a real subscriber ID column on Claim should land in Phase 4. Document in DECISIONS.md when it does.
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
