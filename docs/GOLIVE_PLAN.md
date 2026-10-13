# DentaBill Go-Live Plan — Investor Demo (Phase 5 compressed)

_Authored 2026-08-21 by a planning session grounded in an 8-agent parallel audit of the repo (typecheck/lint/tests re-run, all surfaces scanned). This document is the **single source of truth** for the executing session. It overrides the "Next task" in `SESSION_CONTEXT.md`. All decisions are TAKEN — do not re-litigate them; execute._

## 0. Mission and hard constraints

- **Goal:** a production-grade, live-URL, end-to-end investor demo of DentaBill in ~6 hours. Our own rendition of the LunaBill category (AI voice agent that calls dental payers and returns structured claim outcomes) — **free forever, no paywall**.
- **Non-negotiables:** UI must be minimalist and anti-slop (billers stare at it for hours — restraint, density, one accent, zero gradient/emoji/jargon). No fake screenshots — everything shown runs through the real pipeline. PHI rules stay enforced (demo data is fully synthetic, so no PHI exists anywhere).
- **Honesty constraint for the demo:** telephony is **simulation mode** — real Retell calls require a signed BAA + credentials (owner actions, impossible in hours). Everything else (queue, worker, events, SSE, Claude summarization, claim transitions, audit) is the real production pipeline. Never present simulated audio as a live payer call; present it as "simulation mode against our production pipeline."

## 1. Ground truth (audited 2026-08-21)

