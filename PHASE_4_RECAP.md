# Phase 4 — Intelligence + Realtime + Billing — Recap

_Closed 2026-05-06. 12 PRs (#101 → #121) over ~3 weeks of autonomous execution._

## What shipped

The Phase-4 value loop is closed end-to-end:

```
[Retell call ends]
   → call-worker writes Call.endedAt + final CallEvent
   → call-worker enqueues `summary.generate`
   → summary-worker:
       1. acquire Redis cost-guard lock summarize:<orgId>:<period>
       2. SummarizerPort.summarize (FakeClaude in CI, LiveClaude in prod)
       3. validate against SummaryOutputSchema (Zod, twice)
       4. persist CallSummary (with organizationId)
       5. apply transition policy gated by SUMMARIZER_AUTO_TRANSITION_ENABLED
       6. audit('claim.transition', ...)
       7. notifier.notify (FakeResend in Phase 4)
       8. Redis publish to call:<retellCallId>:events
   → /dashboard/calls/[id] SSE handler streams the publish to the operator
   → daily 02:00 UTC billing-worker scans claim.transition audits,
     groups by org, ensures Stripe customer, posts usage records
     idempotent on (claimId, billingPeriodStart)
```

Every auto-decision is gated behind a default-OFF feature flag. Phase 5 flips them per-surface after staging canary.

## PR ledger

| PR         | Title                                                                              | Workstream      |
| ---------- | ---------------------------------------------------------------------------------- | --------------- |
| #101       | feat(db): CallSummary multi-tenancy gap close                                      | W1A             |
| #102       | feat(db): Phase-4 new tables + indexes                                             | W1B             |
| #103       | feat(api,db): Claim.subscriberId expand + env loader normalisation                 | W1C + W7-prep-1 |
| #104       | feat(summarizer): port + FakeClaude + Zod schema                                   | W2A             |
| #105       | feat(summarizer): LiveClaude wrapper with prompt caching                           | W2B             |
| #106       | feat(summarizer,payer-ivr): versioned prompts + denial-code allow-list             | W2C             |
| #107       | feat(summary-worker): scaffold (BullMQ + healthz + drain)                          | W2D             |
| #108       | feat(summary-worker): handler with Redis cost-guard + DLQ                          | W2E             |
| #109..#112 | feat(summary-worker,api,logger): auto-transition + emission seam + API + redaction | W2F–I           |
| #113       | feat(notifier,summary-worker): NotifierPort + FakeResend + dispatch                | W6              |
| #114       | feat(call-worker,api): cancel channel + Retell signature parity                    | W7-prep-4/6     |
| #115       | feat(billing): BillingPort + FakeStripe + LiveStripe scaffold                      | W3A             |
| #116       | feat(billing-worker): daily reconciliation handler + bin                           | W3B/C           |
| #117       | feat(api): billing usage + portal + Stripe webhook stub                            | W3D/E           |
| #118       | feat(web): /dashboard/settings/billing usage card + portal CTA                     | W3F             |
| #119       | feat(api): Clerk webhook + JWT.orgId assertion + migration script                  | W4              |
| #120       | feat(api,web): live transcript SSE end-to-end                                      | W5              |
| #121       | docs: Phase-4 closeout (SLOs, runbook, retro ADR-050)                              | W8              |

## Test posture at exit

- **api**: 133/133 vitest green (incl. multi-tenant isolation, Stripe + Clerk webhook signature, SSE replay-end wire shape, Retell signature contract).
- **web**: 267/267 vitest green (incl. billing settings page).
- **packages**: summarizer, billing, notifier all unit-tested via Fake adapters.
- **Cross-tenant tests**: `getOrgScopedDb(orgA)` returns only org-A rows for `CallSummary` and `BillingUsageRecord`.
- **Idempotency tests**: same Stripe-event POSTed twice → one record; billing-worker run twice for same `(claimId, period)` → one Stripe POST.

## Deferred to Phase 5 (per ADR-050)

1. Per-suite Postgres test schemas (P4-prep-2).
2. Playwright SSE chaos coverage.
3. Golden-set evals (20 transcripts × 3 payers + nightly LiveClaude eval workflow).
4. Phase-4.5 LiveResend + React Email templates micro-phase.
5. Real Prometheus + Grafana wiring (metric names already in code per ADR-048; only the collection target is missing).
6. Branch protection on `main` (owner-action carry from Phase 3).
7. Anthropic BAA signing (gates `LiveClaude` in prod).

## Handoff notes for Phase 5

- All Phase-4 SDK adapters are lazy-loaded — `@anthropic-ai/sdk`, `stripe`, `@clerk/backend` ship only when their respective live integrations are activated. Bundle size unchanged for dev/test.
- Default-OFF feature flags: `SUMMARIZER_AUTO_TRANSITION_ENABLED`, `STRIPE_METERED_BILLING_ENABLED`, `NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED`, `CLERK_ORG_SWITCHER_ENABLED`. Flip in staging first.
- Stripe webhook is signature-stub-only in Phase 4 (`signature.includes('t=') && includes('v1=')`). LiveStripe wire-up is one `stripe.webhooks.constructEvent` call once secrets are in place.
- Clerk migration script supports `--dry-run` for staging rehearsal. The reverse-map JSON dropped at `/tmp/clerk-migration-<timestamp>.json` is the rollback record — preserve it.
- SSE Postgres replay covers up to the last 200 events per call. The cursor + circular-buffer story (P4-T5B/C) is deferred — current replay limit is sufficient given typical call duration.
