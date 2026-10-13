# DentaBill Deploy Runbook — Vercel-only (serverless, no Redis)

**Decision record:** ADR-053. **Branch:** `deploy/vercel-serverless`. This runbook replaces the Railway topology in `docs/DEPLOY.md` for a $0-infra deployment: everything runs on Vercel (Pro, Fluid Compute) plus Neon Postgres (free). **There is no Redis and there are no always-on workers.**

## Topology

| Piece                              | Where                              | Notes                                                                                                                                     |
| ---------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Web (Next.js 15)                   | Vercel project #1, root `apps/web` | Unchanged.                                                                                                                                |
| API (Fastify 5)                    | Vercel project #2, root `apps/api` | One Node.js function serves every route (Build Output API, `maxDuration` 800 s, response streaming on).                                   |
| Call + summary jobs                | Inside the API function            | `JOB_DISPATCH_MODE=inline`: enqueue → self-POST to `/v1/internal/jobs/*` → the existing processors run there under `waitUntil`.           |
| Live transcript (SSE)              | API function                       | No Redis ⇒ `/v1/calls/:id/events/stream` replays from Postgres, then polls `CallEvent` every 1 s; closes when the call is terminal.       |
| Postgres                           | Neon (free)                        | Pooled URL at runtime; direct URL for migrations.                                                                                         |
| call-worker / summary-worker / DLQ | **not deployed**                   | Their handler code is imported by the API. Docker/Railway/local dev keep working unchanged with `JOB_DISPATCH_MODE=bullmq` (the default). |

### How inline jobs work

1. `POST /v1/claims/:id/calls` flips the claim to `IN_QUEUE` and calls `jobDispatcher.dispatchCall(data)`.
2. The inline dispatcher fires `fetch(INTERNAL_API_BASE_URL + '/v1/internal/jobs/calls')` with header `x-internal-job-secret`, wrapped in `waitUntil` (fire-and-forget; retried 3× on network error / 5xx). The API answers the browser immediately with `202`.
3. The internal route checks the secret (SHA-256 + `timingSafeEqual`), validates the payload with the queue's Zod schema, replies `202`, and runs the job under `waitUntil` in **its own invocation** (up to 800 s).
4. Duplicate suppression: the job atomically moves the claim `IN_QUEUE → CALLING`; a replayed trigger finds it `CALLING` and is skipped. Summary jobs skip if a `CallSummary` already exists for the call (`CallSummary.callId` is unique).
5. Retries mirror BullMQ: calls 3 attempts with 30 s / 60 s backoff, summaries 3 attempts with 15 s / 30 s, bounded by a 760 s budget per invocation. On final call failure the DLQ consumer's handler runs directly (claim → `MANUAL_REVIEW`, `Call.dlqReason`, `call.dlq` event).
6. When the call ends, the handler dispatches the summary job the same way (another self-POST).

## Vercel project #2 — API (`apps/api`)

| Setting                                  | Value                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Root Directory                           | `apps/api`                                                                                                 |
| Include files outside the root directory | **Enabled** (default) — the build needs the whole pnpm workspace                                           |
| Framework Preset                         | **Other** (`"framework": null` in `apps/api/vercel.json`)                                                  |
| Install Command                          | `pnpm install --frozen-lockfile` (from `apps/api/vercel.json`)                                             |
| Build Command                            | `pnpm run build:vercel` (from `apps/api/vercel.json`)                                                      |
| Output Directory                         | leave empty — the build writes `apps/api/.vercel/output` (Build Output API v3), which Vercel deploys as-is |
| Node.js Version                          | 22.x                                                                                                       |
| Fluid Compute                            | **On** (required for 800 s and for `waitUntil` to run long)                                                |
| Function Region                          | Same region as the Neon project (e.g. `iad1` ↔ AWS `us-east-1`)                                            |
| Function config                          | Set by the build in `.vc-config.json`: `nodejs22.x`, `maxDuration: 800`, `supportsResponseStreaming: true` |

`build:vercel` = `prisma generate` (schema `binaryTargets` includes `rhel-openssl-3.0.x`) → esbuild bundles `src/vercel.ts` plus all workspace TypeScript into `dist-vercel/index.mjs` (only `@prisma/client` stays external) → `@vercel/nft` traces the bundle and copies it plus the Prisma client and the `rhel-openssl-3.0.x` query engine into `.vercel/output/functions/index.func` (~33 MB) → `config.json` routes `/(.*)` to that function. Verify locally with `pnpm --filter @dentabill/api build:vercel`.

### API environment variables

