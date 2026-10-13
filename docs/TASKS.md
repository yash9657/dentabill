# Tasks

Rules:

- Each task is 1–3 hours max. Split if larger.
- Every code task includes tests (unit or integration as noted).
- Work on one feature branch per task: `phase-<n>/<short-slug>`.
- Mark `[x]` when merged. Move done tasks to the bottom (Done) section.

---

## Fireworks / dental recovery program — active 2026-10-13

Detailed scope, evidence, dependencies, estimates, and acceptance criteria live in
[FIREWORKS_IMPLEMENTATION_PLAN.md](./FIREWORKS_IMPLEMENTATION_PLAN.md), especially
§9–10. ADR-054 records the user-required open-weight Fireworks direction. These items
are tracked below; historical phase checkmarks do not imply production readiness.
Checkboxes remain unchecked until merged; local implementation is recorded explicitly.
Each FW item is a 1–3 hour slice; larger workstreams require further decomposition.

- [ ] **FW-01** Regression: repeated calls, distinct claims, and unsupported recovery metrics. _Local regression reproduced; verified with real isolated Postgres._
- [ ] **FW-02** Correct financial labels/denominators in API and UI (depends FW-01). _Implemented locally across API/SDK/UI; final verification in session context._
- [ ] **FW-03** Contain model-only financial closure and stale-state transitions. _Implemented locally; atomic commit, stale-state and fault-injection tests._
- [ ] **FW-04** Correct denial-code semantics; preserve raw/unmapped codes. _Implemented locally/tested; historical v1 prompt omission remains a W1 dependency._
- [ ] **FW-05** Remove subscriber-ID fallback; block dialing on missing identity. _Implemented locally and verified across BullMQ/inline/AWS SQS; not deployed._
- [ ] **FW-06** Real-envelope webhook/signature contract fixture. _Eleven SDK-signature/normalization contract checks now pass; no expected failures or captured-live-event claim._
- [ ] **FW-07** Transitional webhook normalization or explicit live-path disablement (FW-06). _Implemented locally: strict signature/wire normalization, transactional pending inbox, canonical final transcript, DB worker completion; synthetic HTTP/fault tests._
- [ ] **FW-08** Separate-process call/fault-injection integration harness. _Local producer-SIGKILL/early-delivery/DB-completion/replay regression passes; worker restart/no-redial proof still FW-25._
- [ ] **FW-09** Fireworks ASR/TTS, license, region, and contractual feasibility record.
- [ ] **FW-10** Typed model gateway and fake with evidence/model-release contracts. _Implemented locally in @dentabill/model-gateway; explicit synthetic provenance, reviewed release manifests and no default live release. No model approved; see ADR-063._
- [ ] **FW-11** Synthetic Fireworks adapter with host/model allowlist (FW-10). _Native-fetch adapter implemented and tested with synthetic fixtures/local HTTP; exact US route/response identity gates. Real authenticated contract probes remain unverified._
- [ ] **FW-12** Structured output, truncation, and semantic validation (FW-11). _Local strict schemas, source/version/UTF-16 anchors, conservative amount/code invariants and review-only abstention implemented. Lexical checks do not establish truth or dental accuracy._
- [ ] **FW-13** Bounded retries/deadlines/cancellation and vendor failure fixtures (FW-11). _Implemented locally: end-to-end monotonic deadline, bounded body/depth, explicit status-only retry, no fallback and cancellation-safe attempt journal. Live latency/billing behavior unverified._
- [ ] **FW-14** Redacted inference telemetry and PHI/secret log-capture regression.
- [ ] **FW-15** Annotation schema and first 25 adjudicated synthetic edge cases.
- [ ] **FW-16** Deterministic evaluation runner and report (FW-15).
- [ ] **FW-17** Intent/inbox/outbox persistence and scoped uniqueness contracts. _Retell pending inbox and scoped call intents implemented locally; transactional call/summary outbox now implemented locally with lease/backoff/quarantine and crash evidence; deployment pending._
- [ ] **FW-18** Atomic state/audit/outbox commit and crash/replay test (FW-17). _Local call/summary producer transactions and independent broker/consumer crash tests pass; scheduled production proof pending._
- [ ] **FW-19** Canonical source identity and non-destructive duplicate report.
- [ ] **FW-20** Validated uniqueness migration and concurrent import regression (FW-19).
- [ ] **FW-21** Claim-line, coverage, partial-payment, and reversal fixtures.
- [ ] **FW-22** PHI vendor/control evidence register and security-copy reconciliation.
- [ ] **FW-23** Durable runner decision within documented hosting constraints.
- [ ] **FW-24** Evidence-backed action preview with approval/version invalidation.

Prioritize FW-01–06, FW-09, FW-15, FW-22, and FW-23. Autonomous voice cannot launch
until its business inference uses approved Fireworks open weights and the explicitly
permitted ElevenLabs speech/orchestration path is measured and contractually suitable. Live workflows
require durable execution and applicable PHI agreements even for an unpaid pilot.

### Follow-on slices discovered during implementation

