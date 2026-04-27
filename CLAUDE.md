# CLAUDE.md

Guidance for Claude Code (and any agent) working in this repository. Read this **first** at the start of every session.

## What this project is

**DentaBill AI** — an AI voice agent that calls dental insurance payers (Delta Dental PPO, Cigna Dental, MetLife Dental in Phase 1), navigates IVRs via DTMF, talks to human reps, and returns structured claim status + next-action plans to dental billing teams via a dashboard.

Full requirements live in `PRD.md` (root). **Do not re-read it every session** — only when something is genuinely ambiguous and not answered by the lean docs below.

## Read order at session start (in this exact order)

1. `CLAUDE.md` (this file)
2. `docs/PROJECT_BRIEF.md` — 1-page compressed PRD
3. `docs/PHASE_PLAN.md` — phase roadmap + exit criteria
4. `docs/TASKS.md` — current actionable tasks
5. `docs/SESSION_CONTEXT.md` — what just happened, what's next, open questions
6. `docs/ENGINEERING_RULES.md` — code/test/git rules
7. `docs/UX_RULES.md` — UI/UX standards
8. `DESIGN.md` (repo root) — working visual spec, inspired by ElevenLabs; consumed by Impeccable
9. `docs/ARCHITECTURE.md` — system topology, call lifecycle, package graph
10. `docs/API_CONVENTIONS.md` — wire-level rules for the Fastify API
11. `docs/SECURITY.md` — HIPAA/PHI inventory, threat model, branch protection
12. `docs/CODEMAP.md` — navigable workspace index (auto-maintained)
13. `PROGRESS.md` — human-friendly status report

Only fall back to `PRD.md` when these don't answer the question.

## End-of-session protocol (mandatory)

Before ending any work session, update:

- `docs/SESSION_CONTEXT.md` — what was done, exact next task, any new open questions
- `docs/TASKS.md` — check off completed tasks; add new ones if discovered
- `PROGRESS.md` — phase status, recent activity line, any new known issues
- `docs/DECISIONS.md` — append a new ADR for any non-trivial decision made this session

## Working rules (summary — full set in `docs/ENGINEERING_RULES.md`)

- **Stack is locked** per PRD §2 (Turborepo + pnpm, Next.js 15, Fastify v5, Prisma v6 + Postgres 16, BullMQ, Retell, Clerk, etc.). Do not substitute without a new ADR.
- **pnpm only.** Never npm/yarn.
- **TypeScript strict, no `any`.** Use `unknown` and narrow. Explicit return types on exports.
- **Multi-tenant always.** Every query filtered by `organizationId`. Prisma middleware enforces on writes.
- **PHI never logged.** No patient names, DOB, SSN in logs/errors/traces.
- **Zod-validate every API input** before touching the DB.
- **Cross-package imports** via workspace names (`@dentabill/db`, etc.) — never `../../`.
- **Tests are part of every code task**, not a follow-up. Vitest for unit/integration, Playwright for e2e/UI.
- **Tasks are 1–3 hours max.** Split anything bigger.
- **Conventional commits.** `feat(scope): …`, `fix(scope): …`, `chore(scope): …`, `docs(scope): …`, `test(scope): …`.
- **Feature branches** named `phase-<n>/<short-slug>`. PR target is `main`.
- **One task at a time.** Complete + test before starting the next.

## Local env loading (monorepo gotcha)

Both Next.js (`apps/web`) and `tsx` (`apps/api`) only auto-load `.env*` files from the **app's own directory**, not the repo root. The single source of truth lives at `/.env`; we symlink it into each app on first setup so both processes pick it up:

```bash
ln -sf ../../.env apps/web/.env.local
ln -sf ../../.env apps/api/.env
```

`.env*` is gitignored, so the symlinks are not committed. If a fresh clone shows `<AuthFallback>` ("Account creation is on invite") on `/sign-up` even with valid Clerk keys in `/.env`, those symlinks are missing — that's the smoking gun.

After `.env` changes, **restart** both dev processes; `NEXT_PUBLIC_*` vars are inlined at boot and don't hot-reload.

## Verification commands

Run these to confirm work is correct before committing:

```bash
pnpm --filter <package> exec tsc --noEmit --skipLibCheck   # typecheck one package
pnpm turbo run typecheck lint --filter=<package>...         # full lint + types
pnpm --filter <package> vitest run                          # unit/integration tests
pnpm --filter web playwright test                           # e2e tests
pnpm turbo run build --filter=<package>...                  # build smoke test
```

## Available skills

Invoke with `/<name>` in the chat:

