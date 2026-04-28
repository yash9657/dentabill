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
  `getOrgScopedDb` → IVR map + agent prompt resolve → Claim → CALLING →
  `RetellPort.startCall` → `Call`/`CallEvent` persist → `waitForCallEnd`
  serialised chain → final state.
- `hold-detector.ts` — `MAX_HOLD_MS=600_000`; tear-down + reschedule
  with the 2-attempts-per-day cap (ADR-039).
- `duration-guard.ts` — `MAX_CALL_DURATION_MS=900_000`; per-call cap →
  DLQ + Claim → `MANUAL_REVIEW` (ADR-038).
- `dlq-consumer.ts` — drains `calls-dlq` into Postgres `CallEvent type=DLQ`.
- `e2e.test.ts` — full lifecycle against real BullMQ + Postgres + FakeRetell.

### `@dentabill/summary-worker` — apps/summary-worker (stub) — Phase 4

**Purpose:** BullMQ worker that runs Claude post-call analysis.
**Entry:** `apps/summary-worker/src/index.ts`

## Cross-cutting integrations

| Integration            | Used by                               | Notes                                                         |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Postgres 16 + Prisma 6 | `@dentabill/db` (consumed everywhere) | Multi-tenant; every query filtered by `organizationId`        |
| Redis 7 + BullMQ       | api + workers + `@dentabill/queue`    | Local: docker-compose. Prod: TBD per ADR-004                  |
| Retell AI              | `apps/call-worker`                    | IVR navigation + voice calls (Phase 3)                        |
| Anthropic Claude       | `apps/summary-worker`                 | Call transcript analysis (Phase 4)                            |
| Clerk                  | `apps/web`, `apps/api`                | Auth and org membership (Phase 2)                             |
| Telnyx                 | `apps/call-worker` (via Retell)       | Outbound PSTN (Phase 3)                                       |
| Resend                 | `apps/api`                            | Transactional email — call-completion notifications (Phase 4) |
| Stripe                 | `apps/web`, `apps/api`                | Metered billing (Phase 6)                                     |

## Conventions (cross-reference)

- Engineering rules: `docs/ENGINEERING_RULES.md`
- UX standards: `docs/UX_RULES.md`
- API conventions: `docs/API_CONVENTIONS.md`
- Architecture: `docs/ARCHITECTURE.md`
- Security & HIPAA: `docs/SECURITY.md`
- ADRs: `docs/DECISIONS.md`
- Patterns / gotchas: `docs/PATTERNS.md` _(created on first `/learn` save)_