- **Green:** typecheck all 16 packages ✓, api vitest 133/133 ✓, web vitest 267/267 ✓. Lint fails **only** due to 7 stale untracked files (macOS/iCloud duplicates, all verified byte-identical or superseded — safe to delete; no rescue needed).
- **Complete:** 10 marketing routes; dashboard overview / claims list+detail / calls list+detail / CSV import / settings organization+billing; full API (claims CRUD, calls, SSE stream w/ Postgres replay + Redis pub/sub, ingest, webhooks Clerk/Retell, me, onboarding); 3 workers with Fake/Live adapters env-gated (`RETELL_API_KEY`, `ANTHROPIC_API_KEY`, `STRIPE_API_KEY` — empty ⇒ Fake).
- **Stubs:** `/dashboard/reports`, `/settings/{team,integrations,notifications,audit-log}` (audit-log **API exists**, viewer doesn't); `/v1/readyz` returns `{ready:true}` unconditionally; Stripe portal/webhook are Phase-4.5 stubs (irrelevant under free pivot).
- **Missing entirely:** all deployment infra (no Dockerfiles, no Railway/Vercel config, no deploy workflow); comprehensive demo seed; live-call simulator; time-driven FakeRetell (current FakeRetell is test-driven — a real enqueued job would hang to the 15-min cap and DLQ; see G-B5).
- **Design debt:** cataloged (see §5, Track C) — token drift (`rounded-[20px]`, `border-black/5|6|8`, inline `text-[28px]`), no shared heading/stat components, inconsistent card padding, user-facing "Phase N" jargon on stub pages.

### 1a. Call-execution reality check (read before making any claim about live calls)

A code-level review of the actual call path (2026-08-21) found that the **live calling capability is less real than the phase docs imply**. The handler and adapters are high quality, but:

1. **Navigator/guards are unwired.** `createIvrNavigator`, the hold detector, and the per-call duration guard (`apps/call-worker/src/{hold-detector,duration-guard}.ts`, `packages/payer-ivr/src/navigator/`) are built and unit-tested but **never constructed in the production path** — `server.ts → createCallJobHandler` doesn't use them, and `waitForCallEnd` (`apps/call-worker/src/handler.ts:376`) has **no timeout**: if Retell never emits `call.ended`, the job hangs until BullMQ stall handling. The advertised 15-min cap and hold escalation do not fire at runtime.
2. **DTMF cannot execute.** `RetellPort` (`packages/payer-ivr/src/retell/port.ts`) has only `startCall`/`endCall`/`subscribe` — no DTMF/action dispatch — and `buildStartCallInput` never passes IVR-map steps to Retell. The payer IVR maps are dead weight in the live path; IVR navigation is implicitly delegated to the Retell agent, whose prompts cover only the rep conversation.
3. **The conversational agent has never existed.** Agent IDs are placeholders (`agent_delta_dental_ppo`), `RETELL_AGENT_ID_*` defaults are empty, no Retell account/BAA exists, and the IVR maps' own comments require dial-test calibration before first production traffic. **Zero real calls have ever been placed** — all green tests run against FakeRetell.

**Consequences for this plan:** none of the demo tracks are affected — `DEMO_AUTOPILOT` (G-B5) was designed around exactly this, and everything downstream of the port (events, SSE, summarizer, transitions, audit) is real production code. But (a) the demo must never claim live-call capability (§0 honesty constraint), and (b) real telephony go-live is a **substantial engineering task**, not a credentials task — it is itemized in §11 and must be scoped as its own post-demo phase: wire guards + navigator into the handler (or formally decide the Retell agent owns IVR navigation and extend the agent prompts + add a DTMF path), provision real Retell agents, dial-test calibrate all three payer maps.

## 2. Decisions (ADR-051 cluster — final)

| #   | Decision                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Cloud:** Railway (api + call-worker + summary-worker + Postgres 16 + Redis 7) + Vercel (web). Matches PHASE_PLAN Phase 5. **billing-worker is NOT deployed** (free pivot; usage rows seeded directly).                                                                                                                                            |
| D2  | **Free-forever pivot:** billing code stays in-tree but dormant (`STRIPE_API_KEY` empty, `STRIPE_METERED_BILLING_ENABLED=false`). `/pricing` rewritten to free positioning. `/dashboard/settings/billing` becomes `/dashboard/settings/usage` (old path redirects): value-recovered framing, portal CTA removed. Do **not** delete billing packages. |
| D3  | **Demo call strategy:** synthetic data + `DEMO_AUTOPILOT=true` mode that makes FakeRetell time-driven, so clicking **Call Now** in the deployed app produces a full ~75s live call through the real pipeline (worker → CallEvents → Redis → SSE → summarizer → transition → audit). A standalone simulator script is the backup driver.             |
| D4  | **Summarizer:** `LiveClaude` iff `ANTHROPIC_API_KEY` is provided (synthetic data ⇒ no PHI ⇒ no BAA needed for the demo), else `FakeClaude`. `SUMMARIZER_AUTO_TRANSITION_ENABLED=true` for the demo. `NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED=true`.                                                                                                 |
| D5  | **New surfaces to BUILD:** `/dashboard/reports` (analytics is the investor money-shot; needs one new org-scoped API endpoint) and `/dashboard/settings/audit-log` viewer (API exists; compliance story).                                                                                                                                            |
| D6  | **Stub surfaces to POLISH, not build:** team / integrations / notifications become quiet, consistent roadmap states. All user-facing "Phase 3/4/5" copy removed everywhere.                                                                                                                                                                         |
| D7  | **Auth:** Clerk **development-instance** keys for the demo deployment (prod instance needs custom domain + DNS — too risky in hours). Keep synthetic `local_*` clerkOrgId; org migration stays deferred. Post-demo: Clerk prod instance + `migrate-clerk-orgs.mts`.                                                                                 |
| D8  | **Branching:** single branch `phase-5/golive-demo`, conventional commits per task, one PR to `main`, squash after CI green, deploy from `main`. (Exception to one-PR-per-task rule, justified by timeline; recorded here.)                                                                                                                          |
| D9  | **Stays deferred (post-demo backlog, §9):** Prometheus/Grafana, Sentry, golden-set evals, SSE chaos tests, per-suite test schemas, LiveResend, Retell go-live, Stripe entirely, graceful-shutdown hardening, tsx→compiled workers, backups/PgBouncer.                                                                                               |
| D10 | **Domains:** `*.vercel.app` + Railway-generated URLs. No custom domain today unless owner has one with DNS ready.                                                                                                                                                                                                                                   |
| D11 | **Demo org:** "Bright Smile Dental" — ~40 synthetic claims over 30 days across all statuses, realistic denial codes, transcripts, summaries, non-zero KPIs (see G-B2).                                                                                                                                                                              |
| D12 | **Dark mode:** out of scope (consistent with DESIGN.md single-look commitment).                                                                                                                                                                                                                                                                     |

## 3. Execution model for the swarm

Run each track as a **Workflow** (dynamic orchestration). Rules:

- **Parallel file edits ⇒ worktree isolation** (`isolation: 'worktree'`) with file-group partitioning so agents never touch the same file; merge sequentially; a verify stage runs `tsc --noEmit` + the affected vitest suite after each merge.
- **Every code task ships its tests in the same commit** (repo rule). UI token sweeps that break Playwright visual baselines regenerate baselines **deliberately in the same commit** with a one-line justification.
- **Pipeline over barrier:** e.g. Track C is `pipeline(fileGroups, edit → verify)`, not two synchronized waves.
- **Adversarial verify before PR:** run a review workflow (code-reviewer + security-reviewer lenses per changed area, refute-style verification of findings) and the `/security-check` skill.
- Track order: **A first (20 min, serial). B, C, D, E1–E2 in parallel. E3–E7 when owner credentials land. F last.**
- **Cut-line if time runs short:** MUST = A, B, E, C9–C10, D3–D4 of Track D (free pivot). SHOULD = C1–C8, D1, D2. COULD = C11, D5 extras.

## 4. Track A — Stabilize (MUST, serial, ~20 min)

- **G-A1** Delete the 7 untracked files (`PHASE_3_RECAP.md`, `PROJECT_STATUS.html`, `apps/api/scripts/seed-test 2.mts`, `apps/api/src/routes/v1/me.test 2.ts`, `me.test 3.ts`, `apps/web/src/components/dashboard/missing-npi-banner 2.tsx`, `apps/web/src/lib/calls/use-claim-calls 2.ts`). All verified duplicates — no rescue. Then `pnpm turbo run typecheck lint` must be fully green.
- **G-A2** Branch `phase-5/golive-demo` off `main`.

## 5. Tracks B–D — Product work (parallel)

### Track B — Demo data engine (MUST, ~90 min)

- **G-B1** `apps/api/scripts/lib/demo-builders.mts`: org/claim/call/event/summary builders lifted from the test factories (`makeOrg`/`makeClaim` in `calls.test.ts`, `seedOrgAndClaim` in call-worker e2e). Scripts-local on purpose — do not widen `@dentabill/db`'s public API today.
- **G-B2** `apps/api/scripts/demo-seed.mts`: idempotent; creates "Bright Smile Dental" (plausible NPI, 3 payers configured) + demo user; ~40 claims spread over 30 days: 12 PENDING, 2 IN_QUEUE, 1 CALLING, 10 COMPLETED (approved/paid summaries), 6 DENIED (real denial codes from the allow-list: frequency, missing-info, non-covered), 5 MANUAL_REVIEW, 4 NEEDS_INFO. One Call per non-pending claim with 3–11 min durations, full CallEvent transcripts, CallSummary rows (confidence, nextAction, synthetic rep names), BillingUsageRecord rows for the usage page. KPIs must land non-zero: callsToday ≥ 3, recoveredThisWeekCents ≈ $4–8k, sane avgCallSeconds.
- **G-B3** `apps/api/scripts/simulate-live-call.mts`: `--claim <id|auto>`; creates a Call row, replays a scripted event sequence (call.started → IVR DTMF turns → brief hold → ~12-turn rep conversation → call.ended + collectedInfo) inserting CallEvents **and** publishing via the existing `lib/call-events-pubsub.ts` path with 1.5–4s natural pacing; on end, enqueues the summary job so the real summary-worker completes the loop. This is the backup driver and the local rehearsal tool.
- **G-B4** `package.json` scripts `seed:demo` / `demo:call`; `DEMO.md` one-pager (boot → seed → URLs → expected KPI values → rehearsal checklist).
- **G-B5** **FakeRetell autopilot** (critical): new opt-in env `DEMO_AUTOPILOT=true` on call-worker. After `startCall` on FakeRetell, drive a payer-appropriate scripted scenario on real timers (~75s total) instead of waiting for test code — without it, a real enqueued job hangs to the 15-min cap and DLQs. Guard: autopilot only activates when `RETELL_API_KEY` is empty AND `DEMO_AUTOPILOT=true`. Unit test the scenario driver; keep existing test-driven behavior untouched when the env is absent.
- **G-B6** Local end-to-end proof: seed → dashboard populated; click Call Now → live transcript streams at `/dashboard/calls/[id]` → summary lands → claim transitions → audit row. Record exact timings for the demo script.

### Track C — Anti-slop UI sweep (SHOULD, except C9–C10 MUST, ~2 h wall-clock via fan-out)

File-disjoint groups; each agent gets the DESIGN.md excerpt + the concrete rule; verify stage per group.

- **G-C1** `<DashboardPageHeading>` in `@dentabill/ui` (eyebrow caption + 28px/32px display, weight 300, spec tracking/leading baked in); replace ~15 hand-rolled heading blocks.
- **G-C2** `<StatTile>` (stat + label + caption, spec sizes); unify overview KPI tiles and usage cards.
- **G-C3** Token sweep: all 13 `rounded-[20px]` → `rounded-card-large`.
- **G-C4** Token sweep: `border-black/5|6|8` (~30 sites) → `border-border-subtle` (single opacity, from tokens.ts:42).
- **G-C5** Named warmStone opacity tokens (`-ghost`, `-muted`) replacing the ad-hoc `/20 /30 /40 /60` spread (~20 sites).
- **G-C6** Typography conformance: inline `text-[22|24|28|32px]` + em-tracking → shared utilities with DESIGN.md pixel tracking and exact leading (1.08/1.13/1.17).
- **G-C7** Focus rings standardized on the global preset (fix `missing-npi-banner`, `dashboard-search`); remove arbitrary `opacity-60/70` on interactive states (call-now-pill disabled, transcript-stream reconnect).
- **G-C8** Card padding rule: default `p-6`, tight `p-4`, generous `p-8`; apply across dashboard cards.
- **G-C9 (MUST)** Copy de-jargon: remove every user-facing "Phase N" string; stub pages get quiet, confident roadmap copy in the standard empty-state pattern.
- **G-C10 (MUST)** Error-state gaps: OverviewKpiTiles gets a visible error fallback (currently silent on `/v1/calls/stats` failure); OrganizationSettingsForm gets loading + error feedback.
- **G-C11** Final `impeccable` audit → polish pass on overview / claims / calls / call detail with the app running; fix what it flags; regenerate visual baselines once, at the end.

### Track D — New surfaces + free pivot (D3–D4 MUST, D1–D2 SHOULD, ~90 min)

- **G-D1a** `GET /v1/reports/summary` — org-scoped, audited, Zod-typed aggregates: recovered-by-week (8 wks), denial reasons breakdown, claim aging buckets, per-payer outcomes, call volume/duration. Integration tests incl. cross-tenant isolation. Regenerate SDK.
- **G-D1b** `/dashboard/reports` UI — load the `dataviz` skill first; 3 restrained charts + one table, all tokens, no chart-library bloat (inline SVG or existing deps only; respect the 200KB route budget).
- **G-D2** `/dashboard/settings/audit-log` — cursor-paginated table over the existing audit API: timestamp, actor, action, entity, metadata drawer; filters by entity type + date. The compliance money-shot: show the auto-transition entry with `summaryId + confidence + promptVersion`.
- **G-D3 (MUST)** `/pricing` rewrite: "Free for practices. Forever." — mission framing (healthcare teams shouldn't pay for software this essential), what's included (everything), an honest "how is this free" note. Update landing CTAs + FAQ entries that reference paid tiers.
- **G-D4 (MUST)** Billing → Usage: route rename with redirect, nav label "Usage", portal CTA removed, copy reframed to calls made / hours saved / value recovered. Keep the data plumbing (BillingUsageRecord) untouched.
- **G-D5** Team/integrations/notifications roadmap polish (merged with G-C9 executor).

## 6. Track E — Deploy (MUST, ~2 h; E3+ blocked on owner credentials)

- **G-E1** Real `/v1/readyz`: Postgres `SELECT 1` + Redis `PING`, 800ms timeout, 503 on failure + tests (clears TODO P2-T12B).
- **G-E2** Dockerfiles + `.dockerignore`: `apps/api` multi-stage (pnpm fetch → prisma generate + tsc → `node dist/server.js`, port 3001); `apps/call-worker` and `apps/summary-worker` (pnpm install → `tsx src/bin.ts`, healthz on 3010/3011). Build all images locally as the gate. (tsx-in-prod accepted for demo; compile post-demo.)
- **G-E3** Railway project: Postgres 16 + Redis 7 plugins; services api / call-worker / summary-worker from the Dockerfiles; healthchecks `/v1/readyz` (api) and `/healthz` (workers); env per §7.
- **G-E4** `prisma migrate deploy` against Railway PG, then `seed:demo` against it.
- **G-E5** Vercel: project rooted at `apps/web`, build `pnpm --filter web build` (monorepo preset), env per §7. Add the Vercel domain to Clerk allowed origins.
- **G-E6** Cross-cutting smoke on prod URLs: healthz/readyz 200; sign-in works; dashboard populated; **verify SSE end-to-end from the Vercel origin to the Railway api** — check (a) CORS allows the Vercel origin, (b) the SSE client can authenticate (if it's a bare `EventSource`, headers can't be set — confirm the existing hook's auth mechanism works cross-origin; if not, proxy the stream through a Next.js route handler), (c) no proxy buffering breaks streaming. This is the single riskiest integration point — test it before rehearsal.
- **G-E7** Trigger a full autopilot call on production and watch it stream. Then freeze: no deploys after rehearsal starts.

## 7. Environment matrix (demo values)

| Var                                                      | api                                                              | call-worker      | summary-worker            | web (Vercel)                 |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ---------------- | ------------------------- | ---------------------------- |
| `NODE_ENV`                                               | production                                                       | production       | production                | production                   |
| `DATABASE_URL` / `REDIS_URL`                             | Railway refs                                                     | Railway refs     | Railway refs              | —                            |
| `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | dev-instance keys                                                | —                | —                         | dev-instance keys            |
| `RETELL_API_KEY`                                         | _(empty ⇒ Fake)_                                                 | _(empty ⇒ Fake)_ | —                         | —                            |
| `DEMO_AUTOPILOT`                                         | —                                                                | **true**         | —                         | —                            |
| `ANTHROPIC_API_KEY`                                      | —                                                                | —                | if available ⇒ LiveClaude | —                            |
| `SUMMARIZER_AUTO_TRANSITION_ENABLED`                     | —                                                                | —                | **true**                  | —                            |
| `STRIPE_*`                                               | empty/false                                                      | —                | —                         | —                            |
| `NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED`                | —                                                                | —                | —                         | **true**                     |
| `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_APP_URL`            | app URL for CORS                                                 | —                | —                         | Railway api URL / Vercel URL |
| `DOB_HASH_SECRET`                                        | freshly generated ≥32 chars                                      | —                | —                         | —                            |
| `RETELL_WEBHOOK_SECRET`                                  | empty for demo; real webhooks: Retell API key with webhook badge | —                | —                         | —                            |

## 8. Track F — Verify + rehearse (MUST, last ~45 min)

- **G-F1** Full local gates: `pnpm turbo run typecheck lint`, both vitest suites, Playwright (baselines regenerated once, deliberately), bundle budget, `turbo run build`.
- **G-F2** `/security-check` skill + security-reviewer agent over the diff (new endpoint, new scripts, autopilot env).
- **G-F3** Adversarial code-review workflow over the full branch diff; fix confirmed findings only.
- **G-F4** PR → CI green → squash to `main` → deploy → docs closeout (`doc-updater`: SESSION_CONTEXT / TASKS / PROGRESS / append execution ADRs).
- **G-F5** Two full rehearsals of §9 on production, timed.

## 9. Investor demo script (~10 min)

1. **Landing** — positioning + "Free for practices, forever."
2. **Sign in** → **Overview**: live KPIs (calls today, recovered this week, avg call time).
3. **Claims list**: density, priority scoring, filters — "this is the queue a biller starts their day with."
4. **CSV import**: drag a Dentrix fixture → rows appear with payer mapping + priorities. "Zero integration required to start."
5. **The moment**: open a denied claim → **Call Now** → status pulses IN*QUEUE → CALLING (say clearly: \_simulation mode — the telephony vendor goes live after the BAA; everything downstream is our production pipeline*).
6. **Call detail**: transcript streams live — IVR navigation, hold detection, rep conversation.
7. Call ends → **Claude summary** appears (outcome, denial code, next action, confidence) → claim auto-transitions → point at the **audit-log entry** with confidence + prompt version. "No black box — every AI decision is auditable."
8. **Reports**: recovered-value trend, denial reasons, per-payer performance.
9. **Security posture**: multi-tenant isolation, PHI redaction, audit trail (marketing /security page as backdrop).
10. Close: roadmap (real telephony next, more payers, PMS integrations) + free-forever mission.

## 10. Owner-action checklist (only things agents cannot do)

1. Railway account + project (or API token for CLI). 2. Vercel account (or token). 3. Clerk dev-instance keys pasted into Railway + Vercel env; add Vercel domain in Clerk dashboard. 4. Optional: `ANTHROPIC_API_KEY` for live summaries. 5. Post-demo, 5 min: GitHub branch protection on `main`. **Not needed today:** Retell BAA/keys, Stripe, Resend, custom domain, Anthropic BAA (no PHI in demo).

## 11. Post-demo hardening backlog (consciously deferred)

Retell BAA + live credentials + per-org outbound numbers → first real call runbook — **including closing the live-path wiring gap**: the IVR navigator, hold detector, and duration guard are built + unit-tested but never constructed in the production handler (`waitForCallEnd` has no timeout; `RetellPort` has no DTMF dispatch, so IVR maps never reach Retell), the agent IDs are placeholders, and real Retell agents must be provisioned + IVR digit sequences dial-test calibrated per the maps' own comments; Clerk production instance + `migrate-clerk-orgs.mts`; Anthropic BAA before any real-PHI summarization; Prometheus/Grafana + Sentry; golden-set evals + nightly; Playwright SSE chaos; per-suite Postgres test schemas; LiveResend + React Email; compiled workers + graceful shutdown for api/summary-worker; DB backups + pooling; billing decision (keep dormant or excise once free model is validated).