- [ ] **FW-25** SQS call intent ownership, ambiguous-acceptance reconciliation, and no-redial separate-process proof (AWS already deployed; updates FW-23 assumption). _Local reservation/fence/accepted-resume/DLQ and two worker SIGKILL regressions pass; unknown-ID reconciliation and persisted deadlines split into FW-34/36. Not deployed._
- [ ] **FW-26** Durable inference ownership/usage ledger; failed summary commits must not erase reported spend. _Implemented locally for synthetic generation1: org admission lock, immutable snapshot, one attempt, independent receipt, unknown liability across days, resumable response/review application and process crash proof. Fireworks per-send integration remains FW-41; notification outbox split into FW-40. No dollar ceiling or live inference claim. ADR-064._
- [ ] **FW-27** Versioned observation/summary replacement; preserve prior evidence and bind source versions. _Current retry now preserves existing summaries, requires terminal calls, refuses ambiguous/rejected runs and exposes safe Owner/Admin status. Replacement generations and Fireworks observation mapping remain open; legacy confidence/repName fields must not be fabricated._
- [ ] **FW-28** Reconcile Retell webhook-badged signing key vs generated deployment secret; verify stop-call API vs delete-call/data before any live termination. _Local config and installed-SDK transport tests pass; stop replaces destructive delete, generated secret removed; deployment/live confirmation pending._
- [ ] **FW-29** Verify custom API DNS and cold readiness behavior, restore test, and actual deployment settings without relying on Terraform alone.
- [ ] **FW-30** Investigate API rate-limit hook ordering; authenticated requests may share the pre-auth anon bucket.
- [ ] **FW-31** Fix SSE stable `(timestamp,id)` pagination, >200-event catch-up, and replay/subscription race; UI scope isolation is locally fixed. _Implemented locally, 13 regressions pass including cancellation-before-final; full-history polling IO remains an optimization limit._
- [ ] **FW-32** Make cancellation atomic and version-conditional; never overwrite a concurrently committed provider terminal time or reviewed claim state. _Implemented locally: request-only marker/event/audit, conditional claim update, pending UI and race/rollback tests; live stop confirmation pending._
- [ ] **FW-33** Operate the Retell pending inbox: scoped account reconciliation, unmatched-event retention/deletion, age/count alerts, conflicting lifecycle evidence review, and safe replay tooling.

- [ ] **FW-34** Reconcile ambiguous call intent IDs using verified provider metadata and exact agent/number identity; quarantine multiple matches and never redial on an empty lookup. _Implemented locally: owner/admin workflow, bounded read-only v3 list/v2 get, fenced positive-only binding, source evidence and distinct durable resume command, synthetic contract/API/worker/process/race proof. Real-provider compatibility, deployed relay and operational review remain unverified._
- [ ] **FW-35** Transactional call/summary outbox and bounded leased relay with crash-after-send replay, including inline acknowledgement and AWS recovery scheduling (FW-18 concrete next slice). _Implemented locally with bounded relay, two crash boundaries, inline completed receipts, BullMQ recurrence and disabled AWS schedule; deployment/schedule activation unverified._
- [ ] **FW-36** Persist observer leases and hard termination/reconciliation deadlines; stale workers must not lose accepted calls or infer terminal evidence. _Implemented locally: persisted deadline/observer lease, bounded status/stop attempts, source-only finalization, scheduled due scans and manual status workflow. Separate-process crash/stale-owner evidence; AWS rollout and authorized live confirmation remain open. See ADR-061._

- [ ] **FW-37** Scoped outbox operating visibility, age/quarantine alerts and audited recovery controls; distinguish transport receipt from completion and review legacy missing commands. _Implemented locally: Owner/Admin Operations screen, tenant-scoped age/list queries, exact-snapshot recovery with three extra delivery attempts, separate CLOSED disposition, retained BullMQ transport generations and stale-failure protection. No external notifications, deployed recovery or scheduler-health evidence; summary replay remains FW-26. See ADR-062._

- [ ] **FW-38** Allowlist database diagnostic logging and add PHI-bearing error capture regression; _Implemented locally: registered error/warn/info callbacks retain only closed target/timestamp fields; actual SQL-error and synthetic private-payload regressions pass. Caller-thrown error sanitization and full PHI lifecycle remain broader gates._

- [ ] **FW-39** Transport execution and recovery heartbeat monitoring, including delivered-but-unconsumed READY work, current-generation failure evidence across SQS/inline, and authorized alert escalation. FW-37 saved-work counters do not establish worker or scheduler health.

- [ ] **FW-40** Transactional review-notification outbox with stable identity, delivery receipts and crash/retry proof. Existing post-commit notification is best effort and can be lost; no external message is authorized by implementation alone.
- [ ] **FW-41** Awaited Fireworks per-HTTP-attempt admission and receipt hooks, bound to durable release/source/request identity and workflow version. The gateway's best-effort progress callback is not a durable admission boundary; connect no retrying live transport until each send has a committed reservation. Prove ambiguous response, cancellation, known/rejected usage, response replay and release changes before a capped synthetic evaluation.

No pilot clinic yet (user confirmed); fake data is authorized. Real connector/clinic evidence
is visibly blocked pending a test partner and authorized system access. Open Dental is a rollout
sequence; the broader capability matrix remains in scope.

---

## Phase 1 — Foundations (complete)

> Phase 1 was reshaped during the 2026-04-24 planning session — UI tasks moved to Phase 2; cloud target deferred to Phase 5; CI, commit enforcement, HIPAA primitives, architecture docs added. See `docs/PHASE_PLAN.md` and ADR-004 / ADR-005 / ADR-006. **All 12 implementation tasks landed by 2026-04-25.**

- [x] **P1-T1** Initialize Turborepo + pnpm workspace _(done 2026-04-20)_
- [x] **P1-T2** Shared config package (`packages/config`) _(done 2026-04-24)_
- [x] **P1-T2A** Commit enforcement & repo hygiene _(done 2026-04-24)_
- [x] **P1-T2B** GitHub Actions CI workflow _(done 2026-04-25)_
- [x] **P1-T11** Docker compose + `.env.example` + dev tooling _(done 2026-04-24)_
- [x] **P1-T3** Scaffold apps + packages stubs _(done 2026-04-24)_
- [x] **P1-T3A** `@dentabill/logger` (pino + PHI redaction) _(done 2026-04-24)_
- [x] **P1-T3B** `@dentabill/types` (Zod ApiError + pagination + ids + enums) _(done 2026-04-24)_
- [x] **P1-T3C** Vitest workspace + smoke tests _(done 2026-04-25)_
- [x] **P1-T12** Architecture / API / Security docs _(done 2026-04-25)_
- [x] **P1-T4** `@dentabill/db` — Prisma init + full PRD §5 schema _(done 2026-04-25)_
- [x] **P1-T4A** Audit log helper + read-side `getOrgScopedDb(orgId)` _(done 2026-04-25)_
- [x] **P1-T5** Prisma multi-tenant write middleware _(done 2026-04-25)_

