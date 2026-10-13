# Session Context

_Last updated: 2026-10-13 (W0 implementation; AWS baseline reconciled)._

## Current session — W0 implementation on AWS baseline

### Continuation: FW-07/FW-08/FW-28

The preceding turn made progress (committed W0 implementation/audit). This continuation
implements the actual Retell wire boundary and a first durable event path; goal stays active.
Implementation commit: `be3a27a`; a follow-up test ensures skipped claim transitions are
audited as proposals, without claiming a reviewed claim changed.

- Strict SDK timestamped signatures authenticate raw bytes before JSON parsing. Internal
  fake envelopes and untimestamped signatures no longer pass the HTTP boundary. Supported
  call-start/end and cumulative-transcript payloads normalize without post-call analysis,
  arbitrary metadata, tool output, invented timing, or inferred human contact.
- Additive migration `20261013090000_retell_inbox` stores normalized early events until
  the real Call establishes tenant identity. Receipt ownership, CallEvent, source timing,
  terminal status, and audit commit atomically. Unknown calls return 202 with durable pending
  data; processed payloads clear after tenant-bound evidence is saved. Conflicting lifecycle
  evidence returns 409. This is not the general intent/outbox framework yet.
- Worker observes terminal evidence through scoped Postgres polling; a separate producer
  process can die after accepting an event, and the worker still reconciles it after Call
  registration. Provider times update even after cancellation/late starts without reopening
  terminal status. The reverse cancellation race remains FW-32.
- Summary/UI share canonical transcript selection. Final text stays exact; structured remote
  speakers are not assumed human. Cumulative updates remain provisional and never concatenate
  into final evidence. Missing/empty/provisional transcripts return TRANSCRIPT_UNAVAILABLE
  without inference. UI call/auth changes clear prior content and reject late old responses.
- LiveRetell requests Stop Call with a 10-second timeout and no SDK retries; it never deletes data
  as a hangup action. No guessed already-ended success. Env defaults/generated webhook
  secrets were removed; the API requires the designated key for configured live telephony.
  AWS may reference an existing Secrets Manager key, with no-key demo still supported.

**Validation:** Final full API **239/25 files**, full summary-worker **51/5 files**,
payer-ivr **182**, worker handler **19** + BullMQ/Postgres e2e **4** + separate-process
regression **1**, shared selector **10**, summarizer **78**, web component **5** +
stream hook **6** passed. All API contract tests now pass normally (no expected failures).
Affected typechecks/lints passed. Final Lambda packaging passed (API38.4MB/11.2MB zip;
worker30.5MB/9.8MB zip). Terraform fmt and backend-disabled validate passed, with no
plan/account mutation. Local migration applied only to dedicated identity/summary/process
DBs. The process test kills the webhook producer, not the worker: it does not establish
no-redial recovery or AWS runtime correctness. Independent review identified source-time
ordering/cancellation defects; fixed with regressions. No remaining introduced blocker
was found; documented follow-on gaps remain.

**Still blocked/unverified:** actual provider delivery/stop behavior, Fireworks/ElevenLabs
inference/voice topology, clinic/domain adjudication and contracted connectors. Independent
work remains available. W2 needs call intent ownership/ambiguous acceptance reconciliation,
persisted deadlines and outbox dispatch. Pending unknown-event retention/reconciliation is
FW-33; server SSE pagination/race is FW-31. No production migration/deployment/calls.

**Exact next:** implement FW-25's durable call intent before any further live-path use:
API enqueue transaction, one externally submitted attempt per intent, ambiguous outcomes
reconcile instead of redial, SQS retry/deadline recovery, and worker-crash process tests.
Then durable summary dispatch and generic outbox; keep Fireworks gateway work progressing
against synthetic contracts while external access/approved releases remain prerequisites.

