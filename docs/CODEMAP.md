# DentaBill codemap

Navigable index of the monorepo. Maintained by the `/codemap-update` skill —
refresh after adding or removing a workspace.

> **Phase 3 — Queue + Voice complete (2026-04-29).** `apps/web`,
> `apps/api`, `apps/call-worker`, `@dentabill/queue`, `@dentabill/payer-ivr`,
> `@dentabill/api-sdk`, `@dentabill/ui`, `@dentabill/db`, `@dentabill/types`,
> `@dentabill/logger`, `@dentabill/config` are all built out.
> `apps/summary-worker` remains a stub awaiting Phase 4. The web bundle
> invariant (no `@dentabill/db` imports from `apps/web`) is preserved —
> the web tier consumes `@dentabill/api-sdk` only.

## Layout (per CLAUDE.md and PRD §3)

```
apps/
  web/              Next.js 15 frontend (port 3000) — Phase 2
  api/              Fastify v5 REST API (port 3001) — Phase 2
  call-worker/      BullMQ worker — Retell AI calls — Phase 3
  summary-worker/   BullMQ worker — Claude analysis — Phase 4
packages/
  config/           Shared eslint/tsconfig/prettier/vitest config
  db/               Prisma schema + singleton client — schema in P1-T4
  types/            Shared TS types + Zod ApiError + branded ids + enums
  logger/           pino with PHI-field redaction
  queue/            BullMQ job definitions — Phase 3
  payer-ivr/        Insurance IVR navigation maps — Phase 3
  ui/               Shared shadcn components — Phase 2
```

## Workspaces

### `@dentabill/config` — packages/config

**Purpose:** Shared TypeScript, ESLint, Prettier, and Vitest configuration.
Build-time tooling only — no runtime code.
**Entry:** none (consumed via `exports` map: tsconfig.\*.json, eslint.config.js,
prettier.config.js, vitest.config.base.js).
**Depends on:** none (root tooling).

### `@dentabill/types` — packages/types

**Purpose:** Shared TypeScript types and Zod schemas. Single source of
truth for the API error contract, pagination, branded IDs, and Prisma
enum mirrors.
**Entry:** `packages/types/src/index.ts`
**Key files:**

- `src/api-error.ts` — `ApiError` class, `ApiErrorSchema`, `API_ERROR_CODES`
  catalog, `httpStatusForCode()` mapping
- `src/pagination.ts` — `PaginationQuerySchema`, `paginatedResponseSchema()`
- `src/ids.ts` — branded IDs (`OrgId`, `UserId`, `ClaimId`, `CallId`, …)
- `src/enums.ts` — Plan, UserRole, ClaimStatus, CallStatus, PayerCode,
  NextAction (mirrors PRD §5; replaced by Prisma re-exports after P1-T4)

**Depends on:** `zod` only.

### `@dentabill/logger` — packages/logger

**Purpose:** pino-based structured logger with PHI-aware redaction.
**Entry:** `packages/logger/src/index.ts`
**Exports:** `createLogger(opts)`, `Logger` type, `logger` default instance.
**Depends on:** `pino`, `pino-pretty` (dev only).
**Tests assert:** PHI fields (patient name, DOB, SSN, member id, email,
phone, address) are redacted at the top level and under `req.body` /
`req.headers`.

### `@dentabill/db` — packages/db (stub)

**Purpose:** Prisma schema + generated client + multi-tenant middleware

- audit/org-scope helpers.
  **Entry:** `packages/db/src/index.ts` (currently exports `{}`).
  **Lands in:** P1-T4 (schema), P1-T4A (helpers), P1-T5 (middleware).

### `@dentabill/queue` — packages/queue

**Purpose:** BullMQ v5 wiring for the call lifecycle queue + DLQ.
**Entry:** `packages/queue/src/index.ts`
**Key files:** `calls.ts` (Queue/Worker/QueueEvents factories, retry policy
per ADR-035), `dlq.ts` (separate `calls-dlq` topic), `types.ts` (Zod
`CallJobDataSchema` validated at the dequeue trust boundary).

### `@dentabill/payer-ivr` — packages/payer-ivr

**Purpose:** Per-payer IVR navigation maps + agent prompts + business-hours
guard + the `RetellPort` interface and its two adapters.
**Entry:** `packages/payer-ivr/src/index.ts`
**Key files:**