---

## Phase 2 — UI + API + Ingestion (in progress)

> **Note (2026-04-25):** Phase 2 was re-planned after the visual direction lock (ADR-013) and the senior-architect-quality scope upgrade. The legacy 11-task summary is replaced below by the 55-task plan (≈ 121.5h, 7 workstreams W0–W7). Numbering is intentionally re-used from the planning doc; see `docs/DECISIONS.md` ADR-013…ADR-028 and the planning artifact in `~/.claude-premium/plans/` for full task descriptions. Doc closeout (P2-T54) will replace this section with a final tally.

### W0 — Architecture lock

- [x] **P2-T0** ADR cluster 013–028 (visual / framework / styling / primitives / API / forms / server-state / perf / a11y / visual regression / security / auth / test pyramid / MDX / i18n+Storybook deferrals) — _PR #14, 2026-04-25_

### W1 — Foundation gates (16 tasks, ~37h)

- [x] **P2-T1** `@dentabill/ui` design tokens (OKLCH color, shadow, radius, spacing, typography, motion) — _PR #15, 2026-04-25_
- [x] **P2-T2** `@dentabill/ui` Tailwind v4 preset (`@theme` + `@utility` + base layer) — _PR #16, 2026-04-25_
- [x] **P2-T3** `@dentabill/ui` shadcn primitives (Button / Input / Label / Card / Badge / Skeleton / Separator / Avatar) — _PR #17, 2026-04-25_
- [x] **P2-T4** `@dentabill/ui` brand primitives (Pill / HeroDisplay / SectionDisplay / ShadowCard / StatusDot) — _PR #18, 2026-04-25_
- [x] **P2-T5** `apps/web` Next.js 15 App Router scaffold (next/font, root layout, error/not-found/loading, robots, sitemap, icon) — _PR #19, 2026-04-25_
- [x] **P2-T6** `apps/web` security headers + strict CSP via middleware — _PR #20, 2026-04-25_
- [x] **P2-T7** Playwright + axe + visual regression foundation; new `e2e` job in CI — _PR #25, 2026-04-25_
- [x] **P2-T8** Lighthouse CI (`.lighthouserc.cjs`, `lighthouse` job) — _PR #27, 2026-04-25_
- [x] **P2-T9** Bundle budget (`@next/bundle-analyzer` + custom assertion) — _PR #26, 2026-04-25_
- [x] **P2-T10** ESLint a11y + react + react-hooks plugins in shared config — _bundled w/ T11 in PR #21, 2026-04-25_
- [x] **P2-T11** Tailwind class-order — delegated to `prettier-plugin-tailwindcss` (eslint plugin deferred until v4-native lands; documented in ADR-015 note) — _PR #21, 2026-04-25_
- [x] **P2-T12** `apps/api` Fastify v5 scaffold — _PR #23, 2026-04-25_
- [x] **P2-T13** OpenAPI from Zod + generated SDK in `packages/api-sdk` — _PR #29, 2026-04-25_
- [x] **P2-T14** TanStack Query v5 setup (`@dentabill/ui/query`) + CI hardening (vitest env defaults + Linux Playwright baseline) — _PR #30, 2026-04-25_
- [x] **P2-T15** `react-hook-form` + Zod resolver Form component — _PR #24, 2026-04-25_
- [x] **P2-T16** Web observability — `web-vitals` reporter + ErrorBoundary — _PR #28, 2026-04-25_

### W2 — Marketing site (11 tasks, ~22h)

- [x] **P2-T17** Marketing chrome (Header / Footer / CookieBanner / Newsletter) — _PR #31, 2026-04-25_
- [x] **P2-T18** Landing (`/`) — hero + waveform + value props + CTAs — _PR #32, 2026-04-26_
- [x] **P2-T19** About (`/about`) — _PR #33, 2026-04-26_
- [x] **P2-T20** Pricing (`/pricing`) — _PR #34, 2026-04-26_
- [x] **P2-T21** Security (`/security`) — _PR #35, 2026-04-26_
- [x] **P2-T22** Privacy (`/privacy`) — _PR #36, 2026-04-26_
- [x] **P2-T23** Terms (`/terms`) + ADR-029 — _PR #37, 2026-04-26_
- [x] **P2-T24** Contact (`/contact`) + same-origin POST sink — _PR #38, 2026-04-26_
- [x] **P2-T25** FAQ (`/faq`) — _PR #39, 2026-04-26_
- [x] **P2-T26** Blog skeleton (`/blog` + dynamic slug) — _PR #40, 2026-04-26_
- [x] **P2-T27** Marketing e2e suite (9 pages, axe-clean, link check, OG meta) — _PR #41, 2026-04-26_

### W3 — Auth + onboarding (4 tasks, ~9h)

- [x] **P2-T28** Clerk integration + themed `<ClerkProvider>` + `clerkMiddleware()` — _PR #42, 2026-04-26_
- [x] **P2-T29** Sign-in / sign-up / verify-email pages — _PR #43, 2026-04-26_
- [x] **P2-T30** First-login `/onboarding` (practice name / NPI / zip / accepted payers) — _PR #49, 2026-04-26_
- [x] **P2-T31** Auth e2e suite — _PR #50, 2026-04-26_

