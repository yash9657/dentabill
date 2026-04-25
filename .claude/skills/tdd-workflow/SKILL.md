---
name: tdd-workflow
description: RED → GREEN → IMPROVE test-driven development cycle for DentaBill using Vitest and Playwright.
---

# TDD Workflow

Follow for every code task, no exceptions.

## RED — write failing tests first

1. Read the task spec in `docs/TASKS.md` or the issue
2. Write tests describing desired behavior — no implementation yet
3. Confirm they fail for the right reason:
   ```bash
   pnpm --filter <package> vitest run          # unit/integration
   pnpm --filter web playwright test            # e2e
   ```
   Compile errors are not "red" — fix those before starting.

## GREEN — minimal implementation

Write the minimum code to pass the tests. No over-engineering.

```bash
pnpm --filter <package> vitest run             # must be green
pnpm --filter <package> exec tsc --noEmit      # must be clean
```

## IMPROVE — refactor + quality gate

1. Refactor for clarity without changing external behavior
2. Verify tests still pass
3. Run the full quality gate:
   ```bash
   pnpm turbo run lint typecheck --filter=<package>...
   ```
4. DentaBill checks before committing:
   - [ ] Every Prisma query includes `organizationId`
   - [ ] Every API input has Zod validation
   - [ ] No PHI in any log statement
   - [ ] No `any` types introduced

## Commit

```bash
git add <specific files only>
git commit -m "feat(<scope>): <description>"   # or fix / chore / test
```
