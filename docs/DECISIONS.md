# Decision Log (ADR-lite)

Format: one entry per decision. Append-only. Mark `Superseded by ADR-NNN` instead of editing.

---

## ADR-001 — Adopt the PRD stack as locked for Phase 1
**Date:** 2026-04-07
**Status:** Accepted
**Context:** PRD §2 lists every framework/service. Re-evaluating mid-build wastes tokens and time.
**Decision:** Treat PRD §2 as frozen for Phase 1. Any deviation must be a new ADR.
**Consequences:** Faster execution, fewer rabbit holes; future changes require explicit ADR + PRD update.

## ADR-002 — Lean docs system, PRD remains source of truth
**Date:** 2026-04-07
**Status:** Accepted
**Context:** Re-reading the full PRD every session is expensive; duplicating it is worse (drift).
**Decision:** Maintain compressed `PROJECT_BRIEF.md` + phase/task/session/rules docs. Refer back to `PRD.md` only on ambiguity.
**Consequences:** Lower context cost per session; risk of brief drifting from PRD — mitigated by never duplicating, only compressing.

## ADR-003 — Test framework: Vitest (unit) + Playwright (e2e/UI)
**Date:** 2026-04-07
**Status:** Accepted
**Context:** PRD doesn't pin a test runner. Need one consistent choice across packages.
**Decision:** Vitest for all unit/integration tests (TS-native, fast), Playwright for browser/e2e in `apps/web`.
**Consequences:** One config style across the monorepo; Playwright adds CI cost but is the standard for Next.js.
