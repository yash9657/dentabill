---
name: db-migration
description: Safe Prisma migration workflow for DentaBill schema changes.
disable-model-invocation: true
---

# Database Migration

## Prerequisites

- Local Postgres running and `DATABASE_URL` set in `.env`
- Schema changes in `packages/db/prisma/schema.prisma` are finalized

## Step 1 — Validate

```bash
pnpm --filter @dentabill/db exec prisma validate
```

Must exit 0. Fix any schema errors before continuing.

## Step 2 — Review checklist (do manually)

- [ ] Every new model has `organizationId String` + compound index with common filter fields
- [ ] No new NOT NULL column on an existing table without a default value
- [ ] No renames or drops (additive only — create an ADR in `docs/DECISIONS.md` if unavoidable)
- [ ] Foreign key fields have indexes
- [ ] `createdAt` / `updatedAt` on all new mutable models

If uncertain, invoke the `db-schema-reviewer` agent.

## Step 3 — Create migration

```bash
pnpm --filter @dentabill/db exec prisma migrate dev --name <snake_case_name>
```

Name convention: `add_<table>_table`, `add_<field>_to_<table>`, `create_<name>_index`.

## Step 4 — Verify

```bash
pnpm --filter @dentabill/db exec prisma migrate status   # no pending migrations
pnpm --filter @dentabill/db vitest run                   # DB tests pass
```

## Step 5 — Commit

```bash
git add packages/db/prisma/
git commit -m "chore(db): add migration <name>"
```

Migration files in `prisma/migrations/` are always committed and never edited post-creation.
