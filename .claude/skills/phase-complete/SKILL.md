---
name: phase-complete
description: Run the DentaBill end-of-session protocol — verify exit criteria, update docs, and prepare a clean handoff. Use at the end of any work session.
disable-model-invocation: true
---

# Phase / session complete

Closes a session cleanly so the next one can pick up without re-exploration.

## 1. Snapshot what changed

```bash
git status
git diff --stat
git log --oneline -n 20
```

## 2. Verify quality gates (only for packages touched this session)

```bash
pnpm turbo run typecheck lint --filter=<changed-pkgs>...
pnpm --filter <changed-pkg> vitest run
pnpm --filter web playwright test         # only if web changed
pnpm turbo run build --filter=<changed-pkgs>...
```

If any gate is red, stop. Hand to `build-error-resolver` agent. Do not update docs while red.

## 3. Check phase exit criteria

Open `docs/PHASE_PLAN.md`. For the current phase, mark off any criteria that are now satisfied. Do not mark a phase "complete" — that's a user decision.

## 4. Delegate doc updates

Use the `doc-updater` agent. Pass it:
- A 3-line summary of what was done this session
- The list of changed files from step 1
- The verification result from step 2
- Whether any phase exit criteria were satisfied

The agent will update `SESSION_CONTEXT.md`, `TASKS.md`, `PROGRESS.md`, and add an ADR if warranted.

## 5. Update the codemap (only if structure changed)

If `apps/` or `packages/` gained or lost a workspace this session, run the `codemap-update` skill.

## 6. Final review

Show the user:
- Modified docs (one line each)
- Any open TypeScript errors not yet handled
- Pending Prisma migrations not yet committed
- The exact "Next task" line that landed in `SESSION_CONTEXT.md`

Do not commit or push. The user does that.