- `/tdd-workflow` — RED → GREEN → IMPROVE for Vitest + Playwright
- `/new-feature <task-id>` — explore → plan → implement → test → PR
- `/db-migration` — safe Prisma migration sequence
- `/fix-issue <number>` — gh issue view → reproduce → fix → PR
- `/security-check` — HIPAA + OWASP checklist before merge
- `/codemap-update` — refresh `docs/CODEMAP.md` after structural changes
- `/learn` — capture a non-obvious pattern to `docs/PATTERNS.md` mid-session
- `/phase-complete` — end-of-session protocol (verify gates → update docs)
- `impeccable` (third-party) — frontend design expertise: `craft`, `audit`, `critique`, `polish`, `harden`, `animate`, `colorize`, `typeset`, `layout`, `clarify`, `distill`, `bolder`, `quieter`, `delight`, `overdrive`, `optimize`, `adapt`, `extract`, `live`, `teach`, `document`, `shape`, `onboard`. Installed via `npx skills add pbakaus/impeccable` (locked in `skills-lock.json`). Required setup: a `PRODUCT.md` (and ideally `DESIGN.md`) at repo root before serious design work — run `$impeccable teach` to bootstrap them. Apache-2.0; see `.claude/skills/impeccable/SKILL.md`.

## Companion design tooling — SkillUI

`SkillUI` is an external CLI (NOT a skill) that extracts a design system from any URL / repo / local directory and emits a `DESIGN.md` + tokens + screenshots that Impeccable can consume. We do **not** install it as a devDep — invoke it on demand from a scratch directory with the version pinned: `npx skillui@1.3.2 --url <ref>`.

Full workflow, when to run, what to commit / ignore: `docs/DESIGN_TOOLING.md`. Policy rationale: ADR-011.

## Available agents

Delegate via `"use the <name> agent to review <files>"`:

- `security-reviewer` — HIPAA/PHI + injection + auth audit
- `code-reviewer` — TypeScript quality + DentaBill conventions
- `db-schema-reviewer` — Prisma schema + migration safety
- `test-writer` — generate Vitest / Playwright tests for a given file
- `planner` — decompose a feature/phase into 1–3h tasks before coding
- `build-error-resolver` — interpret tsc/turbo/vitest/Prisma failures and propose minimal fixes
- `refactor-cleaner` — find dead code, unused exports, duplicated logic
- `doc-updater` — execute the end-of-session doc protocol mechanically

## Active hooks (project-level)

Wired in `.claude/settings.json`:

- **PreToolUse**: `secret-scanner` (blocks hardcoded API keys), `env-read-blocker` (blocks reading `.env*`)
- **PostToolUse**: `typecheck` (tsc on changed package), `phi-log-detector` (warns on PHI in logs), `strategic-compact-suggester` (nudges /compact every 40 edits)
- **SessionStart**: `session-start` (surfaces "Next task" from `docs/SESSION_CONTEXT.md`)
- **PreCompact**: `pre-compact` (reminds to capture next-task pointer before summary)

## Compaction hint

When compacting, always preserve: current task ID, list of modified files, open TypeScript errors, any pending migration names.

## Things NOT to do

- Do not duplicate the PRD into other docs.
- Do not rewrite files that already work.
- Do not add comments explaining what code does — names should explain that.
- Do not create placeholder files "to be replaced later".
- Do not add features beyond the current task.
- Do not hardcode secrets. New env vars go to `.env.example` with a one-line comment above.
- Do not commit `.env*` (other than `.env.example`).
- Do not force-push shared branches. Do not amend pushed commits.

## Repo layout (target — built incrementally)

```
apps/
  web/              Next.js 15 frontend (port 3000)
  api/              Fastify REST API (port 3001)
  call-worker/      BullMQ worker — Retell AI calls
  summary-worker/   BullMQ worker — Claude analysis
packages/
  db/               Prisma schema + singleton client
  types/            Shared TS types
  ui/               Shared shadcn components
  config/           Shared eslint/tsconfig/prettier
  queue/            BullMQ job definitions
  payer-ivr/        Insurance IVR navigation maps
```

## Key references inside the PRD (jump targets, not for re-reading wholesale)

- §2 stack · §3 repo layout · §4 coding standards · §5 DB schema + priority formula
- §6 IVR timing rules + denial codes · §7 design system · §8 env vars · §9 build steps

## Current phase

See `docs/PHASE_PLAN.md` and `PROGRESS.md`. We are in **Phase 1 — Foundations**. Next concrete task is in `docs/SESSION_CONTEXT.md` under "Next task".
