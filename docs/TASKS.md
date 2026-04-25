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

## Phase 2 — UI + API + Ingestion (queued)

UI work was moved here from Phase 1 per ADR-004 + planning session.

- [ ] **P2-T1** `apps/web` — Next.js 15 App Router scaffold + Tailwind v3 + shadcn init + Inter / JetBrains Mono
- [ ] **P2-T2** Clerk integration + middleware + `/sign-in`, `/sign-up`, `/dashboard` protection
- [ ] **P2-T3** Landing page (`/`) per PRD §7
- [ ] **P2-T4** Dashboard shell (240px sidebar, 64px topbar, responsive collapse)
- [ ] **P2-T5** Stub the four dashboard pages with PRD §7 grids
- [ ] **P2-T6** Playwright config + first e2e suite (smoke + auth flow) + add `e2e` job to CI
- [ ] **P2-T7** Fastify API scaffold (`apps/api`) — Clerk JWT verify, request-id middleware, `@dentabill/logger`, ApiError serializer
- [ ] **P2-T8** Claims router (CRUD over `getOrgScopedDb`), Zod-validated input
- [ ] **P2-T9** CSV upload (Dentrix / Eaglesoft / Open Dental detection)
- [ ] **P2-T10** DOB hashing (SHA-256) + payer mapping + priority scoring
- [ ] **P2-T11** Upload UI in `apps/web`

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
