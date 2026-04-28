# Tasks

Rules:

- Each task is 1–3 hours max. Split if larger.
- Every code task includes tests (unit or integration as noted).
- Work on one feature branch per task: `phase-<n>/<short-slug>`.
- Mark `[x]` when merged. Move done tasks to the bottom (Done) section.

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

> **All 31 tasks merged 2026-04-29 across PRs #80–#99.** See ADR-041 for the retrospective and `docs/RUNBOOK.md` for the oncall playbook.

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
- [x] **P3-T30** Phase 3 doc closeout — **this PR**

## Phase 4 — Intelligence + Realtime + Billing (queued)

> Per ADR-041 retro. Lands at P4-T0 ADR cluster.

### Phase 4 prep — cleanup tickets carried over from Phase 3

- [ ] **P4-prep-1** Empty-string env normalisation in `apps/api/src/lib/env.ts` so consumers don't keep reinventing the same `??=` + empty-string fallback (vitest setup, dump-openapi script).
- [ ] **P4-prep-2** Per-suite Postgres schema namespaces so `@dentabill/api` and `@dentabill/call-worker` tests stop racing on shared tables when run in parallel under turbo.
- [ ] **P4-prep-3** `Claim.subscriberId` schema migration retiring the `claim.claimNumber` agent-metadata placeholder.
- [ ] **P4-prep-4** True cancel channel for in-flight calls — Redis pub/sub or `Call.cancelRequestedAt` polled by the worker.
- [ ] **P4-prep-5** `User → DentaBillUser` reconciliation pass before the Clerk Organizations org-switch UI lands.

### Phase 4 — feature work (sketch; finalised by P4-T0)

- [ ] **P4-T0** ADR cluster — `SummarizerPort` + Stripe usage off the `audit()` spine + Clerk Organizations migration + `Claim.subscriberId` schema + transcript SSE.
- [ ] summary-worker (BullMQ) → Claude → structured `CallSummary` rows.
- [ ] `/dashboard/calls/:id` SSE transcript surface.
- [ ] Stripe metered billing wiring + a `/dashboard/billing` surface.
- [ ] Clerk Organizations migration + org-switch UI.
- [ ] Resend email notifications on terminal-positive call outcomes.

## Phase 5 — Deployment & cloud target (queued)

The cloud target decision lands here (per ADR-004): Railway vs AWS, Dockerfiles, secret-store wiring, Sentry DSN.

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
