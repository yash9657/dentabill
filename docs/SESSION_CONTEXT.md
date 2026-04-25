# Session Context

_Last updated: 2026-04-25_

## What was just done

**Phase 1 closed out.** The Prisma trio landed in this session:

- **P1-T4** `@dentabill/db` Prisma init — full PRD §5 schema (8 models, 6 enums, cascade deletes, `Decimal(10,2)` money, indexes on `(organizationId, status)` and `(organizationId, priority)`), singleton client wired to `@dentabill/logger` via Prisma event hooks, initial migration `20260425075528_init`. pnpm v10 `onlyBuiltDependencies` allowlist added so Prisma engines download.
- **P1-T4A** Audit + read-side org scope — `audit({ action, resourceType, resourceId, organizationId, ... })` rejects missing org; `getOrgScopedDb(orgId)` uses `prisma.$extends` to auto-filter `findMany` / `findFirst` / `count` / `aggregate` / `groupBy` on the 5 multi-tenant models. `findUnique` deliberately not intercepted (callers must use `findFirst` for scoped lookups by id; documented in `with-org.ts`). `MULTI_TENANT_MODELS` is a single source of truth shared with the write middleware.
- **P1-T5** Multi-tenant write middleware — `Prisma.defineExtension` query hook on `$allModels.$allOperations` rejects writes against multi-tenant models that lack `organizationId`. Validates `create` / `createMany` / `createManyAndReturn` / `upsert` payloads (every row in array creates checked individually) and `update` / `updateMany` / `delete` / `deleteMany` `where` clauses. Extension is layered into the singleton client so every consumer of `@dentabill/db` is guarded — no un-guarded escape hatch. Non-multi-tenant models (`Organization`) pass through.

15 new tests in this session, 30 total in `@dentabill/db`. All green.

## Current state of the repo

- Branch: `main`. 15 commits ahead of `origin/main`. Working tree clean.
- All 12 Phase-1 implementation tasks complete (P1-T2 through P1-T12).
- 11 workspaces: 4 apps (stubs), 7 packages (`config`, `logger`, `types`, `db` are real; `ui`, `queue`, `payer-ivr` are stubs awaiting their phases).
- Three-layer multi-tenancy defense (ADR-009) is fully in place: write middleware + read helper + audit log.
- Local stack: `dentabill-postgres` and `dentabill-redis` containers are healthy via OrbStack.
- CI workflow ready in `.github/workflows/ci.yml` but **not yet exercised** — pushing the 15 commits will trigger the first run.

## Next task

**Phase 1 is done. Phase 2 begins with P2-T1 — `apps/web` Next.js 15 App Router scaffold.**

Per `docs/TASKS.md` Phase 2 plan: Next.js 15 + Tailwind v3 + shadcn init + Inter / JetBrains Mono fonts + theme tokens from PRD §7. After P2-T1 lands, P2-T2 wires Clerk auth, P2-T6 adds the Playwright e2e job to CI (per ADR-005).

Before starting Phase 2, recommend:

1. Push the 15 unpushed commits on `main` to publish the foundation work and exercise CI for the first time.
2. Enable branch protection on `main` per `docs/SECURITY.md` checklist (require PR, require `quality` + `test` checks, linear history, no force push).
3. Open a draft PR to verify CI is green end-to-end against the real GitHub Actions runners + service containers.

## Open questions / ambiguities

- 15 unpushed commits on `main`. First push will exercise CI — review `git log` first to spot any commit-message issues.
- Branch protection still needs enabling in the GitHub UI (one-time, blocked on having a remote with at least one push).
- Phase 2 task ordering not yet broken into branches in `docs/TASKS.md` — happens at start of next session.

## Do not forget

- One task at a time. Tests are part of the task, not a follow-up.
- Update this file + `TASKS.md` + `PROGRESS.md` + `DECISIONS.md` (ADRs only) at end of every session.
- Branch-protection in GitHub UI is still not enabled — see `docs/SECURITY.md`.
