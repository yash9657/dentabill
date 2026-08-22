# Handoff — Phase 5 go-live, session of 2026-08-22

Written at the end of the execution session so the next one can start cold. Read
this **after** `CLAUDE.md` and **instead of** re-deriving state from
`GOLIVE_PLAN.md` — the plan is still the spec, but several of its assumptions
turned out to be wrong (see §6) and this file records what is actually true.

Branch: **`phase-5/golive-demo`**, 4 commits, nothing uncommitted.

---

## 1. Read this first or you will waste an hour

**Railway's edge range is unreachable from the owner's home network.** The
deployed API is healthy and returns `{"ok":true,…}` — verified from a phone on
cellular — but from the dev machine `69.46.46.17` (Railway's EU-West edge)
refuses ports 80 and 443 and drops ICMP entirely. DNS is correct and
authoritative (both Google and Cloudflare DoH return Status 0).

So: **`curl` against `*.up.railway.app` failing locally does NOT mean the deploy
is broken.** Verify from a different network, or via an external checker, before
touching anything. Hours went into this; do not repeat it.

---

## 2. What is live right now

Railway project **`dentabill-demo`** — `09670b28-7237-4ba8-ba93-6a5a484a281d`
<https://railway.com/project/09670b28-7237-4ba8-ba93-6a5a484a281d>

| Service            | State   | Notes                                        |
| ------------------ | ------- | -------------------------------------------- |
| Postgres 16        | running | internal only; no public proxy URL exists    |
| Redis 7            | running | exposes `REDIS_URL`                          |
| **api**            | running | `auth mode: clerk` — real auth active        |
| **call-worker**    | running | health server on 3010, `DEMO_AUTOPILOT=true` |
| **summary-worker** | running | `DEMO_SUMMARIZER_FALLBACK=true`              |

Public API: `https://api-production-1a46.up.railway.app` (port 3001), domain
`ACTIVE`. `/v1/healthz` and `/v1/readyz` both answer from outside.

Region is **EU West (Amsterdam)** — Railway's default, probably wrong for a US
demo. Worth moving; it also may relate to §1.

### Env deliberately set on Railway

- api: `NODE_ENV=production`, `PORT=3001`, `DATABASE_URL`/`REDIS_URL` as
  `${{Postgres.DATABASE_URL}}` / `${{Redis.REDIS_URL}}` references,
  `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`, Clerk keys, freshly generated
  `DOB_HASH_SECRET` + `RETELL_WEBHOOK_SECRET` (production does **not** reuse dev
  secrets), `DEMO_IGNORE_PAYER_HOURS=true`, `NEXT_PUBLIC_APP_URL` (currently
  pointing at the api's own domain — **repoint at Vercel** once that exists).
- call-worker: `WORKER_PORT=3010`, `DEMO_AUTOPILOT=true`, `WORKER_OUTBOUND_NUMBER`
  (placeholder `+15555550100`, replace with the real Retell number).
- summary-worker: `WORKER_PORT=3011`, `SUMMARIZER_AUTO_TRANSITION_ENABLED=true`,
  `DEMO_SUMMARIZER_FALLBACK=true`.

**`RETELL_API_KEY` is deliberately absent from all Railway services.** Setting it
disables `DEMO_AUTOPILOT` and `DEMO_IGNORE_PAYER_HOURS` by design, which would
make "Call Now" attempt a real payer call that cannot yet navigate an IVR. Leave
it off until §5 is done.

---

## 3. What remains, in order

1. **Migrations have not run — the Railway database is empty.** Nothing works in
   the deployed app until this happens. Two routes:
   - `railway ssh keys add` (owner action, one-time), then
     `railway ssh --service api -- sh -lc './packages/db/node_modules/.bin/prisma migrate deploy --schema packages/db/prisma/schema.prisma'`
   - or add a **pre-deploy step** on the api service in the dashboard (the
     setting exists) running the same command. This is the cleaner long-term fix.
     Then `seed:demo` the same way.
2. **Vercel** — not started. Root `apps/web`, build `pnpm --filter web build`,
   env per `docs/DEPLOY.md`. Then add the Vercel origin to Clerk allowed origins
   and set `API_CORS_ORIGINS` + `NEXT_PUBLIC_APP_URL` on the api.
3. **G-E6 SSE cross-origin** — the riskiest integration and still unverified. A
   bare `EventSource` cannot set auth headers; if it fails cross-origin, proxy
   the stream through a Next.js route handler.
4. **Track F** — `/security-check`, adversarial review over the branch diff,
   Playwright (visual baselines need one deliberate regeneration after the token
   sweep), then PR to `main`.
5. **Real telephony** — see §5.

Also open: **G-C5** (`bg-warm-stone/40|50` needs new token variants in
`tokens.ts` + `theme.css` + preset — a design-system change, deliberately not
invented mid-sweep) and **G-C11** (impeccable audit, needs the app running).

---

## 4. What was built this session

Tracks A, B, C, D, E1, E2 of `GOLIVE_PLAN.md`, via three agent workflows
(20 agents) plus hand verification and repair.

Demo data engine (deterministic builders, idempotent "Bright Smile Dental" seed,
`DEMO.md`), the live-call simulator, the FakeRetell autopilot,
`GET /v1/reports/summary`, `GET /v1/audit-logs`, a real `/v1/readyz`, the reports
UI, the audit-log viewer, the free-forever `/pricing`, billing→usage, copy
de-jargon, error states, three Dockerfiles, `docs/DEPLOY.md`, and the Track C
token sweep with two new `@dentabill/ui` primitives.

**Gates:** typecheck 16/16 packages, ESLint 0 errors everywhere, **1,009 tests
passing**, all three Docker images build, api image boots and serves.

**The pipeline is proven, not asserted.** A real enqueue on localhost produced:
`HTTP 202` → claim `PENDING → CALLING → DENIED → MANUAL_REVIEW` → call
`COMPLETED` (42s, 16 CallEvents) → `CallSummary` at 0.88 confidence → an audit
row carrying `summaryId` + `confidence` + `promptVersion`. That is demo-script
step 7 working end to end. Reproduce with the script in §7.

---

## 5. Real telephony — the actual state

The docs were out of date; this is verified.

**Works:** the `RETELL_API_KEY` is live, and **all three payer agents already
exist** in the account —

```
dentabill-delta-dental-ppo    agent_3824b19d4298104aebc8674ea6
dentabill-cigna-dental        agent_42c76f579e3d28b48492577caf
dentabill-metlife-dental      agent_92783b27d67db4954fb3b3be28
```

`apps/call-worker/scripts/provision-retell.mts` already creates/updates them
idempotently from `packages/payer-ivr/src/agents/*.ts`. Programmatic agent
authoring is **not** a missing capability — it exists.

**The gap:** the provisioner sends exactly one tool, `end_call`. The agents can
talk to a rep but **cannot press a digit**, so they cannot navigate an IVR. The
payer IVR maps never reach Retell.

**The fix, and the moat work:** compile `packages/payer-ivr/src/ivr/maps/*`
(already a `WAIT` / `DTMF` / `COLLECT_VOICE_INPUT` / `WAIT_FOR_HUMAN` step
machine) into Retell `press_digit` tools + states, emitted by the provisioner.
Verified against the SDK — this maps almost 1:1:

| Map step              | Retell                                                      |
| --------------------- | ----------------------------------------------------------- |
| `DTMF`                | `press_digit` tool + `delay_ms`                             |
| `WAIT`                | `delay_ms` (the field exists explicitly for slow IVR menus) |
| `COLLECT_VOICE_INPUT` | state prompt + existing dynamic variables                   |
| `WAIT_FOR_HUMAN`      | edge transition to the rep-conversation state               |

Retell supports per-state `tools` and `Edge` transitions, so the menu tree is
expressible declaratively. **Conclusion: do not switch vendors.** Retell has
what is needed; a migration would reset the BAA clock and buy nothing.

**Do not place a real call until these land** (all verified still missing):

- `RetellPort` has no DTMF dispatch — only `startCall` / `endCall` / `subscribe`
- `createIvrNavigator` is **never constructed** in the call-worker
- hold detector and duration guard are **not wired** into handler/server
- `waitForCallEnd` has **no timeout** — a stuck call hangs until BullMQ stalls
- agents carry no `press_digit`
- IVR digit sequences are uncalibrated (the maps' own comments say so)
- **Anthropic BAA** required before summarizing real patient data

Realistic sequencing: wire the guards (half a day, code already written and
tested) → build the compiler (~a day) → provision with a real public webhook URL
→ dial-test calibrate one payer at a time.

---

## 6. Where `GOLIVE_PLAN.md` is wrong

- §1/D5 claim the audit-log read API exists. It did not; `GET /v1/audit-logs` was
  built this session.
- §1a claims agent IDs are placeholders and no Retell account exists. Both are
  now false (§5).
- G-E2 specifies `node dist/server.js`. **Impossible here** — all seven workspace
  packages declare `"main": "./src/index.ts"` with no JS-emitting build, so
  compiled output would still import TypeScript. All three services run under
  `tsx`. Compiling is a seven-package refactor, tracked post-demo.
- D4 treats `FakeClaude` as a working fallback. It is fixture-driven and cannot
  summarize a real call (ADR-052).
- The plan never anticipated the payer business-hours guard blocking the demo
  (ADR-052).

---

## 7. Commands that matter

```bash
# Reproduce the full local pipeline proof (the thing worth trusting).
# Boots api + both workers, enqueues a real call, polls Postgres for the
# downstream effects, prints the audit trail, then cleans up its process groups.
# Needs local Postgres + Redis up (docker compose up -d).
bash scripts/prove-pipeline.sh

# Seed + simulate locally
pnpm --filter @dentabill/api seed:demo
pnpm --filter @dentabill/api exec tsx scripts/simulate-live-call.mts --claim auto --speed 20

# Railway (CLI is not installed globally; npm -g hits a permissions wall)
npx --yes @railway/cli@latest status --json
npx --yes @railway/cli@latest logs --service api
npx --yes @railway/cli@latest up --service api --ci

# Retell (read-only preview, writes nothing)
pnpm --filter @dentabill/call-worker run provision:retell -- \
  --webhook-url https://api-production-1a46.up.railway.app/v1/webhooks/retell --dry-run
```

---

## 8. Traps — each of these cost real time

- **A green gate is not a working feature.** Fakes built for tests are driven _by_
  tests. Three of the four ADR-052 defects came from assuming a `Fake*` adapter
  would work when a real job arrived. Exercise it end to end before calling it done.
- **Agents report "complete" after running only `tsc`.** This session's swarm
  produced 74 ESLint errors, three unstartable Docker images, a palette violation
  on the money-shot page, a crashing seed, a $0.00 headline KPI, a scrambled
  transcript, and a silently-broken API/UI contract — all reported complete.
  Verify by running, not by reading the report.
- **`getEnv()` is process-cached.** Mutating `process.env` in a test does nothing
  until `initEnv()`.
- **`tsx -e` transpiles to CJS**, so top-level await is a syntax error. Wrap
  probe scripts in `void (async () => { … })()`.
- **Prisma logs its pool to stdout**, so scripted DB probes need a marker line
  (`PROBE=`) rather than positional parsing.
- **Killing a backgrounded service by its subshell pid orphans the `tsx` child**,
  which keeps holding :3010/:3011 and breaks the next run with `EADDRINUSE`.
  Kill the process group (`kill -TERM -$pid`).
- **This machine runs a 2-slot `ci-slot` queue shared with other repos.** Long
  commands queue behind unrelated projects, sometimes for many minutes. Scope
  lint/test commands to changed files.
- **The pre-commit hook exceeds a 10-minute tool timeout** on large diffs
  (eslint --fix over 60 files). Run `git commit` with `run_in_background`.
- **Never `railway up` before every required env var is set** — the api
  crash-looped on a missing `NEXT_PUBLIC_APP_URL`. Required vars per service are
  the ones in `env.ts` with neither `.default()` nor `.optional()`.

---

## 9. Credentials state

In `/.env` (never printed, never committed): `RETELL_API_KEY`, all three
`RETELL_AGENT_ID_*`, `RETELL_WEBHOOK_SECRET`, `WORKER_OUTBOUND_NUMBER`,
`CLERK_SECRET_KEY` (`sk_test_…`), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_…`).

Railway CLI is authenticated as the owner. **Still needed:** a Vercel login, and
either an SSH key on Railway or a pre-deploy step for migrations. `ANTHROPIC_API_KEY`
remains optional — without it the summarizer uses the transcript-derived fallback.