- `ivr/maps/{delta-dental-ppo,cigna-dental,metlife-dental}.ts` — declarative
  DTMF maps respecting PRD §6 timing.
- `agents/{delta-dental-ppo,cigna-dental,metlife-dental}.ts` — per-payer agent
  prompts (ADR-032).
- `business-hours.ts` — `checkPayerHours(payerCode, now)` returning a
  discriminated tagged result; `Intl.DateTimeFormat`-driven so DST is the
  platform's problem (ADR-037).
- `retell-port.ts` — the contract every adapter implements: `startCall`,
  `endCall`, `subscribe` (events), `unsubscribe`.
- `retell-fake.ts` — deterministic in-process state machine for CI; powers
  the lifecycle e2e (P3-T15).
- `retell-live.ts` — wraps `retell-sdk`; only adapter that touches the
  network; lazy-loaded + env-gated.
- `navigator/navigator.ts` — pure-logic IVR navigator (P3-T11) reading
  `RetellPort` events and emitting DTMF responses with retry-on-misdetect
  - 2-failure operator fallback.

### `@dentabill/api-sdk` — packages/api-sdk

**Purpose:** Type-safe client for `@dentabill/api`. Generated from the
OpenAPI spec via `pnpm gen:sdk` (chains `gen:openapi` → `gen:types`).
**Entry:** `packages/api-sdk/src/index.ts`
**Key files:** `openapi.json` (committed), `src/types.gen.ts` (committed),
`src/contract.test.ts` (asserts every endpoint the SDK advertises is in
the spec — fails at compile time if `gen:sdk` is forgotten).

### `@dentabill/ui` — packages/ui (stub) — Phase 2

**Purpose:** Shared shadcn/ui component library consumed by `apps/web`.
**Entry:** `packages/ui/src/index.ts`

### `@dentabill/web` — apps/web (stub) — Phase 2

**Purpose:** Next.js 15 App Router frontend — landing page, auth, dashboard.
**Entry:** `apps/web/src/index.ts` (Next.js scaffold lands in Phase 2 P2-T1).

### `@dentabill/api` — apps/api (stub) — Phase 2

**Purpose:** Fastify v5 REST API — auth-protected claims CRUD, webhook
receivers, SSE.
**Entry:** `apps/api/src/index.ts` (Fastify scaffold lands in Phase 2 P2-T7).

### `@dentabill/call-worker` — apps/call-worker

**Purpose:** BullMQ worker that drives the outbound Retell call lifecycle
end-to-end. Fastify-based health probe at `:3010/healthz`.
**Entry:** `apps/call-worker/src/index.ts`
**Key files:**

- `handler.ts` — the real call-job handler (P3-T10): claim load via
  exact CallIntent lookup → claim-version CAS + SUBMITTING commit → one
  `RetellPort.startCall` → atomic ACCEPTED/Call/audit → durable evidence observation
  → atomic terminal state. UNKNOWN/SUBMITTING never redial; ACCEPTED resumes.
- `hold-detector.ts` — `MAX_HOLD_MS=600_000`; request stop then await verified
  termination/review. Stop acknowledgement does not authorize automatic rescheduling.
- `duration-guard.ts` — `MAX_CALL_DURATION_MS=900_000`; per-call cap →
  DLQ + Claim → `MANUAL_REVIEW` (ADR-038).
- `dlq-consumer.ts` — cancels only exact READY intents with claim-version CAS/audit;
  submitted and uncertain provider calls remain protected.
- `e2e.test.ts` — full lifecycle against real BullMQ + Postgres + FakeRetell.

### `@dentabill/summary-worker` — apps/summary-worker (stub) — Phase 4

**Purpose:** BullMQ worker that runs Claude post-call analysis.
**Entry:** `apps/summary-worker/src/index.ts`

## Cross-cutting integrations

