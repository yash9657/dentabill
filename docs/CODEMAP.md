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
  model-gateway/    Release-gated Fireworks text inference + explicit synthetic adapter
  evals/            Offline scoring, evidence-bound review packets and isolated contract capture
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

### `@dentabill/model-gateway` — packages/model-gateway

**Purpose:** Versioned claim observations from source-bound final transcripts. An explicit
durable adapter now lives in summary-worker; automatic job/voice routing is not enabled and
default live releases remain unapproved (ADR-063/065).
**Entry:** `packages/model-gateway/src/index.ts`.
**Key files:** `contracts.ts` typed request/result; `release.ts` scoped reviewed policy and
contract/artifact hashes; `task.ts` prompt/schema/evidence/lexical rules; `transport.ts` fixed
US native fetch with byte/depth/deadline/retry controls and required awaited attempt journal;
`gateway.ts` bounded journal opening, saved-result validation and final receipt orchestration;
`fake.ts` exact synthetic fixtures and explicit abstention. Tests cover policy/input isolation,
protocol/transport faults, cancellation accounting and semantic constraints. `journal.test.ts`
proves admission/receipt/retry ordering, no late send, original deadline and usage consistency.
**Depends on:** `zod`, Node crypto/fetch. No SDK retries, database access or logging dependency.

### `@dentabill/evals` — packages/evals

**Purpose:** Independent synthetic reference annotations, deterministic offline evaluation and
recomputed review evidence. No production runtime import, network transport or release promotion.
**Entry:** `packages/evals/src/index.ts`; CLI `pnpm --filter @dentabill/evals evaluate`.
**Key files:** `contracts.ts` strict corpus/review/result binding and split leakage checks;
`seed.ts` 25 DRAFT development cases; `baseline.ts` empty-fixture fake gateway baseline;
`scoring.ts` field/citation/abstention/subgroup and usage metrics; `review.ts` recomputed report
and artifact bindings with mandatory blockers; `cli.ts` exclusive local artifacts and verification.
**Depends on:** `@dentabill/model-gateway`, `zod`, Node crypto/filesystem. Review attestations and
imported provenance are not authenticated; every packet keeps production approval false.
**Contract discovery:** `capture-plan.ts` freezes candidate/corpus/account/artifact and monetary
allowances; `capture-store.ts` publishes private immutable fsynced records; `capture-run.ts`
owns one attempt per case, account checks, raw receipts and replay/unknown outcomes.
`capture-cli.ts` exposes prepare/inspect/run separately from offline scoring. Process fixtures
prove acceptance/raw-receipt crashes and over-allowance recovery against localhost HTTP only.

**Workflow and limits:** `packages/evals/README.md` (ADR-069/070).

### `@dentabill/logger` — packages/logger

**Purpose:** pino-based structured logger with PHI-aware redaction.
**Entry:** `packages/logger/src/index.ts`
**Exports:** `createLogger(opts)`, `Logger` type, `logger` default instance.
**Depends on:** `pino`, `pino-pretty` (dev only).
**Tests assert:** PHI fields (patient name, DOB, SSN, member id, email,
phone, address) are redacted at the top level and under `req.body` /
`req.headers`.

### `@dentabill/db` — packages/db

**Purpose:** Prisma schema, tenant scope, audit and durable inference accounting.
**Entry:** `packages/db/src/index.ts`.
**Inference:** `src/lib/inference.ts` owns organization-locked admission, one submitted
attempt per call/generation, independent usage receipts, resumable local application and
atomic review markers. `inference.test.ts` exercises concurrency, midnight liability,
receipt replay, application rollback and tenant isolation. Migrations fourteen/fifteen
add the ledger and review marker; snapshots are immutable at the database boundary.
Allocations are operational units, not provider dollar ceilings (ADR-064).
`fireworks-inference.ts` adds the native per-attempt journal: frozen request/release/deadline,
separate retry allocation, bounded raw response, stable completion identity, accounting and
validated-result receipt. Migrations16–18 add per-attempt billing day and immutable evidence;
narrow cancellation/deadline refinement preserves prior completion history. Its integration
tests cover concurrency, midnight, audit rollback, replay and proven-unsent expiry refunds.

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

### `@dentabill/summary-worker` — apps/summary-worker

