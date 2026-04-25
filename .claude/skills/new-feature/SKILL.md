---
name: new-feature
description: Full workflow for implementing a DentaBill feature. Pass a task ID or description as $ARGUMENTS.
disable-model-invocation: true
---

# New Feature: $ARGUMENTS

## 1. Explore (Plan Mode — no writes)

- Read the task in `docs/TASKS.md`
- Identify affected packages and apps
- Read 2–3 existing analogous files to understand patterns

## 2. Plan (still in Plan Mode)

Write a checklist of:
- Every file to create or modify
- New env vars needed → document in `.env.example`
- DB schema changes → will need `/db-migration`
- New workspace dependencies

Confirm with the user before proceeding to implementation.

## 3. Branch

```bash
git checkout -b phase-<n>/<short-slug>
```

## 4. Implement (use `/tdd-workflow` for each unit)

Switch to Normal Mode. Follow TDD strictly. After each file change:

```bash
pnpm --filter <package> exec tsc --noEmit --skipLibCheck
```

## 5. Full verification

```bash
pnpm --filter <package> vitest run
pnpm --filter web playwright test             # if web changed
pnpm turbo run build --filter=<package>...    # build smoke test
```

## 6. PR

```bash
git add <specific files>
git commit -m "<type>(<scope>): <description>"
gh pr create --title "<title under 70 chars>" --body "$(cat <<'EOF'
## Summary
- <bullet>

## Test plan
- [ ] Unit tests pass
- [ ] e2e tests pass (if applicable)
- [ ] TypeScript clean
EOF
)"
```

## 7. Update session docs

- `docs/TASKS.md` — mark task `[x]`
- `docs/SESSION_CONTEXT.md` — what was done, next task
- `PROGRESS.md` — update recent activity
