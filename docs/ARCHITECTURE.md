# Architecture

This is the long-form companion to `PRD.md` §3 and `docs/CODEMAP.md`. It describes
how the runtime services fit together, the call lifecycle, and where future
work is bound to land. Keep this file conceptual — for "what file lives where"
use `docs/CODEMAP.md`; for "what the engineering rules are" use
`docs/ENGINEERING_RULES.md`.

## Style: modular monolith, not microservices

DentaBill is a **modular monolith deployed as separate processes** — one
codebase, shared types and database, but separate deployment units. This
choice (per the technical-plan source document) is intentional:

- **Shared types** between Fastify API and BullMQ workers via `@dentabill/types`
  - Prisma client — no inter-service contracts to maintain.
- **Transactional integrity** — a failed call update and a failed audit-log
  write roll back together in one Postgres transaction.
- **Operational simplicity** — three processes to monitor (api,
  call-worker, summary-worker) vs eight microservices.
- **Easy to extract later** — each "service" already lives in its own
  `apps/<x>/` folder. Splitting one out is a build-time / deploy-time
  change, not a code rewrite.

## Process topology

```mermaid
flowchart LR
  user([Dental billing staff])

  subgraph Browser
    web[apps/web<br/>Next.js 15 + Clerk]
  end

  subgraph Backend
    api[apps/api<br/>Fastify v5]
    callw[apps/call-worker<br/>BullMQ + Retell SDK]
    summw[apps/summary-worker<br/>BullMQ + Claude]
  end

  subgraph Datastores
    pg[(Postgres 16<br/>+ Prisma)]
    redis[(Redis<br/>BullMQ queues + pub/sub)]
  end

  subgraph "External services"
    retell[Retell AI<br/>voice + IVR]
    telnyx[Telnyx<br/>outbound PSTN]
    clerk[Clerk<br/>auth + orgs]
    claude[Anthropic Claude<br/>post-call analysis]
    resend[Resend<br/>transactional email]
    stripe[Stripe<br/>metered billing]
  end

  user -->|HTTPS| web
  web -->|REST + SSE| api
  web -.->|Sign in| clerk
  api -->|JWT verify| clerk
  api --> pg
  api --> redis
  api -->|Enqueue| callw
  callw --> retell
  retell --> telnyx
  retell -->|Webhooks HMAC| api
  callw -->|Job + transcript| summw
  summw --> claude
  summw --> pg
  summw -->|Email completed| resend
  api -->|SSE pub/sub| redis
  api -->|Subscription| stripe
```

**Cloud-target boundary** (per ADR-004) — Postgres, Redis, and the four
process containers are deploy-target-agnostic. The decision between
Railway and AWS lands in Phase 5; until then, each app is a vanilla
12-factor process with config from env vars and no provider SDKs in
application code.

## Call lifecycle

The state machine for a single claim → call → resolution. Each transition
is recorded as a `CallEvent` row for debugging, plus an `AuditLog` entry
for any PHI-touching read.

```mermaid
stateDiagram-v2
  [*] --> PENDING: Claim ingested (CSV upload)
  PENDING --> IN_QUEUE: Auto-enqueue (priority threshold) or manual
  IN_QUEUE --> CALLING: Call worker dequeues, dispatches Retell
  CALLING --> NAVIGATING_IVR: Call connected, DTMF script begins
  NAVIGATING_IVR --> ON_HOLD: IVR routes to rep queue
  NAVIGATING_IVR --> FAILED: IVR navigation fails (timeout, dead-end)
  ON_HOLD --> HUMAN_REACHED: Rep picks up
  ON_HOLD --> VOICEMAIL: Voicemail detected (AMD)
  HUMAN_REACHED --> COLLECTING: Agent gathers status, denial codes, ref
  COLLECTING --> COMPLETED: Call ends cleanly
  VOICEMAIL --> FAILED
  COMPLETED --> RESOLVED: Summary worker classifies as approved
  COMPLETED --> DENIED: Summary worker classifies as denied
  COMPLETED --> NEEDS_INFO: Summary worker requests more info
  COMPLETED --> APPEALING: User triggers appeal action
  COMPLETED --> WRITTEN_OFF: User decides to write off
  COMPLETED --> MANUAL_REVIEW: Confidence below threshold
  FAILED --> IN_QUEUE: Retry under retryCount limit
  FAILED --> MANUAL_REVIEW: Retries exhausted
  RESOLVED --> [*]
  DENIED --> [*]
  WRITTEN_OFF --> [*]
  MANUAL_REVIEW --> [*]
```

Status enum values are defined once in `@dentabill/types` (`CLAIM_STATUS_VALUES`,
`CALL_STATUS_VALUES`) and re-exported from `@dentabill/db` once Prisma
generates them.

## Package topology

Internal package dependency graph. Cycles are forbidden; `eslint-plugin-import`
catches them in CI.

```mermaid
flowchart TB
  config[("@dentabill/config<br/>build tooling only")]
  types["@dentabill/types<br/>Zod + ApiError + ids + enums"]
  logger["@dentabill/logger<br/>pino + PHI redaction"]
  db["@dentabill/db<br/>Prisma + middleware + audit"]
  queue["@dentabill/queue<br/>BullMQ defs"]
  payerivr["@dentabill/payer-ivr<br/>IVR maps"]
  ui["@dentabill/ui<br/>shadcn components"]

  web["apps/web"]
  api["apps/api"]
  callw["apps/call-worker"]
  summw["apps/summary-worker"]

  config -.->|devDep| types
  config -.->|devDep| logger
  config -.->|devDep| db
  config -.->|devDep| queue
  config -.->|devDep| payerivr
  config -.->|devDep| ui

  db --> logger
  db --> types

  queue --> types
  queue --> logger

  payerivr --> types

  ui --> types

  web --> ui
  web --> types

  api --> db
  api --> types
  api --> logger
  api --> queue

  callw --> db
  callw --> types
  callw --> logger
  callw --> queue
  callw --> payerivr

  summw --> db
  summw --> types
  summw --> logger
  summw --> queue
```

## Real-time updates

When a call's state changes, the dashboard updates within ~2 seconds without
a page refresh. The path:

1. The call worker writes the state update to Redis pub/sub channel
   `org:{orgId}:calls`.
2. The API server subscribes to Redis pub/sub.
3. The API holds an SSE connection per authenticated dashboard session.
4. On a Redis message, the API forwards the event to all SSE connections
   for that org.
5. The Next.js client uses `EventSource` to receive events and updates the
   React Query cache, which re-renders.

SSE is preferred over WebSockets here: unidirectional, simpler proxy/load
balancer compatibility, native to HTTP/2. Lands in Phase 4.

## Concurrency model

Each outbound call is a BullMQ job. BullMQ supports thousands of concurrent
jobs via Redis. The call-worker process runs N workers; each worker handles
M concurrent calls. Workers are stateless — any worker can take any job —
so scale is "add another container".

When the deploy target is decided (ADR-004), auto-scaling will trigger on
queue depth (BullMQ exposes a CloudWatch / Railway metric).

## Migration to microservices (later, if needed)

If a single component requires independent scaling (typical candidate:
the call-worker pool when Retell concurrency is bottlenecking), the
extraction is mechanical because:

- `apps/call-worker` already imports only `@dentabill/db`, `@dentabill/queue`,
  `@dentabill/payer-ivr`, `@dentabill/types`, `@dentabill/logger`.
- Splitting it out means: keep the same code, deploy as a separate service,
  and replace the in-process Prisma client with HTTP calls to a new
  `claim-service` if database isolation is also needed.

Deferred — unwarranted at Phase 1–4 scale.
