# DentaBill Deploy Runbook — Railway + Vercel (Phase 5 Demo)

**Source of truth:** This runbook and `docs/GOLIVE_PLAN.md` §7 (environment matrix). Deploy decisions recorded in ADR-051.

## Overview

DentaBill Phase 5 (investor demo, phase-5/golive-demo branch) deploys to:

- **Railway:** API, call-worker, summary-worker, Postgres 16, Redis 7
- **Vercel:** Next.js frontend (apps/web)

Both platforms are free-tier capable. This document is the single source of truth for service configuration, environment variables, and the deploy sequence.

## Prerequisites

Owner must provide:

1. Railway account + API token (or direct project access via CLI)
2. Vercel account (or API token)
3. Clerk development-instance keys (from dashboard.clerk.com)
4. Optional: `ANTHROPIC_API_KEY` for live Claude summaries (else FakeClaude adapter runs)

See `docs/GOLIVE_PLAN.md` §10 (Owner-action checklist) for details.

---

## Part 1: Railway Deployment

### 1a. Create Railway Project

```bash
# Via CLI (if you have the token):
railway init

# Or via web: https://railway.app/dashboard
# Create a new project named "dentabill-demo" or similar.
```

### 1b. Provision PostgreSQL and Redis

In the Railway web dashboard:

- Click **+ New** → **Database** → **PostgreSQL** → select v16
- Click **+ New** → **Database** → **Redis** → select v7
- Wait for both to initialize (2–3 minutes)

**Note:** Capture the connection strings from the dashboard:

- `DATABASE_URL` (Postgres connection string)
- `REDIS_URL` (Redis connection string)

### 1c. Deploy API Service

#### Create the service

1. Click **+ New** → **Service from repo** (or **GitHub repo**)
2. Select the `dentabill` repo, branch `phase-5/golive-demo`
3. Set:
   - **Root directory:** `/` — the **repository root**, NOT `apps/api`
   - **Dockerfile path:** `apps/api/Dockerfile`
   - **Port:** 3001
4. Click **Deploy**

> **The root directory must stay `/`.** Railway's root-directory setting _is_ the
> Docker build context. These are monorepo Dockerfiles — they `COPY
pnpm-workspace.yaml`, `pnpm-lock.yaml` and the whole `packages/` tree, and they
> run `pnpm --filter @dentabill/db exec prisma generate`. Pointing the root at
> `apps/api` shrinks the context to that one directory and every such `COPY`
> fails with "not found". Same rule for both workers below.

#### Configure environment variables

After the build initializes, go to the service **Settings** → **Variables** and add:

```
NODE_ENV = production
DATABASE_URL = <from Postgres plugin>
REDIS_URL = <from Redis plugin>
PORT = 3001
NEXT_PUBLIC_APP_URL = https://<vercel-app-url>  # Set this after Vercel deploys
NEXT_PUBLIC_API_URL = https://<railway-api-url>
CLERK_SECRET_KEY = <your-clerk-secret-key>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = <your-clerk-publishable-key>
DOB_HASH_SECRET = <generate-32-random-chars>
RETELL_WEBHOOK_SECRET = <generate-32-random-chars>
RETELL_API_KEY = (leave empty for FakeRetell)
DEMO_IGNORE_PAYER_HOURS = true   # payer lines are closed evenings/weekends; else Call Now 422s
STRIPE_SECRET_KEY = (leave empty for free pivot)
API_CORS_ORIGINS = https://<vercel-app-url>
```

#### Create Healthcheck

In **Settings** → **Health Checks**:

- **Endpoint:** `/v1/readyz`
- **Method:** GET
- **Timeout:** 5s
- **Interval:** 30s

Wait for the build to complete. You'll see a Railway domain like `api-demo.railway.app`.

### 1d. Deploy Call-Worker Service

1. Click **+ New** → **Service from repo**
2. Same repo + branch, but:
   - **Root directory:** `/` (repository root — see the note under 1c)
   - **Dockerfile path:** `apps/call-worker/Dockerfile`