**Purpose:** Frozen-input synthetic summaries and explicitly selected native findings with durable ownership.
**Entry:** `apps/summary-worker/src/index.ts`.
**Key files:** `handler.ts` routes by stored generation1 provider before the new-job selector,
then validates fixed synthetic provenance, reserves before submission,
saves usage independently, and resumes response/review effects with original claim guards.
`inference-process.test.ts` / fixture use child processes, localhost HTTP and fsynced provider
receipts to prove SIGKILL recovery boundaries. Legacy Redis cost guards are unused by production
wiring. `@dentabill/summarizer` production factory refuses a configured Anthropic key; explicit
LiveClaude comparison fixtures remain available. `observation-inference.ts` exports the explicit
durable Fireworks gateway, authorizing a terminal call and claim version before reservation.
`observation-inference.test.ts` uses native localhost HTTP and Postgres; `observation-process`
tests/fixture use separate processes and fsynced synthetic receipts for admission/response
SIGKILL and cancellation proofs. `observation-source.ts` binds a single final CallEvent and exact
text hash to the call; `observation-publication.ts` validates saved results before immutable
publication, preserving legacy summaries and financial state. `packages/db/src/lib/claim-observations.ts`
serializes versions, checks original call-intent chronology and records exact-version reviews.
API `routes/v1/claim-observations.ts` exposes scoped list/publish/review; web claim-detail
`claim-observations.tsx` shows source excerpts, synthetic labeling and review freshness.
`observation-regeneration.ts` builds exact server previews, persists Owner/Admin approval and
executes/resumes the saved generation. `packages/db/src/lib/observation-regenerations.ts` and
migrations 20/21 enforce immutable approvals and per-send currentness. API
`observation-regenerations.ts` exposes preview/approve/resume with audited evidence and a 30-second
response budget; web `observation-regeneration-controls.tsx` preserves submission identity and
requires explicit recovery. `model-gateway/replay.test.ts` verifies expired/no-key receipt
recovery cannot send. `observation-handler.ts` builds native generation1 requests from final
events, recovers stored receipts and publishes findings or commits review disposition.
`runtime-summarizer.ts` defers legacy factory construction so it cannot prevent native recovery.
Migration22 adds immutable native release snapshots; admission rechecks claim/source/approval
before fresh sends. `call-analysis-status.tsx` shows bounded processing status and links findings;
the status/retry API and operations recovery recognize native durable completion. Checked-in
manifests remain unapproved and new-job defaults remain synthetic (ADR-068).

## Cross-cutting integrations

| Integration            | Used by                               | Notes                                                             |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Postgres 16 + Prisma 6 | `@dentabill/db` (consumed everywhere) | Multi-tenant; every query filtered by `organizationId`            |
| Redis 7 + BullMQ       | api + workers + `@dentabill/queue`    | Local: docker-compose. Prod: TBD per ADR-004                      |
| Retell AI              | `apps/call-worker`                    | IVR navigation + voice calls (Phase 3)                            |
| Anthropic comparison   | Explicit test/comparison adapter      | Production factory disabled; Fireworks worker integration pending |
| Clerk                  | `apps/web`, `apps/api`                | Auth and org membership (Phase 2)                                 |
| Retell-managed Twilio  | `apps/call-worker` (via Retell)       | Verified configured carrier; Telnyx remains a deferred candidate  |
| Resend                 | `apps/api`                            | Transactional email — call-completion notifications (Phase 4)     |
| Stripe                 | `apps/web`, `apps/api`                | Metered billing (Phase 6)                                         |

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

## Source-aware CSV imports (FW-19/20)

- `apps/api/src/lib/csv/{parser,detector,normalisers,types}.ts`: bounded logical-record parsing,
  explicit source IDs/versions, validated dates/amounts, transient complete source cells.
- `apps/api/src/lib/csv/insert.ts`: scoped identity/fingerprint lookup, no-overwrite row outcomes,
  tenant-serialized atomic chunk writes and aggregate audit; `insert.test.ts` uses real Postgres.
- `apps/api/src/routes/v1/ingest.ts`: required source-database header and row report API;
  `apps/api/src/app.ts` permits its browser CORS header. SDK contract is generated.
- `apps/web/src/components/dashboard/claims/claims-import-page.tsx` and
  `apps/web/src/lib/claims/use-claims-import.ts`: required source database, scoped form state,
  conflict guidance, links, pagination and safe report download.
- `packages/db/prisma/migrations/20261014010000_claim_source_identity/migration.sql` and
  `packages/db/src/lib/claim-source-migration.test.ts`: expand-only constrained provenance;
  full prior-migration replay proves legacy duplicate/state preservation.
- `apps/api/test/fixtures/csv/README.md`: exact CSV contract and synthetic examples.

## Imported procedure and coverage snapshots (FW-21 first slice)

