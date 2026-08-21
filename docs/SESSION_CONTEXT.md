# Session Context

_Last updated: 2026-08-21 (go-live planning session)._

## What was just done

**Go-live plan authored for the investor demo.** An 8-agent parallel audit re-verified the repo (typecheck ✓, api 133/133 ✓, web 267/267 ✓; lint red only from 7 stale untracked duplicate files — all confirmed safe to delete, no rescue needed) and mapped every gap: deployment infra is entirely missing, demo seed + live-call driver don't exist, FakeRetell is test-driven (a real enqueued job would hang to the 15-min cap), 6 dashboard surfaces are stubs, and design-token drift was cataloged file-by-file.

**A code-level review of the call-execution path** then found a material gap the phase docs gloss over — recorded as plan §1a: the IVR navigator, hold detector, and duration guard are built + unit-tested but never wired into the production handler (`waitForCallEnd` has no timeout); `RetellPort` has no DTMF dispatch so the IVR maps never reach Retell; agent IDs are placeholders and zero real calls have ever been placed (all green tests are FakeRetell). Demo tracks are unaffected (`DEMO_AUTOPILOT` assumes this), but real telephony go-live is a substantial engineering phase, not a credentials task.

The full execution plan — **all decisions taken** — is `docs/GOLIVE_PLAN.md` (ADR-051 cluster). **Read §1a before making any claim about live-call capability.** Headline decisions: Railway + Vercel; **free-forever pivot** (billing dormant, `/pricing` rewritten, billing settings → usage); `DEMO_AUTOPILOT` mode so Call Now drives a real ~75s call through the production pipeline with simulated telephony; LiveClaude iff `ANTHROPIC_API_KEY` present (synthetic data ⇒ no PHI); build `/dashboard/reports` + audit-log viewer; single branch `phase-5/golive-demo`, one PR.

## Current state of the repo

- `main` is Phase-4-complete (PRs #101–#121). No new code this session — planning + docs only.
- Untracked junk files still present; deleting them is task G-A1 (first thing).

## Next task

**Execute `docs/GOLIVE_PLAN.md`**, in track order: A (stabilize) → B/C/D/E1–E2 in parallel workflows → E3–E7 once owner credentials land → F (verify + rehearse). Respect the cut-line in §3 if time runs short. The plan overrides everything else in this file.

## Open questions / ambiguities

- Owner must supply: Railway + Vercel access, Clerk dev-instance keys, optional `ANTHROPIC_API_KEY` (see plan §10).
- Riskiest integration: SSE auth from the Vercel origin to the Railway api (plan G-E6) — verify early, proxy through a Next.js route handler if `EventSource` can't carry auth cross-origin.

## Trap to avoid

Unchanged from Phase 4: `getEnv()` is process-cached and the Clerk env fallback chain bites in tests — delete all three Clerk envs explicitly in `beforeAll`. New: `DEMO_AUTOPILOT` must only activate when `RETELL_API_KEY` is empty, and existing test-driven FakeRetell behavior must be untouched when the env is absent.
