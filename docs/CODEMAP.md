# DentaBill codemap

Navigable index of the monorepo. Maintained by the `/codemap-update` skill — refresh it after adding or removing a workspace.

> **Phase 1 — Foundations.** No `apps/` or `packages/` workspaces exist yet. This file fills in as Phase 1 lands the Turborepo + pnpm scaffold and the `@dentabill/db`, `@dentabill/types`, and `@dentabill/config` packages.

## Target layout (per CLAUDE.md and PRD §3)

```
apps/
  web/              Next.js 15 frontend (port 3000)
  api/              Fastify v5 REST API (port 3001)
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

## Workspaces

_(empty — populated by `/codemap-update` once packages exist)_

## Cross-cutting integrations

| Integration | Used by | Notes |
|---|---|---|
| Postgres 16 + Prisma v6 | `@dentabill/db` (consumed everywhere) | Multi-tenant; every query filtered by `organizationId` |
| Retell AI | `apps/call-worker` | IVR navigation + voice calls |
| Anthropic Claude | `apps/summary-worker` | Call transcript analysis |
| Clerk | `apps/web`, `apps/api` | Auth and org membership |
| BullMQ + Redis | workers + `@dentabill/queue` | Job orchestration |

## Conventions (cross-reference)

- Engineering rules: `docs/ENGINEERING_RULES.md`
- UX standards: `docs/UX_RULES.md`
- ADRs: `docs/DECISIONS.md`
- Patterns / gotchas: `docs/PATTERNS.md` _(created on first `/learn` save)_
