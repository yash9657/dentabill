# DentaBill AI — Progress

Human-friendly status report. For details see `docs/SESSION_CONTEXT.md` and `docs/TASKS.md`.

**Last updated:** 2026-04-25
**Current phase:** Phase 1 — Foundations **(complete — 12/12 tasks done)**. Next: Phase 2 — UI + API + Ingestion.
**Next task:** P2-T1 — `apps/web` Next.js 15 App Router scaffold
**In progress:** Nothing

---

## Phase status

| Phase | Name                      | Status                                   |
| ----- | ------------------------- | ---------------------------------------- |
| 1     | Foundations               | **Complete** (12 of 12 tasks done)       |
| 2     | UI + API + Ingestion      | Queued (UI tasks moved here per ADR-004) |
| 3     | Queue + Voice             | Queued                                   |
| 4     | Intelligence + Realtime   | Queued                                   |
| 5     | Deployment + cloud target | Queued (cloud decision lives here)       |

## PRD step checklist

- [x] Step 1 — Monorepo
- [x] Step 2 — Database Schema (P1-T4 / T4A / T5 — schema, audit, org-scope read helper, write middleware all landed 2026-04-25)
- [ ] Step 3 — Authentication (Phase 2)
- [ ] Step 4 — Dashboard Shell (Phase 2)
- [ ] Step 5 — API Server (Phase 2)
- [ ] Step 6 — CSV Upload (Phase 2)
- [ ] Step 7 — Job Queue (Phase 3)
- [ ] Step 8 — Retell Integration (Phase 3)
- [ ] Step 9 — IVR Maps (Phase 3)
- [ ] Step 10 — Call Analysis (Phase 4)
- [ ] Step 11 — Real-Time Updates (Phase 4)
- [ ] Step 12 — Cloud Deployment (Phase 5; cloud target deferred per ADR-004)

## Recent activity

- 2026-04-25 — **Phase 1 complete.** Closed out the Prisma trio: P1-T4 (`@dentabill/db` schema + singleton client + initial migration `20260425075528_init`), P1-T4A (`audit()` helper + `getOrgScopedDb(orgId)` read-side scope via `prisma.$extends`), P1-T5 (write middleware via `Prisma.defineExtension` on `$allModels.$allOperations` rejecting writes lacking `organizationId` on multi-tenant models). 30 tests in `@dentabill/db`, all green against the docker-compose Postgres (running under OrbStack). 15 commits on local `main`, ready to push.
- 2026-04-25 — Phase 1 reshaped after architectural review of `DentaBill_AI_Technical_Plan.docx`. Landed P1-T2 (`@dentabill/config`), P1-T2A (Husky + commitlint + repo hygiene), P1-T2B (GitHub Actions CI), P1-T11 (docker-compose + .env.example), P1-T3 (workspace scaffold — 4 apps + 7 packages incl. new `@dentabill/logger`), P1-T3A (`@dentabill/logger` with PHI redaction + 6 tests), P1-T3B (`@dentabill/types` with ApiError + Zod + branded IDs + 26 tests), P1-T3C (Vitest workspace — 40 tests, 13 files), P1-T12 (ARCHITECTURE / API_CONVENTIONS / SECURITY docs). Added 6 new ADRs (004–009).
- 2026-04-20 — P1-T1 verified complete. Claude Code harness configured: Sonnet default, token caps, 4 hooks, 4 subagents, 5 skills. Ready for P1-T2.
- 2026-04-07 — Lean docs system bootstrapped (`docs/PROJECT_BRIEF.md`, `PHASE_PLAN.md`, `TASKS.md`, `DECISIONS.md`, `SESSION_CONTEXT.md`, `ENGINEERING_RULES.md`, `UX_RULES.md`). Phase 1 task list drafted (10 tasks).

## Decisions log

See `docs/DECISIONS.md`. Currently 9 ADRs:

- ADR-001 lock PRD stack (deploy line superseded by ADR-004)
- ADR-002 lean docs
- ADR-003 Vitest + Playwright
- ADR-004 cloud target deferred until Phase 5
- ADR-005 CI from Phase 1 (no e2e until UI lands)
- ADR-006 commit & PR enforcement (commitlint + Husky + lint-staged)
- ADR-007 observability baseline (`@dentabill/logger` first, Sentry later)
- ADR-008 packages topology — added `@dentabill/logger` (now 7 packages)
- ADR-009 multi-tenancy enforcement layers (write middleware + read helper + audit)

## Known issues / open questions

- 15 unpushed commits on local `main` — push when ready to publish Phase 1 and trigger first GitHub Actions CI run.
- Branch-protection rules need enabling in the GitHub UI per the checklist in `docs/SECURITY.md` (one-time, requires the first push).
- No external service credentials yet (Clerk / Retell / Anthropic / Resend / Stripe / Telnyx) — `.env.example` placeholders ready, populate as Phases 2–4 activate them.
- Docker runtime is OrbStack (chosen over Docker Desktop for lower overhead on macOS); `docker compose up -d` from repo root brings up Postgres + Redis healthy.
