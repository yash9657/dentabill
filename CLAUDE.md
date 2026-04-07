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
8. `PROGRESS.md` — human-friendly status report

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
