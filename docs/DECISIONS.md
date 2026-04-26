# Decision Log (ADR-lite)

Format: one entry per decision. Append-only. Mark `Superseded by ADR-NNN` instead of editing.

---

## ADR-001 — Adopt the PRD stack as locked for Phase 1

**Date:** 2026-04-07
**Status:** Accepted (deploy line superseded by ADR-004)
**Context:** PRD §2 lists every framework/service. Re-evaluating mid-build wastes tokens and time.
**Decision:** Treat PRD §2 as frozen for Phase 1. Any deviation must be a new ADR.
**Consequences:** Faster execution, fewer rabbit holes; future changes require explicit ADR + PRD update.

## ADR-002 — Lean docs system, PRD remains source of truth

**Date:** 2026-04-07
**Status:** Accepted
**Context:** Re-reading the full PRD every session is expensive; duplicating it is worse (drift).
**Decision:** Maintain compressed `PROJECT_BRIEF.md` + phase/task/session/rules docs. Refer back to `PRD.md` only on ambiguity.
**Consequences:** Lower context cost per session; risk of brief drifting from PRD — mitigated by never duplicating, only compressing.

## ADR-003 — Test framework: Vitest (unit) + Playwright (e2e/UI)

**Date:** 2026-04-07
**Status:** Accepted
**Context:** PRD doesn't pin a test runner. Need one consistent choice across packages.
**Decision:** Vitest for all unit/integration tests (TS-native, fast), Playwright for browser/e2e in `apps/web`.
**Consequences:** One config style across the monorepo; Playwright adds CI cost but is the standard for Next.js.

## ADR-004 — Cloud target deferred until Phase 5

**Date:** 2026-04-24
**Status:** Accepted (supersedes the deploy line of ADR-001)
**Context:** PRD §2 names Railway; the technical-plan source document pushes for AWS-from-day-1. Both are defensible; committing to either pre-revenue is premature. The user explicitly chose to defer.
**Decision:** Phase 1–4 build cloud-agnostic services. Configuration comes from env vars; external services are accessed through interfaces (`@dentabill/logger`, future `@dentabill/queue`, etc.). No Terraform, no provider SDKs, no cloud-specific APIs in application code until a real deploy target is selected. Decision criteria for Phase 5: monthly cost ceiling, BAA availability, data-residency requirements, vendor-managed Postgres + Redis on the candidate.
**Consequences:** No Dockerfiles in Phase 1 (only `docker-compose.yml` for local dev). Sentry DSN deferred. AWS-specific guidance from the .docx (Terraform, ECS, RDS, ElastiCache, KMS, CloudTrail) is preserved as Phase 5 reference, not Phase-1 work.

## ADR-005 — CI from Phase 1 (no e2e until UI lands)

**Date:** 2026-04-24
**Status:** Accepted
**Context:** Existing `docs/PHASE_PLAN.md` deferred CI to Phase 5. The .docx requires CI from day 1 ("industry standard like big tech"). The user agreed CI belongs in Phase 1.
**Decision:** GitHub Actions runs typecheck + lint + build + commitlint + format-check on every PR (`quality` job). A separate `test` job runs Vitest with a real `postgres:16-alpine` + `redis:7-alpine` service container so integration tests don't mock the DB. Playwright/e2e job lands in Phase 2 alongside `apps/web` Playwright config. Staging/production pipelines remain Phase 5 work.
**Consequences:** Every PR is gated by the same checks the engineer ran locally. Real DB tests catch ORM-level bugs. Playwright job is intentionally absent until there's a UI to test.

## ADR-006 — Commit and PR enforcement

**Date:** 2026-04-24
**Status:** Accepted
**Context:** Conventional commits were documented but not enforced. Solo dev today, but the rules need to survive the first PR from another contributor without retraining anyone.
**Decision:** Conventional Commits enforced via `commitlint` in CI (`@commitlint/config-conventional` + a `scope-enum` matching the workspaces) AND locally via Husky `commit-msg` hook. `lint-staged` runs `eslint --fix` + `prettier --write` on staged files via Husky `pre-commit`. PRs require typecheck + lint + test green and the PR template completed (especially the Security/HIPAA section).
**Consequences:** Bad commit messages and ungreen PRs cannot reach `main`. Branch-protection settings in the GitHub UI codify the rules — see `docs/SECURITY.md`.

## ADR-007 — Observability stack baseline (`@dentabill/logger` first; Sentry deferred)

**Date:** 2026-04-24
**Status:** Accepted
**Context:** Logging discipline is the cheapest HIPAA control. Sentry needs a deploy target (DSN, environment) which doesn't exist yet (ADR-004).
**Decision:** Phase 1 ships `@dentabill/logger` — pino with PHI-field redaction enforced by unit test. Every Node service must use it; raw `console.*` is an ESLint error. Sentry SDK installation is deferred to Phase 5 alongside the cloud target. Request-id middleware added when `apps/api` lands in Phase 2.
**Consequences:** PHI redaction lives in one curated list; over-redacting is acceptable, missing a path is not. New paths added in any PR that introduces a shape that could carry PHI.

## ADR-008 — Packages topology — add `packages/logger`