- `apps/api/src/lib/csv/source-details.ts`: strict version1 child contract, exact totals and bounded input.
- `apps/api/src/lib/csv/{parser,insert}.ts`: optional JSON columns, versioned fingerprints, parent/child/audit atomic import.
- `packages/db/prisma/migrations/20261014020000_claim_source_details/migration.sql`: scoped snapshot/child keys, admission, immutable facts and deferred sealing.
- `packages/db/src/lib/claim-source-details{,-migration}.test.ts`: real Postgres invariants and non-destructive migration replay.
- `apps/api/src/routes/v1/claim-source-details.ts`: scoped GET-only projection/serialization.
- `apps/web/src/components/dashboard/claims/claim-source-details.tsx`: imported totals, procedure pagination and explicit claim coverage.
- `apps/web/src/lib/claims/use-claim.ts`: practice-scoped detail cache and status mutation preservation.
- `apps/api/test/fixtures/csv/opendental-source-details-synthetic.csv`: one custom fabricated upload with repeated codes and secondary target coverage.

## Reviewed remittance evidence (FW-21 next slice; ADR-073)

- `apps/api/src/lib/remittances/contract.ts`: custom signed-money/source/line/adjustment contract and wire schemas.
- `apps/api/src/lib/remittances/service.ts`: atomic import, exact replay, fresh review previews, bounded reversals and paged report summaries.
- `apps/api/src/routes/v1/claim-remittances.ts`: four authenticated routes with closed validation/error handling.
- `apps/api/src/routes/v1/claim-remittances.test.ts`: real-Postgres HTTP workflow and fault tests.
- `packages/db/prisma/migrations/20261014030000_remittance_evidence/migration.sql`: immutable evidence/review/allocation/adjustment tables, tenant FKs and deferred invariants.
- `packages/db/src/lib/remittance-evidence{,-migration}.test.ts`: direct SQL, concurrent reversal and preservation checks.
- `apps/web/src/components/dashboard/claims/claim-remittances.tsx`: custom JSON upload, source inspection, review and explicit unverified cash/posting/settlement.
- `apps/web/src/lib/claims/use-remittances.ts`: scoped paging, fixed errors and exact review retry commands.
- `apps/api/test/fixtures/remittances`: fabricated compatible payment/reversal inputs and contract notes.

## Cash source observation lifecycle (FW-44 first slice; ADR-074)

- `apps/api/src/lib/cash-evidence/{contract,service}.ts`: bounded custom source observations, account summaries, source revision previews and atomic review/replay.
- `apps/api/src/routes/v1/cash-evidence{,.test}.ts`: five authenticated routes and real-Postgres lifecycle/failure tests.
- `packages/db/prisma/migrations/20261014040000_cash_source_evidence/migration.sql`: immutable source identities, evidence, reviews, admission serialization and bounded replacement graph.
- `packages/db/prisma/migrations/20261014050000_cash_source_token_bounds/migration.sql`: additive cash-only UTF-16/trim/Unicode checks; validated atomically without changing retained facts or shared helpers.
- `packages/db/src/lib/cash-source-evidence{,-migration}.test.ts`: direct ledger races, canonical validation and preexisting remittance preservation.
- `apps/web/src/app/dashboard/cash-evidence/page.tsx`: dashboard entry with normal auth/onboarding shell.
- `apps/web/src/components/dashboard/cash-evidence`: actual upload/inbox/account/history/preview UI, synthetic fixtures and transport-level regressions.
- `apps/web/src/lib/cash-evidence/use-cash-evidence.ts`: scoped generated-SDK access, paging and stable uncertain commands.
- `apps/api/test/fixtures/cash-evidence`: fabricated pending/posted/removed/debit/replacement JSON inputs and explicit limitations.

## Remittance batch evidence (FW-44; ADR-075)

- `apps/api/src/lib/remittance-batches/{contract,service}.ts`: bounded immutable source batches, signed provider effects, exact accepted member bindings, fresh preview and audit-safe review/replay.
- `apps/api/src/routes/v1/remittance-batches{,.test}.ts`: five authenticated routes including source-ordered history (ADR-080) and synthetic real-Postgres regressions.
- `packages/db/prisma/migrations/20261014060000_remittance_batch_evidence/migration.sql`: four immutable tables, scoped restrictive references, batch-only token helpers, admission serialization and complete accepted-member sealing.
- `packages/db/src/lib/remittance-batch-evidence{,-migration}.test.ts`: direct SQL, tenant/race invariants and exact preexisting-data/helper preservation.
- `apps/web/src/app/dashboard/remittance-batches/page.tsx`: authenticated dashboard entry.
- `apps/web/src/components/dashboard/remittance-batches`: source inbox, header/listed totals, original signs, member review and transport-level regressions.
- `apps/web/src/lib/remittance-batches/use-remittance-batches.ts`: scoped generated-SDK paging, preview and stable retry commands.
- `apps/api/test/fixtures/remittance-batches` and `apps/web/public/examples/synthetic-remittance-batch.json`: explicitly fabricated custom JSON, not native provider exports.

