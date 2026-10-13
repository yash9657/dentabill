# DentaBill AI — Progress

Human-friendly status report. For details see `docs/SESSION_CONTEXT.md` and `docs/TASKS.md`.

**Last updated:** 2026-10-13
**Current work:** implementing W0 containment on AWS baseline through `c34e970`, branch
`codex/w0-containment`. The full parity goal is active; no overall completion claim.
[Capability/provider matrix](./docs/PROVIDER_EVIDENCE.md) and
[session evidence](./docs/SESSION_CONTEXT.md) distinguish local fixes, documented APIs,
actual account probes, and blocked end-to-end capabilities.

**Implemented locally:** honest operational reporting with verified payments unavailable;
model-only financial closure blocked; stale summary states protected; atomic summary/state/
audit commit; missing subscriber/NPI blocks enqueue/dial without fallback or retry across
BullMQ/inline/AWS SQS. Unknown raw codes are preserved for review and erroneous reference
annotations corrected. Retell wire events now enter a transactional pending inbox;
canonical final transcripts feed summaries without duplicate cumulative snapshots, and
missing/empty/provisional transcripts abstain. Producer crash/early-delivery recovery
passes across separate processes. Stop-call replaces data deletion; signing configuration
uses the provider-designated API key. Call intents now fence submissions before the provider request; two separate-process worker
crash tests verify one synthetic acceptance with no redial. Accepted calls resume; uncertain
calls remain reserved for reconciliation. SSE catches up across replay/Redis gaps and waits
for actual terminal evidence. All remain local and synthetic; automated unknown-ID recovery,
outbox delivery, persisted deadlines, and authorized real provider tests are still pending. Detailed test
counts and limits are in the session record. No production deploy or real calls ran.

**User direction:** ElevenLabs speech/orchestration is permitted, business inference stays
on Fireworks open weights. There is no pilot clinic yet: all development uses fake patient
data. AWS Lambda/SQS/Aurora is the current backend; the Vercel-only notes below are historical.
The frontend remains on Vercel. The live worker is configured for demo mode. AWS readiness
passed on a second direct Function URL probe; custom API-domain readiness remains unverified.

**Still required:** real financial reconciliation, source sync/electronic connectors,
version-bound reviewed actions, durable external-intent recovery, Fireworks gateway/evals,
voice contract/behavior proof, PHI agreements, production validation and authorized clinic evidence.

### Historical go-live report — 2026-08-22

The following test counts, deploy tasks, and completion claims describe that earlier
session. They are not a current audit of production readiness. ADR-053 supersedes the
older deployment target for the zero-extra-hosting demo.

**Current phase:** Phase 5 — Go-live for investor demo (**tracks A–E2 executed; deploy + telephony next**). Plan: `docs/GOLIVE_PLAN.md` (ADR-051); execution findings: **ADR-052**. All gates green: typecheck 16/16 packages, ESLint 0 errors, **1,006 tests passing**, three Docker images building, api image verified booting and serving `/v1/readyz` 200 with live Postgres + Redis probes.
**Proven end-to-end, not asserted:** one real enqueue drove `PENDING→CALLING→DENIED→MANUAL_REVIEW`, a 42s call with 16 CallEvents, a CallSummary at 0.88 confidence, and an audit row carrying `summaryId` + `confidence` + `promptVersion` — demo-script step 7 working for real.
**Next task:** Deploy to Railway + Vercel (E3–E7), then real telephony. Retell is further along than the docs claimed: the API key works, all three payer agents already exist in the account, and the outbound number + agent IDs are configured. The remaining telephony gap is that the agents carry only an `end_call` tool — **no `press_digit`** — so they can talk to a rep but cannot navigate an IVR. Fix is a compiler from `packages/payer-ivr/src/ivr/maps/*` (already a `WAIT`/`DTMF`/`COLLECT_VOICE_INPUT`/`WAIT_FOR_HUMAN` step machine) into Retell `press_digit` tools + states. The hold detector, duration guard and a `waitForCallEnd` timeout also remain unwired — no real call should be placed until they are.
**Carry-over (deferred, user-driven):** **P2-T52** — `PRODUCT.md` via `$impeccable teach` (interactive skill — cannot be done autonomously).

