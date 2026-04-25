---
name: learn
description: Capture a non-obvious lesson, debugging technique, or DentaBill-specific pattern as a durable note. Use mid-session right after solving something tricky.
disable-model-invocation: true
---

# Learn — extract a pattern worth keeping

Run this immediately after solving something non-trivial, while the context is fresh. The goal is to make the next instance of this problem cheap.

## What is worth saving

- A workaround for a library / tool quirk (Prisma, Fastify v5, Next.js 15, Retell, BullMQ).
- A non-obvious gotcha specific to DentaBill (multi-tenant edge case, IVR timing rule, denial code mapping).
- A debugging technique that worked when the obvious one didn't.
- A correction the user gave that should not need to be given again.

## What is NOT worth saving

- Restatements of `CLAUDE.md` or `docs/ENGINEERING_RULES.md`.
- Generic TypeScript / React advice findable in any docs.
- One-off bug fixes (the commit message captures those).
- Recap of what files changed (use `git log`).

## Steps

### 1. Decide the bucket

| Bucket | Goes in | Format |
|---|---|---|
| User-level habit / preference | auto memory | `feedback` or `user` memory |
| Project-specific pattern | `docs/PATTERNS.md` (create if missing) | `## Pattern: <name>` |
| Tool / library workaround | `docs/PATTERNS.md` | same |
| Architecture decision | `docs/DECISIONS.md` | new ADR |
| Reusable workflow | new skill in `.claude/skills/<name>/SKILL.md` | full skill file |

### 2. Write the entry

For `docs/PATTERNS.md`:

```markdown
## Pattern: <short name>
**When this applies:** <trigger condition>
**Why:** <root cause / context>
**How:** <minimum working approach, 1–5 bullets>
**Anti-pattern:** <what looks right but isn't>
**Discovered:** YYYY-MM-DD, <session ref or PR>
```

### 3. Confirm with the user before saving

Show the proposed entry. Ask: "Save this as a pattern, or is it too narrow?" Only save on confirmation. If saving as a memory, follow the auto-memory protocol (write the memory file + add line to `MEMORY.md`).

## Hard rules

- Never save a pattern derived from a single session without confirmation.
- Never duplicate a pattern that already exists — find and update instead.
- Never put PHI, secrets, or environment-specific values in a saved pattern.