**Goal remains active:** complete the nine-workstream parity program, not just provider replacement.
User authorized implementation, local tests, branches/commits/draft PRs; no production cutover,
real third-party calls, actual claim/payment mutations, or destructive production migrations.
User explicitly allows ElevenLabs speech/orchestration; Fireworks open-weight business inference
remains required. **No clinic yet: use fake patient data.** Real-clinic/end-to-end evidence and
billing-expert adjudication remain blocked, not waived.

**Checkout:** started at `25e82a7` on `deploy/vercel-serverless` with dirty audit docs.
Created `codex/w0-containment`. On user correction, fetched origin: `origin/main=55a1896`
was already an ancestor; AWS work actually lives at `origin/infra/aws=bfd4e8f`.
Fast-forwarded the working branch to that revision and reapplied all WIP without conflicts.
A safety stash named `w0 containment and pre-existing audit before AWS fast-forward` is retained.
No user audit work was discarded. `pnpm install --frozen-lockfile` completed on the AWS lockfile.
W0 implementation is committed as `2c8bcdd`; all commit hooks passed. The final
Lambda bundles were rebuilt successfully after the zero-filled-week correction.

### Implemented locally; not merged, deployed, or parity-complete

- FW-01/02: reproduced duplicate face-value reporting (two calls on a $300 claim became
  $600 "recovered" despite only a $100 payer-reported partial payment). API/SDK/UI now
  separate call counts, unique claims, workflow dispositions, and unavailable verified
  payment data (`amountCents:null`). No claim face value is represented as cash.
- FW-03: high-confidence model `RESOLVED` advice requires review; protected states and
  changed claim versions/newer calls are preserved. Summary/state/audit/usage tally commit
  in one Postgres transaction. Sequential redelivery skips duplicate inference. A real DB
  audit-trigger failure test proves rollback/retry. Notifications describe required review,
  not payment recovery. Nonterminal calls cannot create a permanent partial summary.
- FW-05: no subscriber-ID fallback; missing/blank subscriber or provider NPI prevents
  enqueue/dial. Worker records `NEEDS_INFO` with scoped CAS and audit. Inline, BullMQ, and
  AWS SQS paths handle this as non-retryable. Lambda acknowledges without dialing or
  overwriting the missing-data state, including on final receives.
- FW-04: corrected existing code-list annotations using current X12 references; raw
  unknown codes (bounded to 64 characters) survive adapter/schema parsing and force
  review. Historical v1 prompt can still omit unfamiliar codes; Fireworks migration
  must remove that limitation. No licensed dictionary or real-domain accuracy claim.
- FW-06: SDK-signed documented Retell envelopes now have committed synthetic fixtures;
  initial expected-failure tests exposed parser rejection. The continuation above now
  implements normalization/signing configuration; real provider validation remains pending.

### Access and actual infrastructure evidence

See [PROVIDER_EVIDENCE.md](./PROVIDER_EVIDENCE.md) for the capability matrix, primary
vendor sources, model candidates, measured-vs-documented distinction, and probe manifest.
GitHub, Vercel, Railway, and AWS CLI authentication work. Local PG16/Redis7 run; isolated
`dentabill_w0_summary`, `dentabill_w0_identity`, `dentabill_w0_finance` databases received
all six existing migrations. No production migrations ran.

Read-only AWS queries find active `dentabill-api`/`dentabill-worker` in `us-east-1`, Node22,
900-second timeout, 1024 MB. SQS mapping is Enabled, batch1, ReportBatchItemFailures.
Worker is demo mode and has no voice/inference provider keys. Aurora `apps-pg` is available,
Postgres17.11, encrypted, 7-day backup retention; restore has not been tested. Direct Lambda
`/v1/readyz` first reported PG unavailable, then returned HTTP200 with PG healthy on retry
(0.67s); cold-start sensitivity is an inference, not a confirmed diagnosis. Custom
`api.dentabill.site` DNS failed locally, so custom-domain readiness is unverified.

