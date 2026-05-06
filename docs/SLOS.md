# DentaBill — Service Level Objectives (Phase 4)

> Phase 4 surfaces ship with explicit SLOs so "what does broken look like?" is answerable from a runbook page rather than tribal knowledge. ADR-048 is the durable record of these targets; this file is the operational page.

## Naming convention

All metrics emit on the Prometheus convention `dentabill_<surface>_<measure>_<unit>` so a wildcard match like `dentabill_summary_*` retrieves every summarizer telemetry stream without ambiguity. Histograms expose `_bucket` / `_sum` / `_count` per Prometheus standard.

## Metric inventory

| Metric                                              | Type      | Surface                        | Phase-4 source                                                          |
| --------------------------------------------------- | --------- | ------------------------------ | ----------------------------------------------------------------------- |
| `dentabill_summary_token_usage_total{org}`          | counter   | summary-worker                 | per-org Anthropic token tally; mirrors `Organization.summaryTokensUsed` |
| `dentabill_summary_success_total{org,outcome}`      | counter   | summary-worker                 | `outcome ∈ {success, dlq, timeout, validation_error, locked}`           |
| `dentabill_summary_latency_seconds_bucket`          | histogram | summary-worker                 | pickup → `CallSummary` row commit                                       |
| `dentabill_sse_active_connections{org}`             | gauge     | apps/api SSE route             | live count of SSE streams holding `text/event-stream` connections       |
| `dentabill_sse_first_event_seconds_bucket`          | histogram | apps/api SSE route             | connect → first replay frame                                            |
| `dentabill_stripe_webhook_lag_seconds_bucket`       | histogram | apps/api `/v1/webhooks/stripe` | `now - event.created` at receipt                                        |
| `dentabill_billing_reconciliation_drift{kind}`      | gauge     | billing-worker                 | `kind ∈ {missing_usage, extra_usage}` row delta against AuditLog        |
| `dentabill_webhook_signature_verify_seconds_bucket` | histogram | Retell + Stripe + Clerk routes | bytes-in → verified                                                     |

## Targets

| Surface                            | Indicator                                                             | Target      | Page threshold        |
| ---------------------------------- | --------------------------------------------------------------------- | ----------- | --------------------- |
| Enqueue (P3)                       | P95 latency POST `/v1/claims/:id/calls` → BullMQ ack                  | ≤ 200ms     | > 500ms for 10 min    |
| Summarizer                         | Success rate within 60s of call end                                   | ≥ 95%       | < 95% for 30 min      |
| Summarizer                         | P95 latency pickup → `CallSummary` row                                | ≤ 60s       | > 90s for 30 min      |
| SSE transcript                     | P95 first-event latency from connect                                  | ≤ 500ms     | > 1s for 10 min       |
| Webhooks (Retell + Stripe + Clerk) | P99 signature verification                                            | ≤ 10ms      | > 30ms for 5 min      |
| Billing reconciliation             | Drift between `BillingUsageRecord` and `claim.transition` audit count | ≤ 1 row/day | > 1 row/day           |
| SSE concurrency                    | Active connections per process                                        | ≤ 200       | > 1000/process — warn |
| Stripe webhook                     | Receipt-to-200 latency P95                                            | ≤ 60s       | > 60s P95 — warn      |

## Error-budget policy

A page-threshold breach consumes one **budget event**. Three budget events in a 28-day window block non-essential Phase-5 feature work until the breached SLO recovers for one week. Budget events are recorded in `docs/RUNBOOK.md` under "Phase-4 SLO budget log" (template entry below).

```
- 2026-MM-DD HH:MM UTC — <surface> — <indicator> — budget consumed (#N of 3 in 28d)
```

## Synthetic monitor (staging)

`apps/api/scripts/synthetic-summary-loop.mts` runs once daily on staging and asserts the end-to-end pipeline:

1. enqueue a fake call,
2. expect a `CallSummary` row within 60s,
3. expect a `BillingUsageRecord` row within 24h.

The script exits non-zero on any failure and pages oncall via the same alert channel that consumes the Prometheus thresholds above.

## Phase-5 follow-ups

- Wire the metrics to a real Prometheus + Grafana pair (Phase-5 deployment).
- Replace the FakeResend delivery log with `LiveResend` so the notifier emits its own SLO (delivery success ≥ 99%).
- Add per-org plan-tier SLO carve-outs for ENTERPRISE customers once the plan-tier table lands.