3. Set environment variables:

```
NODE_ENV = production
DATABASE_URL = <shared Postgres>
REDIS_URL = <shared Redis>
WORKER_PORT = 3010
CLERK_SECRET_KEY = (optional; workers don't auth)
RETELL_API_KEY = (empty → FakeRetell)
DEMO_AUTOPILOT = true
MAX_CALL_DURATION_MS = 900000
MAX_HOLD_MS = 600000
QUEUE_CONCURRENCY = 2
```

#### Create Healthcheck

- **Endpoint:** `/healthz`
- **Port:** 3010
- **Timeout:** 5s
- **Interval:** 30s

### 1e. Deploy Summary-Worker Service

1. Click **+ New** → **Service from repo**
2. Same repo + branch:
   - **Root directory:** `/` (repository root — see the note under 1c)
   - **Dockerfile path:** `apps/summary-worker/Dockerfile`
3. Set environment variables:

```
NODE_ENV = production
DATABASE_URL = <shared Postgres>
REDIS_URL = <shared Redis>
WORKER_PORT = 3011
ANTHROPIC_API_KEY = (empty → FakeClaude; set if you have the key)
DEMO_SUMMARIZER_FALLBACK = true   # required when ANTHROPIC_API_KEY is empty, else no summary is ever produced
SUMMARIZER_AUTO_TRANSITION_ENABLED = true
SUMMARIZER_MAX_OUTPUT_TOKENS = 4000
SUMMARIZER_DAILY_TOKEN_BUDGET = 1000000
QUEUE_CONCURRENCY = 2
```

#### Create Healthcheck

- **Endpoint:** `/healthz`
- **Port:** 3011
- **Timeout:** 5s
- **Interval:** 30s

---

## Part 2: Vercel Deployment

### 2a. Create Vercel Project

1. Go to https://vercel.com/new
2. Select the `dentabill` repo + `phase-5/golive-demo` branch
3. Set:
   - **Framework Preset:** Next.js
   - **Root Directory:** `apps/web`
   - **Build Command:** `pnpm --filter web build`
   - **Install Command:** `corepack enable pnpm && pnpm install --frozen-lockfile`

### 2b. Environment Variables

In Vercel **Settings** → **Environment Variables**, add:

```
NEXT_PUBLIC_APP_URL = https://<vercel-domain>.vercel.app
NEXT_PUBLIC_API_URL = https://<railway-api-domain>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = <your-clerk-publishable-key>
NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED = true
```

### 2c. Add Vercel Domain to Clerk

In Clerk dashboard:

1. Go to **API Keys** → **Allowed origins**
2. Add the Vercel domain: `https://<your-domain>.vercel.app`

---

## Part 3: Database Setup

### 3a. Run Migrations

Connect to Railway Postgres and run migrations:

```bash
# Via Railway CLI:
railway run -d <database-service-id> -- psql \
  -c "ALTER SYSTEM SET statement_timeout = '30s';" && \
railway run -d <database-service-id> -- \
  pnpm --filter @dentabill/db exec prisma migrate deploy
```

Or manually:

1. Use the Postgres URI from Railway dashboard
2. Run locally (with your dev .env):
   ```bash
   DATABASE_URL="<railway-postgres-uri>" \
   pnpm --filter @dentabill/db exec prisma migrate deploy
   ```

### 3b. Seed Demo Data

```bash
DATABASE_URL="<railway-postgres-uri>" \
REDIS_URL="<railway-redis-uri>" \
NEXT_PUBLIC_APP_URL="<vercel-url>" \
NEXT_PUBLIC_API_URL="<railway-api-url>" \
CLERK_SECRET_KEY="<your-secret>" \
pnpm --filter @dentabill/api exec tsx scripts/demo-seed.mts
```

There is no seed-over-HTTP endpoint — seeding is a script run against the
database URL, deliberately, so demo data can never be created by a request to
the live API.

---

## Part 4: Smoke Tests

### 4a. Health Checks