## Cash-to-batch reconciliation (FW-44; ADR-076)

- `apps/api/src/lib/cash-reconciliation/{contract,service}.ts`: signed partial matching, retained replacement reservations, immutable decision receipts, dynamic status and full releases.
- `apps/api/src/routes/v1/cash-reconciliation{,.test}.ts`: five scoped handlers and55 real-Postgres workflow/fault/race regressions.
- `packages/db/prisma/migrations/20261014170000_cash_batch_reconciliation/migration.sql`: two immutable tables, exact accepted-source references, bounded historical identity components, capacity/ledger admission and organization serialization.
- `packages/db/src/lib/cash-batch-reconciliation{,-migration}.test.ts`: direct SQL, capacity/tenant/revision/race/overflow invariants and preservation proof.
- `apps/web/src/app/dashboard/cash-reconciliations/page.tsx`: authenticated dashboard entry.
- `apps/web/src/components/dashboard/cash-reconciliations`: explicit source selection, signed preview, current/stale/released history and full release controls.
- `apps/web/src/lib/cash-reconciliations`: scoped generated-SDK transport, source paging, immutable uncertain retries and tests.

## Independent PMS posting observations (FW-44; ADR-078)

- `apps/api/src/lib/posting-evidence/{contract,service}.ts`: bounded receipt/revision source facts, exact replay, separate totals and fresh reviews.
- `apps/api/src/routes/v1/posting-evidence{,.test}.ts`: five authenticated handlers and51 synthetic real-Postgres lifecycle/fault/race tests.
- `packages/db/prisma/migrations/20261014180000_posting_source_evidence/migration.sql`: four immutable scoped tables, accepted-entry mirrors and historical membership admission.
- `packages/db/src/lib/posting-source-evidence{,-migration}.test.ts`:89 direct SQL/tenant/race cases and prior financial/helper preservation proof.
- `apps/web/src/app/dashboard/posting-evidence/page.tsx`: dashboard entry; components in `apps/web/src/components/dashboard/posting-evidence`.
- `apps/web/src/lib/posting-evidence/use-posting-evidence.ts`: scoped generated-SDK transport, paging and exact uncertain retries.
- `apps/api/test/fixtures/posting-evidence`: six custom fabricated source examples and limitations; web download at `apps/web/public/examples/synthetic-posting-evidence.json`.

## Transactional review notifications (FW-40; ADR-079, local only)

- `packages/db/prisma/migrations/20261014190000_review_notification_outbox/migration.sql`: four scoped intent/delivery/attempt/receipt tables, immutable bindings, source/recipient admission, lease/deadline guards and deferred completion seals; migration 31 applied only to localhost isolated/shared databases.
- `packages/db/src/lib/review-notifications.ts`: transaction-bound enqueue/suppression and bounded attempt/receipt lifecycle; corresponding invariant and migration-preservation test files.
- `packages/db/src/lib/{inference,claim-observations}.ts` and `apps/summary-worker/src/handler.ts`: atomic review-required/native/synthetic publication hooks and native human-review suppression. Regeneration preserves its recorded actor.
- `packages/notifier/src/review-notification.ts`: strict generic payload/hash contract and a finite-window synthetic transport; no network or live adapter.
- `apps/summary-worker/src/review-notification-dispatch.ts`: explicit synthetic-only dispatch, persisted ownership before submission, bounded timeout and receipt commit; process fixture/tests cover crash boundaries with 9 passing process/transport cases. The full worker run passed 144/145; a focused 3/3 process recheck passed after bounded timeout alignment. This is passing evidence across runs, not a clean full rerun.
- `apps/api/src/routes/v1/notification-operations{,.test}.ts`: two audited OWNER/ADMIN GETs for filtered scoped lists/counts and attempt history; delivery mode is DISABLED.
- `apps/web/src/components/dashboard/settings/operations/review-notifications.tsx`: read-only list/filter/history and scoped claim/call links within Operations.
- `apps/web/src/lib/operations/{use-notifications,notification-labels}.ts`: user/practice-scoped generated-SDK reads, cancellation, closed diagnostic labels and recipient-binding state. No send/retry/rebind mutation.

## Remittance batch source revisions (FW-44; ADR-080, local only)

