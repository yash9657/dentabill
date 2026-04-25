# Contributing to DentaBill

Welcome. This is the short version — see `CLAUDE.md` and `docs/ENGINEERING_RULES.md`
for the complete picture.

## Stack & decisions

The stack is locked per `PRD.md` §2 and `docs/DECISIONS.md`. Substituting a tool
or framework requires a new ADR appended to `docs/DECISIONS.md` first.

## Workflow

1. Read `docs/SESSION_CONTEXT.md` "Next task" for current focus.
2. Branch off `main`: `git checkout -b phase-<n>/<short-slug>`.
3. Implement the task. Tests are part of the task, not a follow-up.
4. Run the local quality gate before opening a PR:
   ```bash
   pnpm turbo run typecheck lint test build
   ```
5. Open a PR to `main`. The CI must be green and the PR template completed
   in full (especially the Security / HIPAA Impact section).

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/), enforced by
commitlint via the `commit-msg` Husky hook and the CI `quality` job.

```
<type>(<scope>): <subject>

<body>
```

- **Allowed types:** feat, fix, chore, docs, test, refactor, perf, build, ci, revert
- **Allowed scopes:** see `commitlint.config.cjs`
- Subject: lower-case, imperative, no trailing period, max 100 chars

Example: `feat(db): add audit log helper for PHI access`.

## Branching

- One task = one branch = one PR. Tasks are 1–3 hours.
- Branch naming: `phase-<n>/<short-slug>` (e.g. `phase-1/prisma-schema`).
- PR target is always `main`. Never force-push shared branches.

## Local development

See `README.md` Quickstart (created in P1-T11) for the boot sequence.

## Code review

- Use the PR template — every checkbox matters.
- Delegate to specialized agents when applicable: `code-reviewer`,
  `security-reviewer`, `db-schema-reviewer` (see `.claude/agents/`).
- HIPAA / PHI safety is non-negotiable. Run `/security-check` before merge.

## Doc maintenance

End of every working session, update:

- `docs/SESSION_CONTEXT.md` — what was done + next task
- `docs/TASKS.md` — check off completed
- `PROGRESS.md` — recent activity line
- `docs/DECISIONS.md` — append an ADR for any non-trivial decision

The `doc-updater` agent automates this. Trigger via `/phase-complete`.