| Name                                                                                                                                                  | Secret  | Value                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_EXPERIMENTAL_COREPACK`                                                                                                                        | no      | `1` — makes Vercel use `pnpm@10.33.0` from `packageManager`                                                                 |
| `NODE_ENV`                                                                                                                                            | no      | `production`                                                                                                                |
| `DATABASE_URL`                                                                                                                                        | **yes** | Neon **pooled** URL (`…-pooler…neon.tech`) with `?sslmode=require&pgbouncer=true&connection_limit=5`                        |
| `JOB_DISPATCH_MODE`                                                                                                                                   | no      | `inline`                                                                                                                    |
| `INTERNAL_JOB_SECRET`                                                                                                                                 | **yes** | ≥ 32 chars, `openssl rand -hex 32`                                                                                          |
| `INTERNAL_API_BASE_URL`                                                                                                                               | no      | The API's production domain, e.g. `https://dentabill-api.vercel.app` (see Deployment Protection below)                      |
| `NEXT_PUBLIC_APP_URL`                                                                                                                                 | no      | Web origin, e.g. `https://dentabill.vercel.app` — the CORS allow-list                                                       |
| `API_CORS_ORIGINS`                                                                                                                                    | no      | Optional comma-separated extra origins (e.g. web preview URLs)                                                              |
| `NEXT_PUBLIC_API_URL`                                                                                                                                 | no      | The API's own URL (only used in the OpenAPI `servers` block)                                                                |
| `CLERK_SECRET_KEY`                                                                                                                                    | **yes** | Clerk dev-instance secret key — **required**: `NODE_ENV=production` refuses to boot without Clerk keys                      |
| `CLERK_PUBLISHABLE_KEY`                                                                                                                               | no      | Clerk publishable key (or set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`)                                                          |
| `CLERK_WEBHOOK_SECRET`                                                                                                                                | **yes** | Optional; only if Clerk webhooks are configured                                                                             |
| `DOB_HASH_SECRET`                                                                                                                                     | **yes** | ≥ 16 chars, freshly generated                                                                                               |
| `RETELL_WEBHOOK_SECRET`                                                                                                                               | **yes** | ≥ 16 chars, freshly generated                                                                                               |
| `DEMO_AUTOPILOT`                                                                                                                                      | no      | `true` (time-driven FakeRetell, ~75 s call)                                                                                 |
| `DEMO_IGNORE_PAYER_HOURS`                                                                                                                             | no      | `true`                                                                                                                      |
| `DEMO_SUMMARIZER_FALLBACK`                                                                                                                            | no      | `true`                                                                                                                      |
| `SUMMARIZER_AUTO_TRANSITION_ENABLED`                                                                                                                  | no      | `true`                                                                                                                      |
| `REDIS_URL`                                                                                                                                           | —       | **Leave unset.** (If ever set — e.g. a `rediss://` Upstash URL — SSE switches back to pub/sub and the cost guard to Redis.) |
| `RETELL_API_KEY`, `ANTHROPIC_API_KEY`                                                                                                                 | **yes** | **Leave unset** for the demo (see limitations)                                                                              |
| `SUMMARIZER_MAX_OUTPUT_TOKENS`, `SUMMARIZER_DAILY_TOKEN_BUDGET`, `MAX_CALL_DURATION_MS`, `MAX_HOLD_MS`, `WORKER_OUTBOUND_NUMBER`, `RETELL_AGENT_ID_*` | no      | Optional; defaults apply (same as the workers)                                                                              |
| `SSE_MAX_STREAM_MS` / `SSE_POLL_INTERVAL_MS`                                                                                                          | no      | Optional; default 780 000 on Vercel / 1 000                                                                                 |

Not needed on Vercel: `WORKER_PORT`, `QUEUE_CONCURRENCY`, `PORT`, any `STRIPE_*`, `UPSTASH_*`. `VERCEL_*` system variables are read automatically.

### Deployment Protection and self-calls

Inline jobs are HTTP calls from the API to itself. Vercel's Standard Deployment Protection puts a login wall in front of every generated `*.vercel.app` deployment URL (`VERCEL_URL`) — but **not** in front of production domains. So:

- **Production:** set `INTERNAL_API_BASE_URL` to the production domain. (Without it, production deployments already default to `VERCEL_PROJECT_PRODUCTION_URL`.)
- **Previews:** either disable protection for the API project, or enable **Protection Bypass for Automation**. Vercel then injects `VERCEL_AUTOMATION_BYPASS_SECRET`, and the dispatcher sends it as `x-vercel-protection-bypass` automatically.
- Symptom of getting this wrong: `inline job trigger failed — job was not started` (HTTP 401) in the function logs and the claim stuck in `IN_QUEUE`.

## Vercel project #1 — Web (`apps/web`)

| Setting          | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Root Directory   | `apps/web`                                                   |
| Framework Preset | Next.js                                                      |
| Install Command  | `pnpm install --frozen-lockfile` (default detection is fine) |
| Build Command    | default (`next build`, via the package's `build` script)     |
| Output Directory | default (`.next`)                                            |
| Node.js Version  | 22.x                                                         |

| Name                                                                                              | Secret  | Value                                                                               |
| ------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `ENABLE_EXPERIMENTAL_COREPACK`                                                                    | no      | `1`                                                                                 |
| `NEXT_PUBLIC_API_URL`                                                                             | no      | API production URL, e.g. `https://dentabill-api.vercel.app`                         |
| `NEXT_PUBLIC_APP_URL`                                                                             | no      | Web URL, e.g. `https://dentabill.vercel.app`                                        |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                                                               | no      | Clerk dev-instance publishable key                                                  |
| `CLERK_SECRET_KEY`                                                                                | **yes** | Clerk dev-instance secret key                                                       |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `…_SIGN_UP_URL` / `…_AFTER_SIGN_IN_URL` / `…_AFTER_SIGN_UP_URL` | no      | `/sign-in`, `/sign-up`, `/dashboard/overview`, `/onboarding` (as in `.env.example`) |
| `NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED`                                                         | no      | `true` (harmless; see limitations)                                                  |

Add both Vercel domains to the Clerk instance's allowed origins.

## Database (Neon) — migrate + seed

Prisma's migration engine needs a **direct** (non-pooler) connection; the runtime uses the **pooled** one. No `directUrl` is declared in the schema — pass the direct URL explicitly when migrating, so the Docker/Railway setups keep needing only `DATABASE_URL`.

```bash
corepack enable pnpm && pnpm install --frozen-lockfile

# 1. Schema — direct URL (Neon dashboard → Connection string, "Pooled connection" OFF)
DATABASE_URL='postgresql://…@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require' \
  pnpm --filter @dentabill/db exec prisma migrate deploy

# 2. Demo data — idempotent; --reset recreates the demo org
DATABASE_URL='postgresql://…@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require' \
  pnpm --filter @dentabill/api seed:demo
```

Run both from a shell where the repo-root `.env` will not leak in: Prisma auto-loads `.env` files but never overrides a variable that is already set, so always pass `DATABASE_URL` inline as above.

## Smoke checks after deploy

1. `GET https://<api>/v1/readyz` → `200 {"ready":true,"postgres":{"ok":true},"redis":{"ok":true,"skipped":true}}`.
2. `POST https://<api>/v1/internal/jobs/calls` without the header → `401`.
3. Sign in on the web app → Call Now on a PENDING claim → the claim goes `IN_QUEUE → CALLING` within ~2 s, the call ends ~75 s later, a summary lands and the claim transitions; audit log shows `call.enqueue`, `call.start`, `call.end`, `callSummary.generate.read`, `claim.transition`.
4. Function logs: `inline call job completed` then `inline summary job completed`.

## Known limitations / risks

- **Job duration ceiling.** A job — including all retries and backoff — must finish inside one 800 s invocation (budget 760 s). Fine for 75 s demo calls. Real telephony (15 min cap) does not fit: before going live, move jobs to a durable runner (Vercel Queues / Workflow) or back to `bullmq` workers.
- **Retries are in-invocation.** If the invocation itself dies (platform restart, OOM), the job is lost — no Redis means no persisted queue. The claim stays `CALLING`/`IN_QUEUE`; recover per `docs/RUNBOOK.md` ("single claim stuck in CALLING").
- **Trigger is fire-and-forget.** If all three trigger attempts fail, the enqueue still returned `202` and the claim stays `IN_QUEUE` (logged as `inline job trigger failed`). The user can re-enqueue after resetting the claim.
- **Summary failures** after retries are logged only (parity with BullMQ mode, which has no summaries DLQ consumer); retry via `POST /v1/calls/:id/summary/retry`.
- **Hold-detector reschedule** (not yet wired into the production handler) re-dispatches immediately through the dispatcher — same as BullMQ, which also enqueued without delay. Reschedule keys (`-r<n>`) bypass the `IN_QUEUE` lease.
- **Cost guard is per-instance** without Redis: concurrent summaries for one org on two function instances can both pass the daily token budget check (worst case: one extra summary's tokens per instance). Irrelevant with FakeClaude.
- **Rate limiting** (`@fastify/rate-limit`) was always in-memory; on Vercel it is per function instance.
- **SSE cost.** Each open stream issues two small queries per second and keeps Neon's compute awake. Streams close themselves when the call ends and are cut at 780 s (client reconnects and de-duplicates by event id). Watch Neon free-tier compute hours. Note: the web app currently renders the call detail with 5 s polling; the SSE `TranscriptStream` component exists but is not mounted.
- **Live Claude is not deployable as-is**: `@anthropic-ai/sdk` is loaded by variable dynamic import and is not a dependency of any workspace package (pre-existing; also true on Railway). Keep `ANTHROPIC_API_KEY` unset and `DEMO_SUMMARIZER_FALLBACK=true`.
- **Live Retell** remains out of scope (GOLIVE_PLAN §1a): `LiveRetell.subscribe` is a same-process registry, so webhook events never reach the handler in any topology.
- **Prisma pool.** Keep `connection_limit` low (5) — every Fluid instance opens its own pool against Neon's PgBouncer.
- **Neon cold start.** Free-tier compute autosuspends after idle; the first request after a pause can take ~1 s longer.
