# DentaBill codemap

Navigable index of the monorepo. Maintained by the `/codemap-update` skill —
refresh after adding or removing a workspace.

> **Phase 1 — Foundations.** All 11 workspaces scaffolded. `apps/web`,
> `apps/api`, `apps/call-worker`, `apps/summary-worker` are stubs awaiting
> Phase 2/3/4 implementations. `packages/db` awaits the Prisma schema
> (P1-T4). `packages/queue`, `packages/payer-ivr`, `packages/ui` are
> stubs awaiting Phase 2/3.

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

### `@dentabill/queue` — packages/queue (stub) — Phase 3

**Purpose:** BullMQ job type definitions and queue setup.
**Entry:** `packages/queue/src/index.ts`

### `@dentabill/payer-ivr` — packages/payer-ivr (stub) — Phase 3

**Purpose:** Insurance payer IVR navigation maps (Delta Dental PPO,
Cigna Dental, MetLife Dental in Phase 1; Aetna, Guardian, United Concordia,
Humana in Phase 2).
**Entry:** `packages/payer-ivr/src/index.ts`

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

### `@dentabill/call-worker` — apps/call-worker (stub) — Phase 3

**Purpose:** BullMQ worker that drives outbound Retell AI calls.
**Entry:** `apps/call-worker/src/index.ts`

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
