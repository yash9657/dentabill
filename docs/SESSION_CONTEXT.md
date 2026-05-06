# Session Context

_Last updated: 2026-05-06 (Phase 4 closeout)._

## What was just done

**Phase 4 shipped end-to-end** across PRs #101–#121 over ~3 weeks. The voice-agent value loop is now closed: completed call → structured `CallSummary` → claim transition (gated by feature flag) → operator notification → metered `BillingUsageRecord`. Live-transcript SSE streams turns to the dashboard. Clerk webhook + reconciliation script + JWT.orgId assertion land the multi-seat tenancy foundation. SLOs + Phase-4 retro ADR (#050) close the phase.

Twelve focused PRs landed:

- W1 schema migrations (#101–#103): `CallSummary.organizationId` + multi-tenant intercept; `BillingUsageRecord` table; `Claim.subscriberId` expand-only.
- W2 summarizer (#104–#108, #113): `packages/summarizer` (port + FakeClaude + LiveClaude with prompt caching + versioned prompts + denial-code allow-list), `apps/summary-worker` with cost-guard Redis lock + auto-transition policy, `packages/notifier` + summary dispatch.
- W3 billing (#115–#118): `packages/billing` (port + FakeStripe + LiveStripe), `apps/billing-worker` daily reconciliation, `/v1/billing/usage` + `/v1/billing/portal` + `/v1/webhooks/stripe`, `/dashboard/settings/billing` web surface.
- W4 Clerk Orgs (#119): `POST /v1/webhooks/clerk` (Svix-signed), `apps/api/scripts/migrate-clerk-orgs.mts` reconciliation, JWT.orgId vs DB.organizationId assertion.
- W5 SSE (#120): `GET /v1/calls/:id/events/stream` with Postgres replay + Redis pub/sub, `useCallEventStream` hook, `TranscriptStream` component (flag-gated).
- W7 prep (#114): Cancel channel via `Call.cancelRequestedAt` + worker poll; Retell webhook signature parity test.
- W8 docs (this PR): `docs/SLOS.md` (metric names + thresholds + budget policy), Phase-4 oncall scenarios in `docs/RUNBOOK.md`, retro ADR-050.

Final repo-wide state: api 133/133 + web 267/267 vitest green; typecheck + lint clean.

## Current state of the repo

- Branch: `phase-4/w8-slos-runbook-retro` ready for merge as the W8 doc closeout.
- All Phase-4 feature work is on `main`. Default-OFF feature flags keep every auto-decision dormant in prod until explicit owner approval.

## Next task (Phase 5 kickoff)

**P5-T0 — Phase 5 plan + ADR cluster.** Phase 5 is the deployment + hardening phase per `docs/PHASE_PLAN.md`. Concrete kickoff items:

1. Carry-over from ADR-050: per-suite Postgres test schemas (P4-prep-2), Playwright SSE chaos coverage, golden-set eval fixtures + nightly workflow, Phase-4.5 LiveResend + React Email templates, Prometheus + Grafana wiring, branch protection on `main`, Anthropic BAA signing.
2. Cloud target selection (Render / Fly / AWS Fargate) per the deferred parts of ADR-001.
3. Real Stripe staging account + product/price IDs (owner-action carry-over).
4. Migration playbook for orgs currently on synthetic `local_*` clerkOrgId — run `apps/api/scripts/migrate-clerk-orgs.mts --dry-run` against staging first.

## Open questions / ambiguities

- **Stripe pricing tier numbers** still owner-action. ADR-043 records the mechanism; the per-claim fee × plan tier multipliers need decisive numbers before the LiveStripe flag flips.
- **Anthropic BAA** signed yet? Hard prereq before `LiveClaude` ships to prod (PHI in inference path).
- **Test-DB concurrency** still requires `--concurrency=1` in `turbo.json`. P4-prep-2 deferred to Phase 5.
- **Branch protection on `main`** still owner-action carry-over from Phase 3.

## Trap to avoid

When iterating in autonomous mode, env-cache traps re-bite. `getEnv()` is process-cached; `vitest.setup.ts` deletes Clerk keys before tests run, but the `loadEnv` fallback resolves `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` → `CLERK_PUBLISHABLE_KEY`, so a test that sets the public flavour without also unsetting the canonical name accidentally activates the Clerk auth path. Always delete all three Clerk envs explicitly in `beforeAll`, even after ADR-049's empty-string normalisation.
