---
name: codemap-update
description: Refresh docs/CODEMAP.md so Claude can navigate DentaBill without burning context on exploration. Run after adding/removing packages or major modules.
disable-model-invocation: true
---

# Codemap update

Maintain `docs/CODEMAP.md` as the navigable index of the monorepo. The codemap exists so that future sessions can reach the right file in one read instead of grepping.

## Steps

### 1. Inventory

```bash
ls -d apps/*/ packages/*/ 2>/dev/null
find apps packages -name 'package.json' -not -path '*/node_modules/*' -maxdepth 3 2>/dev/null
```

### 2. For each app/package, capture

- Workspace name (from `package.json` `name` field)
- One-line purpose (from PRD §2 / §3 or existing comments)
- Public entry points (`src/index.ts`, route file, worker file)
- Notable submodules (only if they're load-bearing — skip trivial dirs)
- External integrations (Retell, Clerk, Prisma, BullMQ, etc.)

### 3. Edit `docs/CODEMAP.md`

Use this exact shape per package:

```markdown
### `@dentabill/<name>` — apps/<name> or packages/<name>
**Purpose:** <one line>
**Entry:** `apps/<name>/src/index.ts`
**Key files:**
- `src/routes/claims.ts` — claim status endpoints
- `src/lib/retell.ts` — Retell AI client wrapper
**Depends on:** `@dentabill/db`, `@dentabill/types`
**Integrations:** Retell, Clerk, Postgres
```

### 4. Verification

- Every workspace in `pnpm-workspace.yaml` appears in the codemap.
- Every entry's `Entry:` path actually exists.
- No stale entries for deleted packages.

### 5. Output

Print only the diff summary:

```
docs/CODEMAP.md — added @dentabill/queue, removed @dentabill/legacy-x, updated @dentabill/db entry
```

## When to skip

- If `git status` shows no changes in `apps/` or `packages/` since the last codemap update (check `git log -1 --format=%H docs/CODEMAP.md` against affected dirs), skip.
- The codemap is descriptive, not prescriptive. Do not invent files that do not exist.
