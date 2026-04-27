# Session Context

_Last updated: 2026-04-26 (evening)_

## What was just done

**Onboarding-flow + design polish PR (#66) shipped after a long debug session.** The user ran the app locally for the first time end-to-end and surfaced a stack of bugs that no test had caught: Fastify v5 logger init signature, Clerk env-var name mismatch (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` vs `CLERK_PUBLISHABLE_KEY`), `@clerk/fastify`'s exported `clerkClient` singleton failing with "Missing Clerk Secret Key", Fastify decorator collision on the name `auth` between our preHandler and the Clerk plugin, and — the silent killer — the JWT-cache lag making the `publicMetadata.onboarded` middleware gate loop new users back to `/onboarding` after they completed it.

Architectural fix: **DB became the source of truth for onboarding state** instead of JWT claims. Added `apps/web/src/lib/onboarding-status.ts` (React `cache()` + `prisma.user.findUnique` on Clerk userId), made `app/dashboard/layout.tsx` async to call it, removed the publicMetadata gate from `middleware.ts`. The onboarding endpoint still stamps `publicMetadata.onboarded` (load-bearing — throws on failure) but nothing reads it on the hot path. New synthetic `clerkOrgId = local_<clerkUserId>` for the personal-org fallback (Clerk Organizations intentionally NOT used in Phase 2 — see open question below).

Polish along the way: BrandMark glyph component in `@dentabill/ui`, restored proper button/pill padding (`h-10 px-4` default), call-flow waveform visual cleanup (motion-safe pulse on Reach cluster, radial spotlight, 800×280 viewBox), vertical newsletter footer, card-style contact-form success, Wordmark with glyph, "Import claims" Pill on `/dashboard/claims` (sm size, text-only after the user rejected the first two designs as "extremely ugly").

Final fix in this session: CI was red on `bundle`, `e2e`, `lighthouse` because adding `@dentabill/db` as a workspace dep of `apps/web` means `next build` now bundles Prisma — those 3 jobs lacked an explicit `prisma generate` step. Mirrored the pattern from `quality` + `test` and added a `postinstall` script to `packages/db` as a fresh-clone safeguard. Pushed as `ci(ci): generate Prisma client in bundle/e2e/lighthouse jobs`; CI rerun in flight at the time of this update.

## Current state of the repo

- Branch in flight: `fix/onboarding-flow-and-design-polish` (PR #66). Once green it merges to `main`.
- Phase 2 was already 54/55 done before this PR; this PR is non-Phase-2 maintenance unblocking the user from actually running the product.
- CI gates expected green after the Prisma-generate fix lands: typecheck / lint / test / build / prettier / Playwright (chromium) / axe / Lighthouse / bundle budget / CodeQL / GitGuardian.
- New helper added: `apps/web/src/lib/onboarding-status.ts` — call this from any RSC layout that needs to know whether the current Clerk user has finished onboarding.
- New env-loading note in `CLAUDE.md`: monorepo apps don't read repo-root `.env`; we maintain `apps/web/.env.local → ../../.env` and `apps/api/.env → ../../.env` symlinks.

## Next task

**Author ADR-031 — "Clerk Organizations deferred; synthetic `clerkOrgId` pattern".** The onboarding endpoint stamps `clerkOrgId = "local_<clerkUserId>"` because we explicitly do NOT use Clerk Organizations in Phase 2 (multi-seat practices land in Phase 4). The DentaBill `Organization.clerkOrgId` column is a unique key, so we need a deterministic synthetic value for single-seat orgs. ADR-031 should document: why we deferred Clerk Orgs (org-create UX is heavy + invitation flow needs work + Phase 2 customers are solo billers), the `local_<userId>` pattern, the migration path to real Clerk Org IDs in Phase 4, and the invariant that `clerkOrgId` starting with `local_` indicates a single-seat org.

After ADR-031 lands, the next substantive workstream is **Phase 3 — Queue + Voice** (BullMQ workers, Retell wiring, IVR navigation per PRD §6). `docs/PHASE_PLAN.md` already sketches it; first task there will be regenerating `docs/TASKS.md` for Phase 3.

P2-T52 (`PRODUCT.md` via `$impeccable teach`) is still deferred to the user — interactive skill invocation can't be done autonomously.

## Open questions / ambiguities

- **Clerk Organizations deferred — needs ADR-031.** The onboarding endpoint synthesises `clerkOrgId = "local_<clerkUserId>"` for the personal-org fallback. This is a deliberate choice (Clerk Org UX is heavy, single-seat customers in Phase 2) but it isn't yet documented as a decision. Phase 4 will reverse it.
- The merge-commit-on-shared-`TASKS.md` pain documented in ADR-030 §5 is the one rough edge to address early in Phase 3.
- Branch protection on `main` still not enabled in the GitHub UI.

## Do not forget

- One task at a time. Tests are part of the task, not a follow-up.
- Update this file + `TASKS.md` + `PROGRESS.md` + `DECISIONS.md` (ADRs only) at end of every session.
- Status-active teal (`oklch(0.78 0.04 200)`) is the **only** chromatic surface allowed in the system per ADR-013.
- Visual regression baselines are per-OS — when changing landing visuals, regenerate **both** `landing-chromium-darwin.png` (locally) and `landing-chromium-linux.png` (in `mcr.microsoft.com/playwright:v1.59.1-noble`) so CI doesn't fail.
- API tests use `process.env[k] ??= v` defaults in `vitest.setup.ts` — when adding new required env vars to `getEnv()`, also add them to `TEST_DEFAULTS` so CI stays green.
- Claim PATCH's `audit()` records `metadata.clerkUserId` (Clerk userId is not yet FK to DentaBill `User.id` — that lands in Phase 4).
- For org-scoped `update`/`delete` on Prisma we use `updateMany`/`deleteMany` with composite `where {id, organizationId}` because the write middleware enforces `organizationId` on the write path while Prisma's unique-where signature for `update` does not include it.
- Patient DOB is on disk only as `patientDOBHash` (org-scoped + secret-keyed SHA-256 from T45) + last-4 of birth year. Cleartext DOB never lands.
- No em dashes in user copy; no card grids; no side-stripe banners; no glassmorphism (Impeccable design laws + ADR-013 visual lock).