| Integration            | Used by                               | Notes                                                            |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Postgres 16 + Prisma 6 | `@dentabill/db` (consumed everywhere) | Multi-tenant; every query filtered by `organizationId`           |
| Redis 7 + BullMQ       | api + workers + `@dentabill/queue`    | Local: docker-compose. Prod: TBD per ADR-004                     |
| Retell AI              | `apps/call-worker`                    | IVR navigation + voice calls (Phase 3)                           |
| Anthropic Claude       | `apps/summary-worker`                 | Call transcript analysis (Phase 4)                               |
| Clerk                  | `apps/web`, `apps/api`                | Auth and org membership (Phase 2)                                |
| Retell-managed Twilio  | `apps/call-worker` (via Retell)       | Verified configured carrier; Telnyx remains a deferred candidate |
| Resend                 | `apps/api`                            | Transactional email — call-completion notifications (Phase 4)    |
| Stripe                 | `apps/web`, `apps/api`                | Metered billing (Phase 6)                                        |

## Conventions (cross-reference)

- Engineering rules: `docs/ENGINEERING_RULES.md`
- UX standards: `docs/UX_RULES.md`
- API conventions: `docs/API_CONVENTIONS.md`
- Architecture: `docs/ARCHITECTURE.md`
- Security & HIPAA: `docs/SECURITY.md`
- ADRs: `docs/DECISIONS.md`
- Patterns / gotchas: `docs/PATTERNS.md` _(created on first `/learn` save)_

## W0 additions (2026-10-13)

- `packages/payer-ivr/src/call-identity.ts`: shared required subscriber/NPI validation.
- `apps/api/src/lib/financial-reporting.ts`: explicit verified-payment unavailability contract.
- `apps/api/test/fixtures/retell/`: synthetic documented vendor envelopes and contract limits.
- `docs/PROVIDER_EVIDENCE.md`: capability matrix, account/provider contracts and blocked probes.
- `docs/CODE_REFERENCE_EVIDENCE.md`: existing code annotation corrections and licensing/provenance limits.
- `apps/api/src/lambda-worker.ts`, `packages/queue/src/sqs.ts`, `infra/aws/`: current AWS delivery/deployment baseline.

### FW-07 provider inbox and canonical transcripts (2026-10-13)

- `packages/payer-ivr/src/retell/webhook.ts` — raw SDK signature and documented wire normalization.
- `packages/payer-ivr/src/retell/inbox.ts` — transactionally accept/reconcile pending provider evidence.
- `packages/db/prisma/migrations/20261013090000_retell_inbox/` — additive inbox persistence.
- `packages/types/src/call-transcript.ts` — pure canonical final/provisional source selector shared by worker/UI.
- `apps/call-worker/src/retell-webhook-process.test.ts` and fixture — producer-crash cross-process regression.
- `apps/web/src/lib/calls/use-call-event-stream.test.ts` — call/auth/reconnect isolation regressions.

### FW-25 intent ownership and FW-31 streaming (2026-10-13)

- `packages/db/prisma/schema.prisma` — CallIntent submission states, payload/hash and scoped references.
- `packages/db/prisma/migrations/20261013100000_call_intents/` — active-intent uniqueness and lifecycle persistence.
- `packages/db/prisma/migrations/20261013110000_call_intent_scope/` — database-enforced claim/call tenant binding.
- `apps/call-worker/src/call-intents.test.ts` — concurrency, rollback, stale-version and tenant constraints.
- `apps/call-worker/src/call-intent-process.test.ts` and fixture — worker crash/restart against an independent synthetic acceptance ledger.
- `apps/api/src/routes/v1/calls-sse.ts` — stable paginated DB replay/catch-up; provider terminal evidence before close.

### FW-35 transactional delivery and FW-32 cancellation (2026-10-13)

- `packages/db/prisma/migrations/20261013120000_job_outbox/` — tenant-scoped immutable delivery commands, retry state and expiring leases.
- `apps/call-worker/src/job-outbox.ts` and tests — atomic enqueue helper, bounded leased relay, backoff/quarantine and owner fencing.
- `apps/call-worker/src/job-outbox-process.test.ts` and fixture — producer/relay SIGKILL and independent broker/provider acceptance ledgers.
- `apps/call-worker/src/server.ts` — startup/periodic BullMQ recovery; worker finalization saves summary obligation transactionally.
- `apps/api/src/lambda-worker.ts` and `infra/aws/main.tf` — fixed private relay invocation and disabled-by-default scheduled recovery.
- `packages/queue/src/inline.ts`, `apps/api/src/routes/v1/internal-jobs.ts` — verified completion receipt and authenticated fixed-bound recovery endpoint.
- `apps/api/src/lib/cancel-call.ts` and tests — atomic request marker, conditional claim state, provider-terminal race handling.
- `apps/web/src/lib/calls/use-cancel-call.ts` — request mutation and pending-cancellation UI in call detail/list.

