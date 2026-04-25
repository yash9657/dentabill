# Tasks

Rules:
- Each task is 1–3 hours max. Split if larger.
- Every code task includes tests (unit or integration as noted).
- Work on one feature branch per task: `phase-<n>/<short-slug>`.
- Mark `[x]` when merged. Move done tasks to the bottom (Done) section.

---

## Phase 1 — Foundations (active)

- [x] **P1-T1** Initialize Turborepo + pnpm workspace
  - Branch: `phase-1/monorepo-init`
  - Create `pnpm-workspace.yaml`, `turbo.json` (dev/build/lint/typecheck), root `package.json`, `.gitignore`, `.claudeignore`.
  - Test: `pnpm install && pnpm turbo run lint --filter=...` exits 0 with empty graph.

- [ ] **P1-T2** Shared config package (`packages/config`)
  - tsconfig base (strict), eslint base, prettier.
  - Test: `tsc --noEmit` against a tiny fixture passes; eslint runs against fixture with zero violations.

- [ ] **P1-T3** Scaffold empty apps + packages directories with stub `package.json`
  - `apps/{web,api,call-worker,summary-worker}`, `packages/{db,types,ui,queue,payer-ivr}`.
  - Test: `pnpm -r exec node -e "console.log(1)"` succeeds in every workspace.

- [ ] **P1-T4** `packages/db` — Prisma init + full schema from PRD §5
  - Schema, enums, indexes, PrismaClient singleton export.
  - Test: `prisma validate` + `prisma migrate dev --name init` against local Postgres; vitest snapshot of generated client types.

- [ ] **P1-T5** Prisma multi-tenant write middleware
  - Throw if any write op missing `organizationId` (where applicable).
  - Test: vitest — write without orgId throws; write with orgId succeeds.

- [ ] **P1-T6** `apps/web` — Next.js 15 App Router scaffold + Tailwind v3 + shadcn init
  - Strict TS, base layout, Inter + JetBrains Mono fonts.
  - Test: `pnpm --filter web build` succeeds; Playwright smoke: `/` returns 200.

- [ ] **P1-T7** Clerk integration + `/dashboard` route protection
  - ClerkProvider, middleware, sign-in/sign-up routes per PRD §8 env vars.
  - Test: Playwright — unauthenticated `/dashboard` redirects to `/sign-in`.

- [ ] **P1-T8** Landing page (`/`) per PRD §7 spec
  - Headline, subheadline, primary + ghost buttons, fully responsive.
  - Test: Playwright — copy + buttons present; lighthouse a11y ≥ 95 on CI.

- [ ] **P1-T9** Dashboard shell: sidebar (240px navy), top bar (64px), responsive collapse
  - Nav links: Overview, Claims, Calls, Analytics. Mobile bottom-tab variant.
  - Test: Playwright — resize matrix (375/900/1280) renders correct nav variant.

- [ ] **P1-T10** Stub the 4 dashboard pages with correct layout grids per PRD §7
  - Overview (4 stat cards + 60/40 split), Claims (filter bar + table), Calls (2-col grid + empty state), Analytics (4 metrics + chart placeholders).
  - Test: Playwright — each route 200s, key landmarks visible.

---

## Phase 2 — API + Ingestion (queued)
_To be expanded when Phase 1 closes._

## Phase 3 — Queue + Voice (queued)
## Phase 4 — Intelligence + Realtime (queued)
## Phase 5 — Deployment (queued)

---

## Done
_(none yet)_
