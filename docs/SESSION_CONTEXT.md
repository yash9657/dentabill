# Session Context

_Last updated: 2026-05-06 (Phase 4 W0 ADR cluster)._

## What was just done

**Phase 3 hardening PR #103** ("Phase 3 post-merge hardening") landed CI-green. Six focused commits on `phase-3/post-merge-hardening`: NPI self-serve provisioning + missing-NPI banner + Call-Now gating (P3-T32), Retell agent provisioning script (P3-T31), live activity timeline on claim detail (P3-T33), claim-status modal centring fix, claims filter layout polish, TASKS.md "needs your attention" section. CI gates: Quality, Test, E2E, Bundle, Lighthouse, CodeQL, GitGuardian — all green.

**Phase 4 plan approved** and saved at `/Users/yashbhalgat/.claude-premium/plans/cryptic-strolling-candle.md`. 7-week sequencing across W0–W8 with default-OFF feature flags for every auto-decision (auto-transition, SSE, billing, Clerk org-switcher), Redis-distributed-lock cost guards on the summarizer, idempotency tests on Stripe writes, Playwright chaos tests on SSE.

**Phase 4 W0 ADR cluster** (this session): ADRs 042–049 written and committed on `phase-4/w0-adr-cluster`. Decisions: SummarizerPort + cost-guard atomicity (042), Stripe metered billing on audit spine (043), Clerk Orgs idempotent reconciliation (044), `Claim.subscriberId` expand-then-contract (045), SSE protocol with Postgres replay (046), true cancel via Postgres marker (047), SLOs + error budgets (048), env-loader empty-string normalization (049). Total ADRs: 49. `docs/TASKS.md` rewritten with the W0–W8 task breakdown (P4-T0 through P4-T8E plus P4-prep cleanups). `docs/PHASE_PLAN.md` Phase-4 paragraph rewritten with the concrete exit criteria.

## Current state of the repo

- Branch in flight: `phase-4/w0-adr-cluster` (off `phase-3/post-merge-hardening` to avoid `docs/TASKS.md` conflicts during rebase).
- PR #103 (Phase 3 hardening) is mergeable; this branch contains its commits transitively. After PR #103 merges, the W0 PR should retarget directly against `main`.
- No code changes in W0 — pure docs cluster.
- Repo-wide typecheck + lint last green at the end of the previous session.

## Next task

**P4-T1A — multi-tenancy gap close on `CallSummary`**, the W1 critical-path opener. The Phase-4 plan agent's review caught this: `CallSummary` is in the schema (it was added speculatively in Phase 1) but is **not** registered in `getOrgScopedDb`'s intercept list (`packages/db/src/lib/with-org.ts:87+`). Any read against `prisma.callSummary` today returns rows from all orgs — a cross-tenant data-leak vector that ships before any other Phase 4 code touches the model.

Concrete steps:

1. Migration in `packages/db/prisma/schema.prisma`: add `CallSummary.organizationId String` (nullable to start), backfill from `Call.organizationId`, then tighten to NOT NULL in a second migration.
2. Register `callSummary` in `packages/db/src/lib/with-org.ts` multi-tenant intercept list.
3. Register in `packages/db/src/middleware/org-scope.ts` write middleware whitelist.
4. New tests in `packages/db/src/lib/with-org.test.ts` (or sibling) exercising cross-tenant isolation: two orgs, two summaries, `getOrgScopedDb(orgA).callSummary.findMany()` returns only org A's rows.

After P4-T1A, sequence continues with P4-T1B (new tables: `BillingUsageRecord`, `Organization.featureFlags`, `Organization.summaryTokensUsed/ResetAt`, `Organization.stripeCustomerId`, `Call.cancelRequestedAt/By`, `CallEvent_callId_timestamp_idx`).

## Open questions / ambiguities

- **Stripe pricing model finalisation.** ADR-043 records "flat per-resolved-claim fee × org plan tier" as the Phase-4 default, with a Phase-5 revisit. The plan tier multipliers themselves are owner-action — not engineering. Need decisive numbers before P4-T3D wires the live Stripe product/price IDs.
- **Anthropic BAA.** Hard prereq before `LiveClaude` ships to prod (PHI in inference path). Owner-action; engineering ships `FakeClaude` + `LiveClaude` regardless, but the production rollout is gated.
- **Phase-3 schema gap on `subscriberId` is being addressed in Phase 4 W1C** — expand-only (column added, populated forward). Backfill of historic rows defers to Phase 5+ via the summary-worker (it can parse subscriber id from Claude's structured output when present).
- **Test-DB concurrency** still requires `--concurrency=1` in `turbo.json`. P4-prep-2 fixes this with per-suite Postgres schemas; until then, Phase-4 test runs stay serial.
- **Branch protection on `main`** still not enabled in the GitHub UI (carryover from Phase 3).
- **Retell + Anthropic + Stripe credentials** all owner-action. Phase-4 staging Anthropic key needed for nightly `LiveClaude` golden-set evals (ADR-042 + P4-T2J).

## Trap to avoid

When PRs branch off another in-flight PR (this W0 branch is off `phase-3/post-merge-hardening` to avoid `docs/TASKS.md` conflicts), GitHub's "delete branch on merge" can auto-close the dependent PR. Recovery is: rebase onto `main` + force-push + reopen. Two ways to dodge this:

1. Open the dependent PR only after the base merges (preferred for non-blocking work).
2. Mark the dependent PR as draft and rebase onto `main` immediately after the base PR merges.

Phase 3 closeout taught us this; Phase 4 should follow rule 1 wherever possible.

## Do not forget

- One workstream's PR at a time. W0 lands as one squashed PR against `main`; W1A is a separate PR; W1B another. Tests are part of the task, not a follow-up.
- **Run repo-wide `prettier --check .`** before pushing every PR. PR #103 hit a prettier-only failure on the provisioning script that was avoidable.
- Update `SESSION_CONTEXT.md` + `TASKS.md` + `PROGRESS.md` + `DECISIONS.md` (ADRs only) at end of every session.
- Status-active teal (`oklch(0.78 0.04 200)`) stays scarce — Phase 4 may add it to the SSE connection-status indicator only when the stream is live; reconnecting + closed stay achromatic per ADR-013.
- Visual regression baselines per-OS — when changing the SSE transcript or billing surface, regenerate both `*-darwin.png` (locally) and `*-linux.png` (in `mcr.microsoft.com/playwright:v1.59.1-noble`).
- Empty-string env normalisation lands at the loader (ADR-049), not in `vitest.setup.ts`. Future env vars added in Phase 4+ should not need bespoke empty-string handling.
- Multi-tenancy three layers: read-scope (`with-org.ts`), write middleware (`org-scope.ts`), audit log. Every new model gets all three plus a cross-tenant integration test before any code reads or writes it.
- Web bundle invariant (no `@dentabill/db` from `apps/web`) is **load-bearing**. Phase 4's billing + summary surfaces must consume `@dentabill/api-sdk` only.
- Auto-decisions ship feature-flagged OFF by default. Auto-DENY is never automatic in Phase 4.
- No em dashes in user copy; no card grids; no side-stripe banners; no glassmorphism (Impeccable + ADR-013).