---

## Phase status

| Phase | Name                      | Status                                                                                                                                     |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Foundations               | **Complete** (12 of 12 tasks done, merged via PRs #1–#13)                                                                                  |
| 2     | UI + API + Ingestion      | **Substantively complete** — 54 of 55 tasks merged (PRs #14–#64); W1–W7 ✓; T52 still deferred to interactive `$impeccable teach` follow-up |
| 3     | Queue + Voice             | **Complete** — 31 of 31 tasks merged (PRs #80–#99); W0–W6 ✓                                                                                |
| 4     | Intelligence + Realtime   | **Substantively complete** — 12 of 21 W0–W8 tasks merged across PRs #101–#121; deferred items captured in ADR-050 carry into Phase 5       |
| 5     | Deployment + cloud target | Queued (cloud decision lives here per ADR-004; first task: P5-T0 ADR cluster)                                                              |

## PRD step checklist

- [x] Step 1 — Monorepo (Phase 1)
- [x] Step 2 — Database Schema (Phase 1)
- [x] Step 3 — Authentication (Phase 2 — Clerk integrated in P2-T28; auth flow + onboarding through P2-T31)
- [x] Step 4 — Dashboard Shell (Phase 2 — P2-T32 → P2-T36 merged; claims list T41 + claim detail T42 + import T51 layered on top)
- [x] Step 5 — API Server (Phase 2 — Fastify scaffold T12, OpenAPI T13, auth T37, claims CRUD T38, pagination T39, state machine T40 all merged)
- [x] Step 6 — CSV Upload (Phase 2 — P2-T43 endpoint, T44 parser, T45 DOB hash, T46 payer lookup, T47 priority, T48 bulk insert + cross-org test, T50 fixtures, T51 upload UI all merged)
- [x] Step 7 — Job Queue (Phase 3 — `@dentabill/queue` BullMQ v5 wiring + retry/DLQ T1/T2; call-worker bootstrap + handler T9/T10; e2e against real Redis T15)
- [x] Step 8 — Retell Integration (Phase 3 — `RetellPort` + `FakeRetell` + `LiveRetell` adapters T5/T6/T7; HMAC-verified webhook T17; per-payer agent prompts; ADR-033/036/040)
- [x] Step 9 — IVR Maps (Phase 3 — Delta Dental PPO / Cigna Dental / MetLife Dental DTMF maps + business-hours guard T3/T4; navigator with retry-on-misdetect + 2-failure operator fallback T11; hold detector T12; per-call cap T13; DLQ consumer T14)
- [ ] Step 10 — Call Analysis (Phase 4)
- [ ] Step 11 — Real-Time Updates (Phase 4)
- [ ] Step 12 — Cloud Deployment (Phase 5; cloud target deferred per ADR-004)

## Recent activity

- 2026-10-13 — Local call intents now prevent blind redial after ambiguous acceptance and
  resume accepted calls across worker crashes; two process-crash regressions use an independent
  synthetic provider ledger. SSE catch-up and provider-terminal closure fixed. Latest AWS
  certificate commit `c34e970` merged into this working branch. Full suites: API 257, worker 78,
  provider 196, DB 65, queue 56, SDK 19; type/lint/Lambda build checks passed. No production changes.

- 2026-04-29 (autonomous burst — Phase 3 complete). 21 PRs merged (PRs #80–#99) covering all of Phase 3:
  - **W0 / W1 / W2 (call worker spine):** ADR-cluster 031–040 (T0); BullMQ queue + retry/DLQ (T1, T2); IVR maps + business hours (T3, T4); RetellPort + FakeRetell + LiveRetell (T5, T6, T7); Prisma `Call` columns + index (T8); call-worker bootstrap + real handler (T9, T10) with the three corrections caught while testing (`findFirst` over `findUnique`, `updateMany` with composite where, serialised `waitForCallEnd` chain); IVR navigator (T11); hold detector + reschedule resolver (T12); per-call duration cap (T13); DLQ consumer (T14); full lifecycle e2e against real BullMQ + real Postgres + FakeRetell (T15).
  - **W3 (API):** `POST /v1/claims/:id/calls` enqueue (T16); HMAC-SHA256 webhook with replay protection via unique `eventId` (T17); cursor-paginated calls list + detail + soft cancel (T18, T19, T20) — cancel is soft-only in Phase 3 (DB marker; live Retell continues until natural termination), Phase 4 needs a true cancel channel; SDK regen + contract test asserting the typed paths union covers every endpoint (T21).
  - **W4 (UI):** Call-Now Pill on claim row + claim detail (T22); live status indicator unlocking the muted-teal accent for `IN_QUEUE` / `CALLING` (T23); virtualised `/dashboard/calls` list + detail with 5s/30s adaptive polling (T24); live overview KPI tiles via `GET /v1/calls/stats` (T25). Web-bundle invariant preserved — every UI surface consumes `@dentabill/api-sdk` only.
  - **W5 (observability + ops):** logger redact paths for `dtmf` + `transcriptText` (T26); `audit()` extension covering Call lifecycle reads + writes (T27); `docs/RUNBOOK.md` oncall playbook with seven scenario sections including the "single claim stuck in CALLING" recovery transaction (T28).
  - **W6 (closeout):** ADR-041 retrospective (T29); doc closeout in this PR (T30) — `PHASE_PLAN.md`, `PROGRESS.md`, `TASKS.md`, `CODEMAP.md`, `SESSION_CONTEXT.md` updated.
  - 41 ADRs total now in `docs/DECISIONS.md` (Phase 3 added 11: ADR-031 → ADR-041).
- 2026-04-26 (late afternoon) — **Phase 2 W7 closeout.** ADR-030 retro appended (8 keep/stop bullets covering one-task-one-PR discipline, bundling co-shipped tasks, conditional Clerk gating reuse for Retell, Impeccable design laws, the merge-commit-on-shared-`TASKS.md` pain to fix in Phase 3, per-row errors over throws, client-side mirror of server-authoritative rules, and real-Postgres integration tests for write paths). DESIGN.md final pass replaced TBD font picks with the ADR-013 lock (Inter 200/300, `−0.96px` letter-spacing at 48px hero, brand-color row finalised). PROGRESS / TASKS / SESSION_CONTEXT updated to reflect 54/55. T52 (`PRODUCT.md` via `$impeccable teach`) intentionally deferred to user — interactive skill, cannot be done autonomously.
- 2026-04-26 (afternoon) — **Phase 2 W6 ingestion pipeline complete + W5 UI tasks (T41/T42).** 13 PRs merged (PRs #54–#64): T40 claim state machine (PR #54), T41 claims list page with TanStack-Virtual table + debounced search (PR #55), T42 `/dashboard/claims/[id]` detail with manual-edit dialog using native `<dialog>` + client-side mirror of server transitions (PR #56), T45 `hashPatientDOB` helper with `${orgId}|${iso}|${secret}` keying + ISO-strict date validation (PR #57), T46 payer-name canonicalisation with token-set + anti-token disambiguation (PR #58), T47 priority scoring per PRD §5 (PR #59), T50 Dentrix / Eaglesoft / Open Dental fixtures (PR #60), T44 streaming CSV parser with per-source 3-column header signature + per-row error returns (PR #61), T43 `POST /v1/ingest/claims` upload endpoint (PR #62), T48+T49 bundled — bulk insert with `(organizationId, claimNumber)` idempotency + DB-asserting integration tests covering cross-org isolation (PR #63), T51 `/dashboard/claims/import` drag-drop upload UI (PR #64). All 7 CI gates green on every PR.
- 2026-04-26 (mid-day) — **Phase 2 W2/W3/W4/W5 progress.** 22 PRs merged (PRs #31–#53) covering: full marketing site (T17 chrome, T18 landing, T19 about, T20 pricing, T21 security, T22 privacy, T23 terms + ADR-029, T24 contact, T25 faq, T26 blog skeleton, T27 marketing e2e), Clerk auth flow (T28 conditional gating, T29 sign-in/up, T30 onboarding, T31 auth e2e), dashboard shell (T32 layout, T33 sidebar, T34 topbar, T35 overview, T36 page stubs), and W5 API claims domain (T37 auth plugin with test-header bypass, T38 claims CRUD with 3-layer multi-tenancy + audit on every read, T39 cursor pagination + status/payer/search/sort filters).
- 2026-04-25 (late eve) — **Phase 2 W1 foundation gates complete (16/16).** Eight more PRs merged after the morning checkpoint:
  - **P2-T12** (PR #23) `apps/api` Fastify v5 scaffold — ZodTypeProvider, request-id, structured logger via `@dentabill/logger`, CORS, `@fastify/rate-limit`, `/v1/healthz` + `/v1/readyz`.
  - **P2-T15** (PR #24) `react-hook-form` + `@hookform/resolvers` Zod resolver wired into `@dentabill/ui` Form component; FieldError display, async submission state.
  - **P2-T7** (PR #25) Playwright + axe + visual regression foundation — `apps/web/e2e/` config, base fixture, axe-core integration, per-OS screenshots at 0.1% diff threshold, new `e2e` CI job.
  - **P2-T9** (PR #26) Bundle budget — `@next/bundle-analyzer` + custom CI assertion (≤200 KB initial JS per route, ≤350 KB total).
  - **P2-T8** (PR #27) Lighthouse CI via `treosh/lighthouse-ci-action` enforcing ADR-020 budgets (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms, perf ≥ 90, a11y = 100).
  - **P2-T16** (PR #28) Web observability — `web-vitals` reporter (`sendBeacon` + `keepalive` fallback), `<ErrorBoundary>` posting to `/v1/errors`, `x-request-id` propagation via `<meta>` + fetch wrapper.
  - **P2-T13** (PR #29) OpenAPI generated from Zod via `@fastify/swagger` + `jsonSchemaTransform`; typed `@dentabill/api-sdk` codegen via `openapi-typescript` + `openapi-fetch`.
  - **P2-T14** (this PR) TanStack Query v5 setup at `@dentabill/ui/query` — `DENTABILL_QUERY_DEFAULTS` (30s staleTime, 5min gcTime, retry 3 with exp backoff capped at 30s, mutations no retry to prevent double-sending claims, `throwOnError` true for boundary integration), `<QueryProvider>` with lazy-loaded devtools, wired into `apps/web` via Client `<Providers>`. **Bundled CI hardening** for the two failures left by PR #29: `apps/api/vitest.setup.ts` now seeds test env defaults (DATABASE_URL/REDIS_URL/NEXT_PUBLIC_APP_URL/NEXT_PUBLIC_API_URL) via `process.env[k] ??= v`, and added the `landing-chromium-linux.png` Playwright baseline so CI's Ubuntu visual snapshot stays green.
- 2026-04-25 (eve) — **Phase 2 W1 foundations underway.** Landed eight PRs in dependency order:
  - **P2-T0** (PR #14) ADR cluster 013–028 (16 ADRs locking Phase 2 design contract — visual lock, framework, styling, primitives, API, forms, server-state, perf budgets, a11y, visual regression, security headers, auth, test pyramid, MDX, i18n + Storybook deferrals).
  - **P2-T1** (PR #15) `@dentabill/ui` design tokens — OKLCH color, shadow stack, radius, spacing, typography, motion + drift-detecting test against `theme.css`.
  - **P2-T2** (PR #16) Tailwind v4 preset — `@theme`, `@utility` (status-pulse, shimmer, hairline-edge, shadow-card-layered), focus-visible ring, prefers-reduced-motion handler.
  - **P2-T3** (PR #17) shadcn primitives — Button, Input, Label, Card, Badge, Skeleton, Separator, Avatar themed via tokens; `cn()` with `extendTailwindMerge` for custom class groups; jsdom + @testing-library; 93 tests.
  - **P2-T4** (PR #18) brand primitives — Pill, HeroDisplay, SectionDisplay, ShadowCard, StatusDot. StatusDot's `active` variant is the only chromatic surface in the system (locked muted teal accent + motion-safe pulse). 24 new tests.
  - **P2-T5** (PR #19) Next.js 15 App Router scaffold — `next/font/google` Inter + Geist Mono, RSC root layout with full Metadata + Viewport, error.tsx, not-found.tsx, loading.tsx, icon.svg, robots.ts, sitemap.ts. Webpack `extensionAlias` so `@dentabill/ui`'s `.js` imports resolve to TS sources without a build step.
  - **P2-T6** (PR #20) edge middleware with strict CSP — per-request 16-byte base64 nonce via Web Crypto, `script-src 'strict-dynamic'`, HSTS preload, X-Frame-Options DENY, COOP same-origin, COEP credentialless, CORP same-origin, Permissions-Policy denying camera/mic/geo/payment/FLoC/Topics. Production enforces; dev reports. 17 tests.
  - **P2-T10/T11** (PR #21) ESLint flat config now wires `eslint-plugin-jsx-a11y` (recommended + 3 elevated to error), `eslint-plugin-react` (flat.recommended), and `eslint-plugin-react-hooks`. `eslint-plugin-tailwindcss` deferred (v3 doesn't ingest Tailwind v4 CSS-first; v4-native plugins still pre-1.0); class ordering delegated to `prettier-plugin-tailwindcss`, dedup remains runtime via twMerge.
- 2026-04-25 (am) — **Phase 1 complete.** Closed out the Prisma trio (P1-T4 / T4A / T5). 30 tests in `@dentabill/db`. PRs #1–#13 merged on `main`.

## Decisions log

See `docs/DECISIONS.md`. Currently **41 ADRs** — 9 from Phase 1 + ADRs 010–012 (impeccable skill, SkillUI tooling, ElevenLabs-inspired DESIGN.md) + the Phase 2 cluster ADR-013 → ADR-028 + ADR-029 (terms-template) + ADR-030 (Phase 2 retro) + the Phase 3 cluster ADR-031 → ADR-040 (Clerk-Orgs deferral, per-payer Retell agents, RetellPort adapters, Phase 3 UI scope, queue topology, webhook HMAC, business-hours guard, per-call cap, hold policy, PHI / Retell-audio boundary) + ADR-041 (Phase 3 retrospective, P3-T29).

## Known issues / open questions

- **Live-call wiring gap (2026-08-21, see `docs/GOLIVE_PLAN.md` §1a):** the IVR navigator, hold detector, and per-call duration cap exist as tested modules but are not wired into the production call handler; `RetellPort` cannot send DTMF, so IVR maps never execute; Retell agent IDs are placeholders. No real call has ever been placed. Demo is unaffected (autopilot/simulation mode); real telephony go-live needs its own engineering phase.

- Branch-protection rules still need enabling in the GitHub UI per the checklist in `docs/SECURITY.md`. Auto-merge is working on PRs but enforcement is per-PR rather than rule-bound.
- No external service credentials yet (Clerk / Retell / Anthropic / Resend / Stripe / Telnyx) — `.env.example` placeholders ready, populate as tasks activate them.
- Docker runtime is OrbStack on macOS; `docker compose up -d` from repo root brings up Postgres + Redis healthy.