- `packages/db/prisma/migrations/20261014200000_remittance_batch_revisions/migration.sql`: three immutable identity/revision/ownership sidecars, structural backfill, automatic SQL linkage, deferred seals, latest-observed acceptance and stable-batch cash reservation guards; migration 32 applied only to localhost isolated/shared databases.
- `packages/db/src/lib/remittance-batch-revisions{,-migration}.test.ts`: direct SQL/tenant/race invariants and preservation of earlier evidence, receipts, member bindings, matches, releases and helpers.
- `apps/api/src/lib/remittance-batches/{contract,service}.ts`: unchanged v1 payloads, explicit v2 sequences, source-ordered history, added/retained/omitted preview and immutable review replay with refreshed currentness.
- `apps/api/src/routes/v1/remittance-batches{,.test}.ts`: five scoped handlers including audited history; generated contract in `packages/api-sdk`.
- `apps/api/src/lib/cash-reconciliation/{contract,service}.ts`: latest observed batch bindings and retained stable-batch reservations, with lifecycle regressions in the cash reconciliation route tests.
- `apps/web/src/components/dashboard/{remittance-batches,cash-reconciliations}` and `apps/web/src/lib/remittance-batches`: existing dashboard extensions for source history, membership changes, shared sequence labels and stale reservation explanation.
- `apps/api/test/fixtures/remittance-batches/07-corrected-net-140.json` and `apps/web/public/examples/synthetic-remittance-batch-v2.json`: fabricated correction/download examples, without a real connector or financial instruction.

## Reviewed posting-entry relationships (FW-44; ADR-081, local only)

- `packages/db/prisma/migrations/20261014210000_posting_claim_relationships/migration.sql`: immutable relationship/release tables, exact scoped references, organization/claim admission and source-entry reservation guards; no historical backfill or prior helper changes.
- `packages/db/src/lib/posting-claim-relationships{,-migration}.test.ts`: direct SQL, freshness/identity/tenant/race invariants and previous-record/helper preservation.
- `apps/api/src/lib/posting-relationships/{contract,service}.ts`: exact-source target resolution, claim/optional line previews, immutable decision receipts, dynamic currentness and full release.
- `apps/api/src/routes/v1/posting-relationships{,.test}.ts`: six scoped audited handlers, strict retry and cursor binding; registration in `apps/api/src/app.ts`, generated types in `packages/api-sdk`.
- `apps/web/src/components/dashboard/posting-evidence/posting-relationships.tsx`: target review, current/stale/released history and explicit full release within the existing posting evidence page.
- `apps/web/src/lib/posting-evidence/use-posting-relationships.ts`: user/practice-scoped SDK reads/mutations and stable uncertain retry commands.
- `apps/api/test/fixtures/posting-relationships` and `apps/web/public/examples/synthetic-posting-associations.json`: fabricated exact-source claims/lines and header150/entries180 examples, without authenticated exports or external posting.

## Synthetic demo preparation (FW-45; ADR-082, local only)

- `apps/web/public/examples/demo/manifest.json` and sibling CSV/JSON files: connected synthetic identity/financial bundle and content hashes, including optional correction/release chapter.
- `apps/api/src/lib/demo/bundle.ts`: bounded file/hash admission through existing import contracts plus cross-file identity and financial checks; no imports or database mutations.
- `apps/api/src/lib/demo/preflight-policy.ts`: dedicated localhost/demo-name, local-origin, explicit synthetic configuration, Clerk format and exact actor/migration assessment.
- `apps/api/src/lib/demo/preflight-database.ts`: local migration checksum reader and read-only repeatable-read database metadata inspection.
- `apps/api/scripts/demo-preflight.mts` and API package script `demo:preflight`: outer configuration admission, private-runtime execution with an explicit environment allowlist, closed JSON reports and cleanup; no seed/reset or app launcher behavior.
- `apps/api/src/lib/demo/isolated-runtime.ts`: private0700 temporary schema/client/native engine, generated env-path checks, minimal generator/esbuild child environments and bundled workspace modules; only private Prisma and trusted logger packages remain external.
- `apps/api/src/lib/demo/preflight-command.ts`: bundle/migration/read-only database checks executed only inside that private runtime.
- `apps/api/src/lib/demo/{bundle,bundle-flow,preflight-policy,preflight-database,preflight-cli,isolated-runtime}.test.ts`: fixture/workflow checks and isolation/process regression proof; root122 and helper15 pass in separate runs; current API/dependency checks24/24, strict CLI types and API build pass.
- `DEMO.md`: current-screen walkthrough, expected source facts, optional chapters and recording boundaries; authenticated rehearsal and the landing video asset remain separate deliverables.