### W4 — Dashboard shell (5 tasks, ~13h)

- [x] **P2-T32** Dashboard layout (white 240px sidebar, 64px topbar, mobile drawer) — _PR #44, 2026-04-26_
- [x] **P2-T33** Sidebar nav with localStorage-persisted collapse — _PR #45, 2026-04-26_
- [x] **P2-T34** Topbar (`<OrganizationSwitcher>`, `<UserButton>`, notifications + cmd-k stubs) — _PR #46, 2026-04-26_
- [x] **P2-T35** `/dashboard/overview` with stat strip + empty-state panels — _PR #47, 2026-04-26_
- [x] **P2-T36** Page stubs (claims / calls / reports / settings/\*) — _PR #48, 2026-04-26_

### W5 — API + claims domain (6 tasks, ~17h)

- [x] **P2-T37** Fastify auth middleware (`@clerk/fastify` + test-header bypass) — _PR #51, 2026-04-26_
- [x] **P2-T38** Claims router (CRUD over `getOrgScopedDb` + audit on every read) — _PR #52, 2026-04-26_
- [x] **P2-T39** Claims pagination + filtering (cursor base64url, status / payer / search / sort) — _PR #53, 2026-04-26_
- [x] **P2-T40** Claim detail + state-machine transitions per PRD §6 — _PR #54, 2026-04-26_
- [x] **P2-T41** Claims list UI page (TanStack virtual table) — _PR #55, 2026-04-26_
- [x] **P2-T42** Claim detail UI page (history timeline + manual status edit) — _PR #56, 2026-04-26_

### W6 — CSV ingestion (9 tasks, ~19.5h)

- [x] **P2-T43** `POST /v1/ingest/claims` upload endpoint — _PR #62, 2026-04-26_
- [x] **P2-T44** Streaming CSV parser (Dentrix / Eaglesoft / Open Dental) — _PR #61, 2026-04-26_
- [x] **P2-T45** DOB hashing helper in `@dentabill/db` — _PR #57, 2026-04-26_
- [x] **P2-T46** Payer-code lookup table in `packages/payer-ivr` — _PR #58, 2026-04-26_
- [x] **P2-T47** Priority scoring helper in `@dentabill/db` — _PR #59, 2026-04-26_
- [x] **P2-T48** Bulk insert with idempotency-key — _PR #63, 2026-04-26_
- [x] **P2-T49** Ingestion integration test (3 sample CSVs, cross-org isolation) — _bundled into T48 / PR #63_
- [x] **P2-T50** Sample CSV fixtures — _PR #60, 2026-04-26_
- [x] **P2-T51** `/dashboard/claims/import` upload UI — _PR #64, 2026-04-26_

### W7 — Closeout (4 tasks, ~4h)

- [ ] **P2-T52** `PRODUCT.md` via `$impeccable teach` — **deferred to user (interactive skill; cannot be done autonomously)**
- [x] **P2-T53** `DESIGN.md` final pass (TBDs replaced with concrete tokens) — **this PR**
- [x] **P2-T54** Phase 2 doc closeout (PHASE_PLAN / TASKS / PROGRESS / CODEMAP / SESSION_CONTEXT) — **this PR**
- [x] **P2-T55** Phase 2 retro ADR (ADR-030) — **this PR**

## Phase 3 — Queue + Voice (complete)

> **All 31 tasks merged 2026-04-28/29 across PRs #80–#100.** See ADR-041 for the retrospective and `docs/RUNBOOK.md` for the oncall playbook.