Local `.env`, `apps/api/.env`, `apps/web/.env.local`, and `packages/db/.env` resolve to the
same root env. At inventory time Fireworks/ElevenLabs keys were absent, Telnyx key/number
empty, Retell configured. Subsequent Retell phone inventory proved the configured outbound
number is Retell-managed Twilio (`retell-twilio`), not Telnyx. User has never added a Telnyx
key; Telnyx remains a prospective candidate and setup is deferred. User received a hidden-input command to add candidate keys; later told to skip Telnyx
for now after actual carrier verification.
Recheck presence without displaying secrets before concluding access is still blocked.
Retell read-only agent GET succeeded: Retell-hosted LLM, GPT-4.1 post-call analysis,
retention `everything`, max duration 60 minutes. Clerk instance metadata probe returned
403; configured key presence does not establish working account access.

### Remaining consequential gaps

No financial ledger/allocations/reversals, version-bound approvals, real electronic/PMS
connectors, or verified provider replacement yet. SQS delivery exists but the call runtime
can redial after ambiguous `CALLING` redelivery; invocation-owned call execution and unwired
hard-duration/hold controls remain; DB webhook completion is now implemented locally. Summary notification delivery needs an outbox. The
usage tally is not an inference billing ledger: failed commits can omit incurred spend,
and Lambda's process-local cost lock cannot enforce a global cap. Separate-process
crash/concurrency proof remains required. Existing summary retry deletion needs durable
versioned replacements. Real-time evaluation, clinic, reference-content licenses, BAAs,
ElevenLabs custom-LLM/ZRM entitlement, and intended payer products/regions remain unverified.

### Exact next step

W0 focused checks and independent review are recorded below. FW-07 continuation above is now implemented locally. Next implement FW-25 durable call
intents/outbox against SQS, alongside the Fireworks gateway with synthetic contracts and
approved releases before real inference.
Do not restart the old Vercel-only runner decision or claim passing fake tests establish parity.

### Initial W0 verification record (before FW-07 continuation)

- Summary worker: **46 tests passed**, including real Postgres fault injection,
  sequential replay, stale edits/newer calls, active-call rejection, and unknown code
  preservation. Typecheck/lint passed. No cross-process or real model accuracy claim.
- Identity: payer-ivr163, shared types26, worker handler18 and real BullMQ/Postgres e2e4
  passed. On AWS baseline, inline runtime16 + Lambda worker11 passed with real DB
  at the runtime/batch boundary; no real AWS messages or third-party calls were sent.
- Summarizer78 and payer-ivr163 passed for raw codes/reference corrections; both typecheck/lint pass.
- Queue56 and notifier6 passed. Financial API45, web25, SDK19 focused checks passed;
  API/web/SDK typechecks and scoped lint passed. One Playwright signed-out dashboard
  regression passed using installed Chrome on local :3015. Authenticated browser E2E
  remains unverified. Independent review found sparse-week chart distortion; corrected
  to eight UTC buckets with gap/boundary/future/cross-tenant regressions. Follow-up
  reports API6 and component11 tests passed; no additional financial behavior changed.
- Retell contract suite: **11 passing assertions and 2 expected failures** for the
  documented-but-unsupported raw envelope. This is blocker reproduction, not compatibility.
- AWS local packaging succeeded: API38.4MB/worker30.4MB unzipped, zip11.2MB/9.7MB.
  Artifacts are local only; no deploy performed and no Lambda emulator smoke yet.
- Full API suite: **232 tests passed**, including the two expected FW-07 failures,
  before the final zero-filled-week follow-up. API typecheck/lint and web typecheck pass.

## Previous session — 2026-10-12 audit (preserved)

The user requested a blunt comparison with Lunabill, current dental/AI web research,
and a detailed implementation plan using open-weight models hosted on Fireworks for
all AI. The deliverable is [FIREWORKS_IMPLEMENTATION_PLAN.md](./FIREWORKS_IMPLEMENTATION_PLAN.md):
18 ranked gaps with code evidence, current primary sources, model/voice feasibility,
target data/workflow architecture, evaluation gates, nine workstreams, 24 first-sprint
implementation slices, staffing estimates, and unit economics. ADR-054 records the
accepted model requirement separately from proposed architecture.

