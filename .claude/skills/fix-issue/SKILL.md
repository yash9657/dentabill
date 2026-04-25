---
name: fix-issue
description: Fix a GitHub issue end-to-end. Pass the issue number as $ARGUMENTS.
disable-model-invocation: true
---

# Fix GitHub Issue #$ARGUMENTS

## 1. Understand

```bash
gh issue view $ARGUMENTS
```

Read the description, all comments, and any linked stack traces or code references.

## 2. Reproduce with a failing test

Before writing any fix:

1. Find the relevant code (Grep / Glob)
2. Write a test that fails in exactly the way the issue describes:
   ```bash
   pnpm --filter <package> vitest run   # must show a red failure
   ```

## 3. Fix

Minimal change to make the test pass. Do not clean up unrelated code.

## 4. Verify

```bash
pnpm --filter <package> vitest run
pnpm turbo run typecheck lint --filter=<package>...
```

Both must be clean.

## 5. PR

```bash
git add <specific files>
git commit -m "fix(<scope>): <short description>"
gh pr create \
  --title "fix: <short description>" \
  --body "Closes #$ARGUMENTS"
```