- [x] **P3-T0** ADR cluster 031–040
- [x] **P3-T1** `@dentabill/queue` BullMQ wiring
- [x] **P3-T2** `@dentabill/queue` retry/DLQ policy
- [x] **P3-T3** `@dentabill/payer-ivr` IVR maps (Delta / Cigna / MetLife)
- [x] **P3-T4** `@dentabill/payer-ivr` business-hours guard
- [x] **P3-T5** `@dentabill/payer-ivr` `RetellPort` interface
- [x] **P3-T6** `@dentabill/payer-ivr` `FakeRetell` adapter
- [x] **P3-T7** `@dentabill/payer-ivr` `LiveRetell` adapter
- [x] **P3-T8** Prisma migration — `Call.attemptNumber` + `dlqReason` + composite index
- [x] **P3-T9** `apps/call-worker` bootstrap
- [x] **P3-T10** Real call-job handler
- [x] **P3-T11** IVR navigator (DTMF + retry-on-misdetect + operator fallback)
- [x] **P3-T12** Hold detector + reschedule resolver
- [x] **P3-T13** Per-call duration cap → DLQ + MANUAL_REVIEW
- [x] **P3-T14** DLQ consumer
- [x] **P3-T15** Full lifecycle e2e against real BullMQ + Postgres + FakeRetell
- [x] **P3-T16** `POST /v1/claims/:id/calls` enqueue
- [x] **P3-T17** `POST /v1/webhooks/retell` HMAC-verified
- [x] **P3-T18** `GET /v1/calls` cursor-paginated list
- [x] **P3-T19** `GET /v1/calls/:id` detail
- [x] **P3-T20** `POST /v1/calls/:id/cancel` idempotent soft cancel
- [x] **P3-T21** SDK regen + contract test
- [x] **P3-T22** Call-Now Pill on claim row + claim detail
- [x] **P3-T23** Live status indicator (muted-teal pulse for IN_QUEUE / CALLING)
- [x] **P3-T24** `/dashboard/calls` virtualised list + detail
- [x] **P3-T25** Live overview KPI tiles + `GET /v1/calls/stats`
- [x] **P3-T26** Logger PHI redact additions (`dtmf` / `transcriptText`)
- [x] **P3-T27** `audit()` extension covering Call lifecycle
- [x] **P3-T28** `docs/RUNBOOK.md` oncall playbook
- [x] **P3-T29** Phase 3 retro ADR-041
- [x] **P3-T30** Phase 3 doc closeout (PR #100)

---

## Needs your attention (blockers + decisions only you can make)

> These do **not** block writing code, but they do block taking Phase 3 to a real production phone line, and they need to be queued before Phase 4 lights up Stripe + Clerk Orgs.

### Hard blockers for Phase 3 going live

- [ ] **Sign the Retell BAA** before any real outbound call. ADR-040 makes this load-bearing — Retell holds PHI in their recordings under their BAA, and we never copy audio out. No BAA → no production traffic.
- [ ] **Provision real Retell credentials** in the prod env: `RETELL_API_KEY` (live adapter), `RETELL_WEBHOOK_SECRET` (≥16 chars, used by HMAC verify). Until both land in the prod env, the call-worker is `FakeRetell`-only and the webhook will reject every signature in constant time.
- [ ] **Provision a Retell outbound number + provider NPI** for each org. The handler reads `PayerConfig.providerNpi` first, falling back to `Organization.npi`; both must be populated for Phase 3 dialling to succeed.
- [ ] **Enable branch protection on `main`** in the GitHub UI (per `docs/SECURITY.md`). Auto-merge is currently working PR-by-PR rather than rule-bound — a force-push to `main` is technically possible today.

### Phase 4 unblockers (need your call before P4-T0 lands)

- [ ] **Anthropic API key** for the Claude summarizer (`ANTHROPIC_API_KEY`). Phase 4 W1 touches this on day one.
- [ ] **Stripe account + product/price IDs** for metered billing. The retro decided to wire usage off the existing `audit()` spine — it's plumbing-only once the IDs exist.
- [ ] **Clerk Organizations enablement** in the Clerk dashboard. ADR-031's synthetic `clerkOrgId="local_<userId>"` is the placeholder; switching it on requires choosing whether existing single-seat users keep their data on a renamed org or migrate.
- [ ] **Resend account + verified sending domain** for the post-call notifications.
- [ ] **Phase 4 priority call** — three workstreams (summarizer, billing, Clerk Orgs) are roughly independent. Default order in ADR-041 is summarizer → SSE → Stripe → Clerk Orgs; tell me if you want it different.

### Phase 2 carry-over (still deferred to you)

- [ ] **P2-T52** `PRODUCT.md` via `$impeccable teach` — interactive skill, cannot be done autonomously. Run `$impeccable teach` in a session and walk through the prompts.

### Optional housekeeping

- [ ] `sudo chown -R "$(id -un):staff" ~/.npm` — fully fixes the root-owned npm cache that broke ccstatusline today. Already worked around in `~/.claude/settings.json` (env-var override pointing at `~/.npm-claude-cache/`), so this is only if you want plain `npm`/`npx` outside Claude to work cleanly again.

---

## Phase 4 — Intelligence + Realtime + Billing (closeout 2026-05-06)

> Plan: `/Users/yashbhalgat/.claude-premium/plans/cryptic-strolling-candle.md` (approved 2026-05-06). Workstream breakdown follows W0–W8 from that plan; each task is 1–3 hours and lands in its own commit on its workstream's PR. Feature flags default OFF: `SUMMARIZER_AUTO_TRANSITION_ENABLED`, `SSE_LIVE_TRANSCRIPT_ENABLED`, `STRIPE_METERED_BILLING_ENABLED`, `CLERK_ORG_SWITCHER_ENABLED`.

### W0 — ADR cluster (gates everything else)

- [x] **P4-T0** ADRs 042–049 land in `docs/DECISIONS.md` (this PR).
- [x] **P4-T0a** TASKS.md + SESSION_CONTEXT.md + PHASE_PLAN.md updated to point at Phase 4 (this PR).

### W1 — Schema + DB foundations

- [x] **P4-T1A** Multi-tenancy gap close on `CallSummary.organizationId` _(PR #101, 2026-05-06)_
- [x] **P4-T1B** Phase-4 new tables (`BillingUsageRecord`, `Organization.featureFlags/summaryTokensUsed/ResetAt/stripeCustomerId`, `Call.cancelRequestedAt/By`, `CallEvent_callId_timestamp_idx`) _(PR #102)_
- [x] **P4-T1C** `Claim.subscriberId String?` expand-only migration + CSV importer detection _(PR #103)_
- [x] **P4-T1D** Cross-tenant isolation tests for `CallSummary`, `BillingUsageRecord` _(landed in W1A/W1B)_

### W2 — Summarizer + summary-worker

- [x] **P4-T2A** `packages/summarizer` scaffold (port + FakeClaude + Zod) _(PR #104)_
- [x] **P4-T2B** `LiveClaude` wrapper with prompt caching _(PR #105)_
- [x] **P4-T2C** Versioned prompts + denial-code allow-list _(PR #106)_
- [x] **P4-T2D** `apps/summary-worker` scaffold _(PR #107)_
- [x] **P4-T2E** Summary-worker handler with Redis cost-guard lock _(PR #108)_
- [x] **P4-T2F** Auto-transition policy gated by `SUMMARIZER_AUTO_TRANSITION_ENABLED` _(PR #109)_
- [x] **P4-T2G** Job-emission seam in `call-worker` _(PR #110)_
- [x] **P4-T2H** `GET /v1/calls/:id/summary` + `POST /v1/calls/:id/summary/retry` _(PR #111)_
- [x] **P4-T2I** PHI redaction extension in `packages/logger` _(PR #112)_
- [ ] **P4-T2J** Golden-set evals (20 fixtures × 3 payers + nightly workflow). _Deferred to Phase 5._

### W3 — Stripe metered billing

- [x] **P4-T3A** `packages/billing` (port + FakeStripe + LiveStripe) _(PR #115)_
- [x] **P4-T3B** `apps/billing-worker` daily reconciliation _(PR #116)_
- [x] **P4-T3C** `BillingUsageRecord` write with composite idempotency key _(PR #116)_
- [x] **P4-T3D** `POST /v1/webhooks/stripe` (signature stub) + idempotency framework _(PR #117)_
- [x] **P4-T3E** `GET /v1/billing/usage` + `POST /v1/billing/portal` _(PR #117)_
- [x] **P4-T3F** `/dashboard/settings/billing` web surface _(PR #118)_
- [x] **P4-T3G** Idempotency + cross-tenant isolation tests _(landed inside #115/#117)_

### W4 — Clerk Organizations migration

- [x] **P4-T4A** Reconciliation script `apps/api/scripts/migrate-clerk-orgs.mts` _(PR #119)_
- [x] **P4-T4B** Auth plugin JWT.orgId vs DB.organizationId assertion _(PR #119)_
- [ ] **P4-T4C** `OrgSwitcher` component in dashboard shell. _Deferred — only useful after migration runs against an org._
- [x] **P4-T4D** `POST /v1/webhooks/clerk` (Svix-signed) for `organizationMembership.deleted` + `organization.deleted` _(PR #119)_

### W5 — Live transcript SSE

- [x] **P4-T5A** `GET /v1/calls/:id/events/stream` (SSE + replay + heartbeat) _(PR #120)_
- [ ] **P4-T5B** Per-client circular buffer + `event: rewind` overflow signal. _Deferred — current 200-event Postgres replay covers the common case._
- [ ] **P4-T5C** `?cursor=<callEventId>` query param. _Deferred (Phase 5)._
- [x] **P4-T5D** Retell webhook publishes to `call:<retellCallId>:events` after CallEvent insert _(PR #120)_
- [x] **P4-T5E** `useCallEventStream` hook with reconnect-with-backoff _(PR #120)_
- [x] **P4-T5F** `<TranscriptStream />` component flag-gated by `NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED` _(PR #120)_
- [ ] **P4-T5G** Playwright SSE chaos tests. _Deferred to Phase 5._
- [ ] **P4-T5H** OpenAPI annotation `produces: ['text/event-stream']`. _Deferred — `@fastify/swagger` does not surface stream content-types cleanly; route is documented inline._

### W6 — Notifications

- [x] **P4-T6A** `packages/notifier` (port + FakeResend + strict templates) _(PR #113)_
- [x] **P4-T6B** `summary-worker` dispatches notifier on transition _(PR #113)_
- [x] **P4-T6C** `LiveResend` stub throws NotImplementedError when `RESEND_API_KEY` set in Phase 4 _(PR #113)_

### W7 — Cleanup carryover

- [x] **P4-prep-1** Empty-string env normalisation at the loader (ADR-049) _(landed in #103)_
- [ ] **P4-prep-2** Per-suite Postgres test schemas. _Deferred to Phase 5 — see ADR-050._
- [x] **P4-prep-4** True cancel channel via `Call.cancelRequestedAt` _(PR #114)_
- [x] **P4-prep-6** Retell webhook signature contract test _(PR #114)_

### W8 — SLOs, observability, runbook (exit gate)

- [ ] **P4-T8A** Prometheus metric helpers in `packages/logger`. _Names + targets locked in ADR-048; collection target lands with Phase 5 deployment._
- [x] **P4-T8B** `docs/SLOS.md` (this PR)
- [x] **P4-T8C** `docs/RUNBOOK.md` Phase-4 oncall scenarios (this PR)
- [ ] **P4-T8D** Synthetic monitor `apps/api/scripts/synthetic-summary-loop.mts`. _Deferred — staging deployment lands in Phase 5._
- [x] **P4-T8E** Phase-4 retro ADR-050 (this PR)

### Exit criteria

- [x] A completed call writes a `CallSummary` (with `organizationId`).
- [x] Claim auto-transitions on confidence ≥ 0.95 + safe `nextAction` when flag on; else MANUAL_REVIEW.
- [x] AuditLog row stamped `summaryId + confidence + nextAction + prompt` version.
- [x] `/dashboard/calls/[id]` SSE replays from connect + streams updates.
- [x] `BillingUsageRecord` row within 24h of RESOLVED transition; Stripe usage record posted iff flag on.
- [x] Notifier delivery log records the post-resolution event (FakeResend in Phase 4).
- [x] Pino redaction tests green for all new PHI-rich fields.
- [x] Cross-tenant isolation tests green for `CallSummary`, `BillingUsageRecord`.
- [x] CI green per merge — api 133/133 + web 267/267 vitest.
- [x] Phase-4 retro ADR (ADR-050) merged.
- [ ] Staging canary (5% orgs) ran 7 days with no SLO page. _Deferred — Phase 5 deployment prereq._

## Phase 5 — Go-live for investor demo (active 2026-08-21)

> Plan: `docs/GOLIVE_PLAN.md` (ADR-051 cluster — all decisions taken; overrides ADR-004's open cloud question: **Railway + Vercel**). Tasks below mirror the plan's IDs; full specs + acceptance live in the plan. Branch: `phase-5/golive-demo`, one PR (D8). Cut-line: MUST = A, B, E, C9–C10, D3–D4.

### Track A — Stabilize (MUST)

- [x] **G-A1** Delete 7 stale untracked duplicate files → lint fully green
- [x] **G-A2** Branch `phase-5/golive-demo`

### Track B — Demo data engine (MUST)

- [x] **G-B1** `apps/api/scripts/lib/demo-builders.mts`
- [x] **G-B2** `demo-seed.mts` — "Bright Smile Dental", ~40 claims/30 days, summaries, non-zero KPIs
- [x] **G-B3** `simulate-live-call.mts` — scripted CallEvents + Redis publish, paced
- [x] **G-B4** `seed:demo` / `demo:call` scripts + `DEMO.md`
- [x] **G-B5** FakeRetell `DEMO_AUTOPILOT` mode (time-driven ~75s scenario; guard: only when `RETELL_API_KEY` empty)
- [x] **G-B6** Local end-to-end proof + timings

### Track C — Anti-slop UI sweep (C9–C10 MUST, rest SHOULD)

- [x] **G-C1** `<DashboardPageHeading>` + replace ~15 sites
- [x] **G-C2** `<StatTile>` unification
- [x] **G-C3** `rounded-[20px]` → `rounded-card-large` (13 files)
- [x] **G-C4** `border-black/5|6|8` → `border-border-subtle` (~30 sites)
- [ ] **G-C5** Named warmStone opacity tokens _(not done: `bg-warm-stone/40|50` remain at ~3 sites. Needs new token variants in tokens.ts + theme.css + preset, which is a design-system change rather than a sweep — deliberately not invented mid-sweep.)_
- [x] **G-C6** Typography sizes/tracking/leading to DESIGN.md spec
- [x] **G-C7** Focus-ring + interactive-opacity standardization
- [x] **G-C8** Card padding rule (p-6 / p-4 / p-8)
- [x] **G-C9** Remove all user-facing "Phase N" copy; roadmap-polish stubs (MUST)
- [x] **G-C10** OverviewKpiTiles error state + OrganizationSettingsForm loading/error (MUST)
- [ ] **G-C11** `impeccable` audit → polish pass; regenerate visual baselines once _(open — needs the app running; Playwright baselines still need one deliberate regeneration after the token sweep.)_

### Track D — New surfaces + free pivot (D3–D4 MUST)

- [x] **G-D1a** `GET /v1/reports/summary` + tests + SDK regen
- [x] **G-D1b** `/dashboard/reports` UI (dataviz skill, budget-respecting)
- [x] **G-D2** `/dashboard/settings/audit-log` viewer _(plan said the read API existed; it did not — `GET /v1/audit-logs` was built too)_
- [x] **G-D3** `/pricing` → "Free for practices. Forever." + landing/FAQ updates (MUST)
- [x] **G-D4** Billing → Usage rename + redirect + portal CTA removal (MUST)
- [x] **G-D5** Team/integrations/notifications roadmap polish (with G-C9)

### Track G — Defects found by execution (ADR-052)

- [x] **G-G1** `DEMO_IGNORE_PAYER_HOURS` — the ADR-037 business-hours guard 422s "Call Now" evenings and weekends. Interlocked against `RETELL_API_KEY`; logged at warn.
- [x] **G-G2** `DEMO_SUMMARIZER_FALLBACK` — `FakeClaude` is fixture-driven and cannot summarize a real call, so the job dead-lettered and no claim ever transitioned. Added transcript-derived summaries, default off.
- [x] **G-G3** Per-process `retellCallId` namespacing — `FakeRetell`'s counter restarts at 1 each boot and `Call.retellCallId` is UNIQUE, so any worker restart broke the next call.
- [x] **G-G4** Audit-log API/UI contract reconciliation — `entityType` vs `resourceType`, and bare-date `from`/`to` support.
- [x] **G-G5** Seed KPI correctness — claim amounts were 100× too small and no claim used `RESOLVED`, so "recovered this week" read $0.00.
- [x] **G-G6** Simulator timestamp monotonicity — events were stamped with their own inter-event delay, not a running total.
- [x] **G-G7** Delete an 8th stale macOS artifact (`packages/summarizer/src/prompts 2/`) that Track A's list of 7 missed.

### Track E — Deploy (MUST; E3+ needs owner credentials)

- [x] **G-E1** Real `/v1/readyz` (SELECT 1 + PING, 800ms, 503)
- [x] **G-E2** Dockerfiles + `.dockerignore` + `docs/DEPLOY.md`; all three images build AND the api image boots serving readyz 200 _(entrypoint is `tsx`, not `node dist/…` — see ADR-052)_
- [ ] **G-E3** Railway: PG16 + Redis7 + 3 services + healthchecks + env (plan §7)
- [ ] **G-E4** `prisma migrate deploy` + `seed:demo` against Railway PG
- [ ] **G-E5** Vercel web + Clerk allowed origin
- [ ] **G-E6** Prod smoke; verify SSE auth/CORS/streaming Vercel→Railway (riskiest point)
- [ ] **G-E7** Full autopilot call on production; deploy freeze

### Track F — Verify + rehearse (MUST, last)

- [ ] **G-F1** Full local gates incl. Playwright + bundle budget + build
- [ ] **G-F2** `/security-check` + security-reviewer over diff
- [ ] **G-F3** Adversarial code-review workflow over branch diff
- [ ] **G-F4** PR → CI green → squash → deploy → docs closeout
- [ ] **G-F5** Two timed rehearsals of the demo script (plan §9)

---

## Done

- **P1-T1** Initialize Turborepo + pnpm workspace _(2026-04-20)_
- **P1-T2** `@dentabill/config` _(2026-04-24)_
- **P1-T2A** Repo hygiene + commit enforcement _(2026-04-24)_
- **P1-T2B** GitHub Actions CI workflow _(2026-04-25)_
- **P1-T11** Docker compose + .env.example + dev tooling _(2026-04-24)_
- **P1-T3** Workspace scaffold (4 apps + 7 packages stubs) _(2026-04-24)_
- **P1-T3A** `@dentabill/logger` (pino + PHI redaction) _(2026-04-24)_
- **P1-T3B** `@dentabill/types` (ApiError + pagination + ids + enums) _(2026-04-24)_
- **P1-T3C** Vitest workspace + smoke tests _(2026-04-25)_
- **P1-T12** Architecture / API / Security docs _(2026-04-25)_
- **P1-T4** `@dentabill/db` Prisma init + full PRD §5 schema _(2026-04-25)_
- **P1-T4A** Audit + read-side `getOrgScopedDb(orgId)` _(2026-04-25)_
- **P1-T5** Multi-tenant write middleware _(2026-04-25)_
- **P2-T0** ADR cluster 013–028 _(PR #14, 2026-04-25)_
- **P2-T1** `@dentabill/ui` design tokens _(PR #15, 2026-04-25)_
- **P2-T2** `@dentabill/ui` Tailwind v4 preset _(PR #16, 2026-04-25)_
- **P2-T3** `@dentabill/ui` shadcn primitives _(PR #17, 2026-04-25)_
- **P2-T4** `@dentabill/ui` brand primitives _(PR #18, 2026-04-25)_
- **P2-T5** `apps/web` Next.js 15 App Router scaffold _(PR #19, 2026-04-25)_
- **P2-T6** `apps/web` strict CSP + security headers _(PR #20, 2026-04-25)_
- **P2-T10 + T11** ESLint a11y/react plugins + prettier-plugin-tailwindcss _(PR #21, 2026-04-25)_
- **P2-T12** `apps/api` Fastify v5 scaffold _(PR #23, 2026-04-25)_
- **P2-T15** `react-hook-form` + Zod resolver Form component _(PR #24, 2026-04-25)_
- **P2-T7** Playwright + axe + visual regression foundation _(PR #25, 2026-04-25)_
- **P2-T9** Bundle budget enforcement _(PR #26, 2026-04-25)_
- **P2-T8** Lighthouse CI budgets _(PR #27, 2026-04-25)_
- **P2-T16** Web observability (web-vitals + ErrorBoundary + request-id) _(PR #28, 2026-04-25)_
- **P2-T13** OpenAPI from Zod + `@dentabill/api-sdk` codegen _(PR #29, 2026-04-25)_
- **P2-T14** TanStack Query v5 setup + CI hardening (vitest env defaults + Linux Playwright baseline) _(PR #30, 2026-04-25)_
- **P2-T17** Marketing chrome (Header / Footer / CookieBanner / NewsletterSignupStub) + `(marketing)` route group _(2026-04-25)_
- **P2-T18** Landing (`/`) hero + waveform + value props + CTAs _(PR #32, 2026-04-26)_
- **P2-T19** About page _(PR #33, 2026-04-26)_
- **P2-T20** Pricing page _(PR #34, 2026-04-26)_
- **P2-T21** Security page _(PR #35, 2026-04-26)_
- **P2-T22** Privacy page _(PR #36, 2026-04-26)_
- **P2-T23** Terms page + ADR-029 _(PR #37, 2026-04-26)_
- **P2-T24** Contact page + same-origin POST sink _(PR #38, 2026-04-26)_
- **P2-T25** FAQ page _(PR #39, 2026-04-26)_
- **P2-T26** Blog skeleton _(PR #40, 2026-04-26)_
- **P2-T27** Marketing e2e suite _(PR #41, 2026-04-26)_
- **P2-T28** Clerk integration with conditional gating _(PR #42, 2026-04-26)_
- **P2-T29** Sign-in / sign-up themed pages _(PR #43, 2026-04-26)_
- **P2-T30** `/onboarding` form _(PR #49, 2026-04-26)_
- **P2-T31** Auth e2e suite _(PR #50, 2026-04-26)_
- **P2-T32** Dashboard shell layout _(PR #44, 2026-04-26)_
- **P2-T33** Sidebar nav with persisted collapse _(PR #45, 2026-04-26)_
- **P2-T34** Topbar with Clerk + cmd-k stubs _(PR #46, 2026-04-26)_
- **P2-T35** `/dashboard/overview` _(PR #47, 2026-04-26)_
- **P2-T36** Page stubs (claims / calls / reports / settings) _(PR #48, 2026-04-26)_
- **P2-T37** Fastify Clerk auth middleware _(PR #51, 2026-04-26)_
- **P2-T38** `/v1/claims` CRUD with org-scoping + audit _(PR #52, 2026-04-26)_
- **P2-T39** Cursor pagination + filtering on `/v1/claims` _(PR #53, 2026-04-26)_
- **P2-T40** Claim state machine + state-validated PATCH _(PR #54, 2026-04-26)_
- **P2-T41** `/dashboard/claims` virtualised list page _(PR #55, 2026-04-26)_
- **P2-T42** `/dashboard/claims/[id]` detail + manual edit _(PR #56, 2026-04-26)_
- **P2-T45** `hashPatientDOB` helper _(PR #57, 2026-04-26)_
- **P2-T46** Payer canonicalisation lookup _(PR #58, 2026-04-26)_
- **P2-T47** Priority scoring helper _(PR #59, 2026-04-26)_
- **P2-T50** Dentrix / Eaglesoft / Open Dental CSV fixtures _(PR #60, 2026-04-26)_
- **P2-T44** Streaming CSV parser _(PR #61, 2026-04-26)_
- **P2-T43** `POST /v1/ingest/claims` upload endpoint _(PR #62, 2026-04-26)_
- **P2-T48 + T49** Bulk insert with idempotency + cross-org integration tests _(PR #63, 2026-04-26)_
- **P2-T51** `/dashboard/claims/import` upload UI _(PR #64, 2026-04-26)_
