# Session Context

_Last updated: 2026-08-22 (go-live execution session)._

## What was just done

**Executed `docs/GOLIVE_PLAN.md` tracks A, B, C, D and E1–E2** on branch `phase-5/golive-demo`, using parallel agent swarms (three workflows, 20 agents) with hand verification and repair after each wave.

Shipped: the demo data engine (deterministic builders + idempotent "Bright Smile Dental" seed + `DEMO.md`), the live-call simulator, the FakeRetell autopilot, `GET /v1/reports/summary`, `GET /v1/audit-logs`, a real `/v1/readyz`, the reports UI, the audit-log viewer, the free-forever `/pricing` rewrite, billing→usage, copy de-jargon, error states, three Dockerfiles, `docs/DEPLOY.md`, and the Track C token sweep (two new `@dentabill/ui` primitives plus per-file conformance across the web app).

**The pipeline is proven end-to-end, not asserted.** A real enqueue on localhost produced: `HTTP 202` → claim `PENDING → CALLING → DENIED → MANUAL_REVIEW` → call `COMPLETED` (42s, 16 CallEvents) → `CallSummary` (outcome denied, confidence 0.88) → 2 audit rows, the second carrying `summaryId` + `confidence` + `promptVersion`. That is demo-script step 7 working for real. The api Docker image was also booted and served `/v1/readyz` 200 with live Postgres + Redis probes from inside the container.

## What the agents got wrong (read this before trusting a swarm report)

Every item below passed typecheck and the unit suites, and was reported "complete":

- **All three Docker images were unstartable** — they copied the Prisma client from a content-hashed `.pnpm` path, and invoked `tsx` at the repo-root `node_modules/.bin` where pnpm never puts it. Now generated in-image, run via the per-app bin, with build-time assertions for both.
- **The audit-log API and UI disagreed across the seam** — filter named `entityType` server-side, `resourceType` client-side (silently dropped); `from`/`to` demanded ISO datetimes while `<input type="date">` emits bare dates (every date filter 400'd). Both typechecked because the UI cast through `unknown`.
- **The reports page** introduced blue and orange outside the locked palette, raw hex instead of tokens, `system-ui` instead of Inter, and the only `dark:` variants in the app; its three tests were written and never run, and failed.
- **The seed crashed at runtime** — `@prisma/client` imported directly by a package that depends on `@dentabill/db`.
- **The headline KPI read $0.00** — claims seeded at `randInt(150,2000)/100` ($1.50–$20.00), and no claim used `RESOLVED`, the status `/v1/calls/stats` actually sums.
- **The simulator's transcript was scrambled** — each event stamped with `start + its own inter-event delay` instead of a running total, so timestamps went backwards and duration computed 0s.
- **74 ESLint errors** accumulated because no agent ran lint; the repo gates at `--max-warnings=0`.

Four further defects were invisible to any static check and are recorded as **ADR-052**: the payer business-hours guard 422s the demo evenings/weekends; `FakeClaude` is fixture-driven and cannot summarize a real call; `FakeRetell`'s per-process id counter collides with the `retellCallId` UNIQUE constraint after any restart; and `node dist/server.js` is unreachable because all seven workspace packages ship TypeScript sources.

## Current state of the repo

- Branch `phase-5/golive-demo`, one commit landed (`aeaa835`) plus a second in progress covering Track C and the ADR-052 fixes.
- Gates: typecheck 16/16 packages; ESLint clean; ~840 tests green across api / web / payer-ivr / ui / call-worker / summary-worker / summarizer.
- Three demo flags, each interlocked so configuring the real dependency wins: `DEMO_AUTOPILOT`, `DEMO_IGNORE_PAYER_HOURS` (both inert once `RETELL_API_KEY` is set), `DEMO_SUMMARIZER_FALLBACK` (inert once `ANTHROPIC_API_KEY` is set).
- Token drift closed: `rounded-[20px]` 12 files → 0, `border-black/*` 22 → 0, zero `dark:` variants, no user-facing "Phase N".

## Next task

> **Start at `docs/HANDOFF.md`.** It supersedes this section: it records what is
> actually deployed on Railway, the five verified gaps blocking real telephony,
> where `GOLIVE_PLAN.md` is now wrong, and the traps that cost this session real
> time. Read it before touching anything. In particular: **Railway's edge range is
> unreachable from the owner's home network** — a failing local `curl` against
> `*.up.railway.app` does not mean the deploy is broken.

Remaining after the deploy session — full detail in `docs/HANDOFF.md` §3:

1. **Migrations have not run; the Railway database is empty.** Nothing in the
   deployed app works until they do.
2. Vercel (not started), then the SSE cross-origin check (G-E6, riskiest).
3. Track F: security check, adversarial review, Playwright baselines, PR.
4. Real telephony: wire the guards, then compile the IVR maps into Retell
   `press_digit` tools + states.

Superseded ordering from the planning session:

1. `/security-check` + security-reviewer over the branch diff (new endpoints, new scripts, three demo flags).
2. Adversarial code review over the full diff; fix confirmed findings only.
3. Playwright — visual baselines will need one deliberate regeneration after the token sweep, with a one-line justification in the same commit.
4. PR to `main`, squash after CI green.
5. **E3–E7 need owner credentials** (plan §10): Railway token, Vercel token, Clerk dev-instance keys, optional `ANTHROPIC_API_KEY`. Nothing else blocks deploy.

## Open questions / ambiguities

- Owner must supply the four credentials above. Everything up to "push the button" is done.
- Riskiest remaining integration is still SSE from the Vercel origin to the Railway api (plan G-E6) — a bare `EventSource` cannot set auth headers, so verify cross-origin auth early and proxy through a Next.js route handler if it fails.
- The autopilot call runs ~42s rather than the plan's ~75s. Left as-is: shorter is better on stage.

## Traps to avoid

- **A green gate is not a working feature.** Fakes built for tests are driven _by_ tests. Anything named `Fake*` must be exercised by a real end-to-end run before it is called done — that single assumption produced three of the four ADR-052 defects.
- `getEnv()` is process-cached and the Clerk env fallback chain bites in tests — delete all three Clerk envs explicitly in `beforeAll`.
- `tsx -e` transpiles to CJS, so top-level await is a syntax error; wrap ad-hoc probe scripts in an async IIFE.
- Prisma logs its connection pool to stdout, so scripted DB probes need a marker line (`PROBE=`) rather than positional parsing.
- This machine runs a 2-slot `ci-slot` queue shared with other repos. Long commands queue behind unrelated projects; scope test/lint commands to the files you changed.
- Killing a backgrounded service by its subshell pid orphans the `tsx` child, which keeps holding :3010/:3011 and breaks the next run with `EADDRINUSE`. Kill the process group.