```bash
# API readiness
curl https://<railway-api-url>/v1/readyz
# Expected 200: {"ready":true,"timestamp":"…","postgres":{"ok":true},"redis":{"ok":true}}
# Returns 503 with the same shape if either dependency fails or exceeds its 800ms probe.

# Call-worker healthz
curl https://<railway-call-worker-url>/healthz
# Expected: 200 "ok" (or "draining" during shutdown)

# Summary-worker healthz
curl https://<railway-summary-worker-url>/healthz
# Expected: 200 "ok"
```

### 4b. Sign-In

1. Open https://<vercel-url>
2. Click **Sign in**
3. Use test credentials from Clerk (or create a test account)
4. You should land on `/dashboard/overview`

### 4c. SSE End-to-End (Critical!)

This is the riskiest integration point. The frontend streams call transcripts from the API in real time:

1. From the web app, open a claim detail page
2. Click **Call Now**
3. Watch the call status pulse (IN_QUEUE → CALLING → COMPLETED)
4. **Verify the live transcript appears in real time** on the call detail page

If the transcript doesn't stream:

- Check CORS: API logs should show `Access-Control-Allow-Origin: <vercel-url>`
- Check auth: The EventSource in `apps/web/src/lib/calls/use-call-event-stream.ts` must pass the Clerk token correctly
- Check proxy buffering: Vercel may buffer server-sent events — if so, add `Transfer-Encoding: chunked` to the response headers (done in the API route already)

### 4d. Autopilot Demo Call

```bash
# Trigger a full call through the real pipeline:
curl -X POST https://<railway-api-url>/v1/claims/<claim-id>/call \
  -H "Authorization: Bearer <clerk-token>" \
  -H "Content-Type: application/json" \
  -d '{"payer": "delta_dental_ppo"}'
```

Then:

1. Go to the call detail page
2. Watch the transcript stream live (if DEMO_AUTOPILOT=true on call-worker)
3. After ~75 seconds, the call completes
4. Summary appears → claim auto-transitions → audit row is logged

---

## Environment Variable Reference

Full matrix from `docs/GOLIVE_PLAN.md` §7:

