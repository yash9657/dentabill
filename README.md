# DentaBill AI

> **Your insurance calls, handled.** A voice AI agent that calls dental
> insurance payers, navigates IVR systems, and returns structured claim
> status + next-action plans to dental billing teams.

## Status

**Phase 1 — Foundations** (in progress). Backend foundations only; no UI
or live integrations yet. See `docs/PHASE_PLAN.md` for the roadmap and
`docs/SESSION_CONTEXT.md` for the current task pointer.

## Stack

Locked per `PRD.md` §2 and `docs/DECISIONS.md`. Highlights:

- Turborepo + pnpm workspaces (Node 20+)
- TypeScript strict, Vitest (unit/integration), Playwright (e2e in Phase 2+)
- PostgreSQL 16 + Prisma v6 (multi-tenant, every query org-scoped)
- Fastify v5 API, Next.js 15 App Router, BullMQ workers
- Retell AI + Telnyx (voice), Anthropic Claude (post-call analysis)
- Clerk auth, Resend mail, Stripe billing

## Quickstart (local dev)

Prerequisites: Node 20.11+, Docker Desktop running, Corepack-enabled pnpm.

```bash
# 1. Clone
git clone https://github.com/yash9657/dentabill.git
cd dentabill

# 2. Install (Node version is enforced via .nvmrc + engine-strict)
corepack enable pnpm                  # one-time, if pnpm isn't on PATH yet
pnpm install --frozen-lockfile

# 3. Configure env (do not edit .env.example — it stays as the template)
cp .env.example .env
# edit .env with real Clerk / Retell / etc. keys when those become needed

# 4. Boot Postgres + Redis locally
docker compose up -d
docker compose ps                     # both containers should be 'healthy'

# 5. Apply database schema (after P1-T4 lands; no-op until then)
pnpm --filter @dentabill/db exec prisma migrate dev

# 6. Run the quality gate
pnpm turbo run typecheck lint test build

# 7. (Phase 2+) Boot dev servers
pnpm dev
```

## Daily commands

```bash
pnpm turbo run typecheck            # tsc --noEmit on all workspaces
pnpm turbo run lint                 # eslint
pnpm turbo run test                 # vitest
pnpm format                         # prettier --write .
pnpm format:check                   # prettier --check . (used in CI)
docker compose down                 # stop local services
docker compose down -v              # stop + drop volumes (full reset)
```

## Repository layout

```
apps/
  web/              Next.js 15 frontend (Phase 2)
  api/              Fastify v5 REST API (Phase 2)
  call-worker/      BullMQ worker — Retell AI calls (Phase 3)
  summary-worker/   BullMQ worker — Claude post-call analysis (Phase 4)
packages/
  config/           Shared TS / ESLint / Prettier / Vitest config
  db/               Prisma schema + client + middleware (Phase 1, P1-T4)
  types/            Shared Zod schemas + ApiError contract (Phase 1, P1-T3B)
  logger/           pino with PHI-field redaction (Phase 1, P1-T3A)
  ui/               Shared shadcn/ui components (Phase 2)
  queue/            BullMQ job definitions (Phase 3)
  payer-ivr/        Insurance IVR navigation maps (Phase 3)
docs/               Lean docs system — phase plan, tasks, ADRs
.claude/            Claude Code agents/skills/hooks for this repo
```

See `docs/CODEMAP.md` for the navigable index (auto-maintained).

## Contributing

Read `CONTRIBUTING.md`. Short version: branch off `main` as
`phase-<n>/<short-slug>`, write Conventional Commits, run the quality gate
locally, complete the PR template (especially the Security / HIPAA section).

## Security

PHI handling is non-negotiable. Multi-tenant isolation, no PHI in logs,
audit log on PHI access. See `SECURITY.md` for vulnerability disclosure
and `docs/SECURITY.md` (Phase 1, P1-T12) for the technical safeguards
inventory.

## License

Proprietary — all rights reserved. Not open source.