**No runtime implementation or deployment occurred.** Baseline was `25e82a7`.
Current production state and signed contracts were not inspected. The older reports
below describe historical demo/deployment sessions, not present verification.
ADR-053 contains the newer Vercel-only demo topology and hosting-budget constraint.

Key blockers: model-only `RESOLVED` transitions; face-value “recovery” reporting;
raw Retell webhook/schema mismatch; process-local call completion; duplicate/partial
side-effect windows; incorrect N370 mapping; missing dental lines, payment ledger,
durable follow-ups, source sync, and review workflows. The strict Fireworks requirement
also needs a verified open-weight streaming ASR/TTS path before autonomous voice.

Validation this session: summarizer 70 tests passed; payer-ivr 153 tests passed;
synthetic documented-shape Retell webhook rejected by the exported parser, reproducing
the contract mismatch. These 223 tests do not validate live calling or model quality.

**Next work:** W0 containment and vendor/voice feasibility, seed evaluation cases,
and a durable-runner decision. Use the FW-01–24 backlog in `docs/TASKS.md`; do not
interpret this plan as authorization to buy infrastructure, change pricing, or
enable real PHI/automated submissions. Small US Open Dental practices are a planning
assumption; agency/DSO requirements would change scope. No application gap is marked fixed.

## Historical context — August 2026

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
> `*.up.railway.app` does not mean the deploy is broken. This was retested after
> the region move and is **not** region-related; verify from inside the container
> via `railway ssh` instead.

Remaining after the deploy session — full detail in `docs/HANDOFF.md` §3:

1. ~~Migrations~~ **DONE.** All six migrations applied and `seed:demo` run against
   the Railway database; `/v1/readyz` reports postgres + redis ok and the org,
   40 claims, 25 calls and 25 summaries are queryable in the deployed DB. All
   five services now run in `us-west2`. A pre-deploy migrate step is configured
   on the api service but **verified not to run** on this Railway plan — after
   any schema change, apply the migration by hand with the `railway ssh` command
   in `docs/HANDOFF.md` §7.
2. **Vercel** — blocked only on an owner login. The CLI works once npm points at
   a writable cache (npm trap in `docs/HANDOFF.md` §8). Then the SSE cross-origin
   check (G-E6, riskiest) and `NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED=true` —
   without it the transcript panel renders a disabled placeholder, not the live
   stream the demo film is built around.
3. Track F: security check, adversarial review, Playwright baselines, PR.
4. Real telephony: wire the guards, then compile the IVR maps into Retell
   `press_digit` tools + states.

## Demo film work (this session)

Decision: the demo video shows **simulated** calls, clearly labelled, aimed at
dental-practice prospects. Real IVR navigation is not built (§5 of the handoff),
so the alternative was a week-plus of telephony work plus per-payer calibration.

Shipped (`27c1619`): a six-scenario demo call library
(`packages/payer-ivr/src/retell/demo-scenarios.ts`) replacing the autopilot's two
inline outcomes, so concurrent demo calls read as six different conversations
across three payers. Fixed three defects found on the way — inverted Retell
speaker roles, `pickRole` mapping every `user` turn to `agent`, and a transcript
UI that rendered no speaker at all. `QUEUE_CONCURRENCY=6` set on the Railway
call-worker so six calls genuinely run in parallel.

Shooting script (7 beats, VO, capture runbook, 58s cutdown):
<https://claude.ai/code/artifact/cf2412ac-9c50-4526-98eb-06c49010cb9d>

Open question for the owner: the script leaves every statistic blank
(`‹your figure›`) rather than inventing hold-time or hours-saved numbers.

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