| Variable                                  | API        | call-worker | summary-worker | web        |
| ----------------------------------------- | ---------- | ----------- | -------------- | ---------- |
| `NODE_ENV`                                | production | production  | production     | production |
| `DATABASE_URL`                            | ✓          | ✓           | ✓              | —          |
| `REDIS_URL`                               | ✓          | ✓           | ✓              | —          |
| `NEXT_PUBLIC_APP_URL`                     | ✓          | —           | —              | ✓          |
| `NEXT_PUBLIC_API_URL`                     | —          | —           | —              | ✓          |
| `API_CORS_ORIGINS`                        | ✓          | —           | —              | —          |
| `CLERK_SECRET_KEY`                        | ✓          | —           | —              | —          |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`       | ✓          | —           | —              | ✓          |
| `DOB_HASH_SECRET`                         | ✓          | —           | —              | —          |
| `RETELL_WEBHOOK_SECRET`                   | ✓          | —           | —              | —          |
| `RETELL_API_KEY`                          | —          | empty       | —              | —          |
| `DEMO_AUTOPILOT`                          | —          | **true**    | —              | —          |
| `DEMO_IGNORE_PAYER_HOURS`                 | **true**   | —           | —              | —          |
| `DEMO_SUMMARIZER_FALLBACK`                | —          | —           | **true**       | —          |
| `ANTHROPIC_API_KEY`                       | —          | —           | if available   | —          |
| `SUMMARIZER_AUTO_TRANSITION_ENABLED`      | —          | —           | **true**       | —          |
| `NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED` | —          | —           | —              | **true**   |
| `STRIPE_SECRET_KEY`                       | empty      | —           | —              | —          |
| `MAX_CALL_DURATION_MS`                    | —          | 900000      | —              | —          |
| `MAX_HOLD_MS`                             | —          | 600000      | —              | —          |

---

## Troubleshooting

### API won't start

**Log:** Check Railway logs for the API service.
**Common issue:** Missing `DATABASE_URL` or `REDIS_URL` — verify they match the Postgres/Redis plugin connections exactly.

### Migrations fail

**Symptom:** Timeout or permission denied on `prisma migrate deploy`.
**Fix:** Increase the Postgres `statement_timeout` (default is too aggressive). Set it to 30s in Railway's PostgreSQL settings.

### Workers keep crashing

**Log:** Check worker service logs.
**Common issue:** Bad `REDIS_URL` or `DATABASE_URL` — workers fail immediately if they can't connect.

### SSE not streaming

**Symptom:** Transcript doesn't appear on the call detail page.
**Diagnosis:**

1. Open browser DevTools → Network tab
2. Look for the EventSource request to `/v1/calls/:id/events/subscribe`
3. If it's a 401: the Clerk token isn't being passed — check the `use-call-event-stream.ts` hook
4. If it's a 403: CORS is rejecting the origin — check `API_CORS_ORIGINS` includes the Vercel URL
5. If it's a 200 but no events: check the Redis connection on the API service

### Demo call hangs

**Symptom:** Click **Call Now**, status says CALLING forever (past 90 seconds).
**Diagnosis:**

1. Check call-worker logs for errors
2. Verify `DEMO_AUTOPILOT=true` is set on call-worker (if not, the job will wait for a real Retell webhook that never comes)
3. Check `REDIS_URL` — if it's down, the worker can't publish events

---

## Clean Up (Post-Demo)

To tear down the demo infrastructure:

1. **Railway:** Delete the project (or individual services) from the dashboard
2. **Vercel:** Delete the project from the dashboard
3. **Clerk:** Remove the Vercel domain from allowed origins (no delete needed)

---

## Post-Demo Hardening (§11, GOLIVE_PLAN.md)

Items **consciously deferred** to Phase 5.1:

- **tsx → compiled runtime, all three services:** Every service (api included) starts via
  `apps/<svc>/node_modules/.bin/tsx`, not `node dist/…`. This is not laziness about the api: all seven
  workspace packages declare `"main": "./src/index.ts"` and have no JS-emitting build, so compiled api
  output would still `import '@dentabill/db'` and resolve it to TypeScript. Shipping `node dist/server.js`
  therefore requires adding real `tsc` emit (or a bundler) to those seven packages first.
- **Shrink the images (~1.74 GB each):** The runtime stage copies the whole built tree because pnpm puts
  the generated Prisma client under a content-hashed `.pnpm` path that a `COPY` cannot name. `pnpm deploy
--prod` per service, run after `prisma generate`, is the proper fix. Note the three images share their
  base and dependency layers, so on-disk cost is far below 3 × 1.74 GB.
- **Note on bin paths:** pnpm scopes package bins per workspace member, so `tsx` lives at
  `apps/<svc>/node_modules/.bin/tsx` and _not_ at the repo-root `node_modules/.bin`. Each Dockerfile
  asserts its own path at build time so a wrong CMD fails the build instead of the container.
- **Graceful shutdown hardening:** Implement full SIGTERM drain sequences with timeouts
- **Prisma schema per test suite:** Use isolated `DATABASE_URL` per Vitest suite to avoid truncation conflicts
- **Sentry + Prometheus/Grafana:** Error tracking and metrics dashboards
- **Retell go-live:** BAA + live credentials + real agent IDs + IVR navigator wiring (see §1a of GOLIVE_PLAN for the detailed gap)
- **Backups + PgBouncer:** Production Postgres safety and connection pooling
- **Custom domain + DNS:** Set up a real domain if needed post-demo

---

## References

- `docs/GOLIVE_PLAN.md` — Complete execution plan and decision record (ADR-051)
- `docs/ARCHITECTURE.md` — System topology and call lifecycle
- `CLAUDE.md` — Repo guidelines and conventions
- `docs/API_CONVENTIONS.md` — API-level standards (Zod validation, org-scoping, etc.)
- `docs/SECURITY.md` — HIPAA/PHI rules, threat model, data handling