**Date:** 2026-04-24
**Status:** Accepted
**Context:** PRD §3 lists 6 packages (`db`, `types`, `ui`, `config`, `queue`, `payer-ivr`). Pino + redaction is shared across every Node service; placing it inside `@dentabill/config` (build tooling) or `@dentabill/types` (no runtime code) is wrong.
**Decision:** Add a 7th package — `@dentabill/logger` — owning runtime logging. Keep the rest of PRD §3 unchanged.
**Consequences:** Every Node service depends on `@dentabill/logger`. CODEOWNERS routes changes there to the maintainer.

## ADR-009 — Multi-tenancy enforcement layers

**Date:** 2026-04-24
**Status:** Accepted (P1-T4A and P1-T5 implement)
**Context:** PRD §4 calls for Prisma middleware on writes. That alone is insufficient — read-side leaks are the more likely vector.
**Decision:** Defense in depth — three layers in `@dentabill/db`:

1. Prisma `$extends` middleware (`org-scope.ts`, P1-T5) blocks writes to multi-tenant models that lack `organizationId`. Throws `MissingOrgScopeError`.
2. `getOrgScopedDb(orgId)` helper (`with-org.ts`, P1-T4A) wraps the singleton client and auto-applies `where: { organizationId: orgId }` to read methods on multi-tenant models.
3. `audit({ action, ... })` helper (`audit.ts`, P1-T4A) writes an `AuditLog` row for any PHI-touching read. Rejects calls without `organizationId`.
   **Consequences:** Three independent failsafes; any single bypass requires bypassing all three. Tests in P1-T4A/P1-T5 include "two orgs, no leak" cases. The `security-reviewer` agent checks every PR for direct `prisma.*` access against multi-tenant models.

## ADR-010 — Dependabot policy: minor/patch auto-PR, majors via deliberate review

**Date:** 2026-04-25
**Status:** Accepted
**Context:** The first Dependabot scan after merging Phase 1 opened 8 simultaneous major-version PRs (eslint 9→10, prisma 6→7, pino 9→10, lint-staged 15→16, eslint-import-resolver-typescript 3→4, plus three GHA majors). Major bumps are breaking by definition — Prisma 7 alone would invalidate the generated client and require a schema-side review. Drive-by merging during active feature work (Phase 2 UI) is the wrong forcing function.
**Decision:** `.github/dependabot.yml` ignores `version-update:semver-major` for both the npm and `github-actions` ecosystems by default. Minor + patch updates continue to auto-PR (grouped: `production-minor-patch`, `development-minor-patch`, `actions-minor-patch`). Security advisories are NEVER suppressed — Dependabot bypasses `ignore` rules for security updates, including major versions. Major bumps are addressed deliberately during a **quarterly dependency review** session that audits each major bump against release notes, runs the full quality + test gate, and lands as a single dedicated PR per high-risk dep (e.g. `chore/upgrade-prisma-v7`).
**Consequences:** PR queue stays focused on feature work. Security risk remains covered by GitHub's advisory bypass + GitGuardian + CodeQL. The cadence is documented for the next maintainer and survives staff changes — search `docs/DECISIONS.md` for "ADR-010" or look for the comment block at the top of `.github/dependabot.yml`. Lifting the major-version ignore for a one-off upgrade is intentional — comment it out, run the upgrade, restore it after the major lands.

## ADR-011 — Design tooling: Impeccable as committed skill, SkillUI via on-demand `npx`

**Date:** 2026-04-25
**Status:** Accepted
**Context:** Phase 2 (UI scaffold + dashboard) needs (a) opinionated design guidance loaded into the agent's context and (b) a way to extract real design-system tokens from reference sites we admire (Linear, Stripe, Notion, LunaBill, etc.). Two community tools cover these jobs: `pbakaus/impeccable` (a Claude Code skill — bundle of references + commands) and `amaancoderx/skillui` (a CLI that runs Playwright + static analysis to emit `DESIGN.md` + tokens + screenshots).
**Decision:** Treat them differently because they are structurally different.

1. **Impeccable** is committed under `.claude/skills/impeccable/` (PR #11) and surfaced in `CLAUDE.md`. `skills-lock.json` pins the source hash so re-installs are reproducible. Its 14 scripts are inert until invoked; only the `live` command's two scripts make outbound calls (localhost only).
2. **SkillUI** is **not** added as a devDependency. It's a 17-day-old npm package (v1.3.2 first published 2026-04-08 by `amaancoderx`) and bundling it into our supply chain is disproportionate to how often we'll run it (a handful of times per quarter). Instead, every invocation must use a pinned `npx skillui@1.3.2 …` form so each run is an explicit, deliberate call. Run only from a scratch directory outside the repo. Curated outputs land in `PRODUCT.md` / `DESIGN.md` / `references/` at repo root (where Impeccable's `load-context.mjs` looks for them).

**Consequences:** Clean composition — SkillUI fills the `DESIGN.md` slot Impeccable's setup expects; `$impeccable teach` fills `PRODUCT.md`; every Impeccable command then produces on-brand output. The version pin lives in `docs/DESIGN_TOOLING.md` (and any other place that documents the call); when we want to upgrade, we change the pin in one or two places, not across a transitive dependency tree. `.gitignore` blocks `design-extracts/` and `*.skill` to keep accidental scratch output out of the repo. If a future maintainer wants the convenience of a versioned `pnpm` script, they can add one — but the default policy is "explicit `npx` with a pinned version".