### FW-34 positive-only call reconciliation (2026-10-13)

- `packages/db/prisma/migrations/20261013130000_call_reconciliation/` — attempt count, cooldown, token-fenced lookup leases and last checked outcome.
- `packages/payer-ivr/src/retell/reconciliation.ts` and tests — bounded read-only v3 metadata lookup/v2 detail, identity-only candidates and normalized final source.
- `apps/call-worker/src/call-reconciliation.ts` and tests — exact snapshot matching, no-redial recovery, atomic binding/source/audit/resume obligation.
- `apps/call-worker/src/call-reconciliation-process.test.ts` and fixture — real adapters against an independent synthetic fsynced provider/broker, two SIGKILL boundaries.
- `apps/call-worker/src/call-reconciliation-race.test.ts` — original create response versus recovery binding in both orders.
- `apps/api/src/routes/v1/call-recovery.ts` and tests — scoped safe status projection and Owner/Admin-only existing-call lookup.
- `apps/web/src/components/dashboard/calls/claim-call-recovery.tsx`, `apps/web/src/lib/calls/use-call-recovery.ts` — review workflow, cooldown/configuration feedback and claim-bound recovery results.
- `packages/queue/src/types.ts`, worker handler and internal job receipts — exact observation-only resume command with a distinct retained queue ID.

### FW-36 accepted-call observation and FW-38 diagnostics (2026-10-13)

- `packages/db/prisma/migrations/20261013140000_call_observation/` — persisted deadlines, observer leases, due index and separate termination state.
- `apps/call-worker/src/call-observer.ts` and tests — bounded known-ID observation, source-only finalization, Stop backoff/confirmation and trusted due sweep.
- `apps/call-worker/src/call-provider-evidence.ts` — shared canonical saved-request and exact provider identity checks.
- `apps/call-worker/src/call-observer-process.test.ts` and fixture — independent fsynced provider ledger, observer SIGKILL, lost Stop ACK and stale-response races.
- `apps/call-worker/src/call-reconciliation-deadline.test.ts`, `call-observer-review.test.ts` — historical deadline preservation and legacy timer selection regressions.
- `apps/api/src/lib/inline-jobs.ts`, `lambda-worker.ts`, internal jobs route and BullMQ server — durable monitoring receipts and independent scheduled observation.
- `apps/api/src/routes/v1/calls.ts` and call detail/list — safe monitoring projection and pending/review feedback.
- `apps/api/src/routes/v1/call-recovery.ts`, `check-call-status-control.tsx`, `use-check-call-status.ts` — audited Owner/Admin-only accepted-call reads, cooldown/auth ordering and cache-safe feedback.
- `apps/call-worker/src/handler-demo-autopilot.test.ts` — real handler/adapter completion and confirmed cancellation with compressed synthetic scenario timers.
- `packages/db/src/lib/prisma-diagnostics.ts` and tests — closed diagnostic target/timestamp logging, excluding raw messages/query inputs.

## Operations and reviewed recovery (FW-37)

- `apps/api/src/routes/v1/operations.ts` — scoped stored-role overview, cursor-paginated delivery/
  call worklists and exact-snapshot recovery endpoints; synthetic real-PG route tests adjacent.
- `apps/call-worker/src/job-recovery.ts` — canonical command/domain validation, serializable
  approval, bounded additional allowance and separate audited close; real-PG recovery tests.
- `packages/queue/src/dispatcher-recovery.test.ts` — retained failed/completed BullMQ generation proof.
- `apps/web/src/app/dashboard/settings/operations/` and
  `apps/web/src/components/dashboard/settings/operations/` — admin worklists and review dialog;
  `apps/web/src/lib/operations/` — organization-keyed SDK hooks and safe status copy.
- `packages/db/prisma/migrations/20261013150000_job_recovery/` — additive recovery allowance/history.
- `docs/FIREWORKS_GATEWAY_CONTRACT.md` — refreshed primary vendor contract and unapproved gateway
  release/test requirements; not completed adapter or provider suitability evidence.
