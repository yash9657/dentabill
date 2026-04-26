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
- [x] **P2-T14** TanStack Query v5 setup (`@dentabill/ui/query`) + CI hardening (vitest env defaults + Linux Playwright baseline) — **this PR**
- [x] **P2-T15** `react-hook-form` + Zod resolver Form component — _PR #24, 2026-04-25_
- [x] **P2-T16** Web observability — `web-vitals` reporter + ErrorBoundary — _PR #28, 2026-04-25_

### W2 — Marketing site (11 tasks, ~22h)

- [x] **P2-T17** Marketing chrome (Header / Footer / CookieBanner / Newsletter) — **this PR**
- [ ] **P2-T18** Landing (`/`) — hero + waveform + value props + CTAs
- [ ] **P2-T19** About (`/about`)
- [ ] **P2-T20** Pricing (`/pricing`)
- [ ] **P2-T21** Security (`/security`)
- [ ] **P2-T22** Privacy (`/privacy`)
- [ ] **P2-T23** Terms (`/terms`)
- [ ] **P2-T24** Contact (`/contact`) + `POST /v1/contact`
- [ ] **P2-T25** FAQ (`/faq`)
- [ ] **P2-T26** Blog skeleton (`/blog` + MDX content collection)
- [ ] **P2-T27** Marketing e2e suite (9 pages, axe-clean, link check, OG meta)

### W3 — Auth + onboarding (4 tasks, ~9h)

- [ ] **P2-T28** Clerk integration + themed `<ClerkProvider>` + `clerkMiddleware()`
- [ ] **P2-T29** Sign-in / sign-up / verify-email pages
- [ ] **P2-T30** First-login `/onboarding` (practice name / NPI / zip / accepted payers)
- [ ] **P2-T31** Auth e2e suite

### W4 — Dashboard shell (5 tasks, ~13h)

- [ ] **P2-T32** Dashboard layout (white 240px sidebar, 64px topbar, mobile drawer)
- [ ] **P2-T33** Sidebar nav with localStorage-persisted collapse
- [ ] **P2-T34** Topbar (`<OrganizationSwitcher>`, `<UserButton>`, notifications + cmd-k stubs)
- [ ] **P2-T35** `/dashboard/overview` with KPI cards + empty states
- [ ] **P2-T36** Page stubs (claims / calls / reports / settings/\*)

### W5 — API + claims domain (6 tasks, ~17h)

- [ ] **P2-T37** Fastify auth middleware (`@clerk/fastify`)
- [ ] **P2-T38** Claims router (CRUD over `getOrgScopedDb`)
- [ ] **P2-T39** Claims pagination + filtering
- [ ] **P2-T40** Claim detail + state-machine transitions per PRD §6
- [ ] **P2-T41** Claims list UI page (TanStack virtual table)
- [ ] **P2-T42** Claim detail UI page (history timeline + manual status edit)

### W6 — CSV ingestion (9 tasks, ~19.5h)

- [ ] **P2-T43** `POST /v1/ingest/claims` upload endpoint
- [ ] **P2-T44** Streaming CSV parser (Dentrix / Eaglesoft / Open Dental)
- [ ] **P2-T45** DOB hashing helper in `@dentabill/db`
- [ ] **P2-T46** Payer-code lookup table in `packages/payer-ivr`
- [ ] **P2-T47** Priority scoring helper in `@dentabill/db`
- [ ] **P2-T48** Bulk insert with idempotency-key
- [ ] **P2-T49** Ingestion integration test (3 sample CSVs, cross-org isolation)
- [ ] **P2-T50** Sample CSV fixtures
- [ ] **P2-T51** `/dashboard/claims/import` upload UI

### W7 — Closeout (4 tasks, ~4h)

- [ ] **P2-T52** `PRODUCT.md` via `$impeccable teach`
- [ ] **P2-T53** `DESIGN.md` final pass (TBDs replaced with concrete tokens)
- [ ] **P2-T54** Phase 2 doc closeout (PHASE_PLAN / TASKS / PROGRESS / CODEMAP / SESSION_CONTEXT)
- [ ] **P2-T55** Phase 2 retro ADR (ADR-030)

## Phase 3 — Queue + Voice (queued)

## Phase 4 — Intelligence + Realtime (queued)

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
