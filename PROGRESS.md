# DentaBill AI — Progress

Human-friendly status report. For details see `docs/SESSION_CONTEXT.md` and `docs/TASKS.md`.

**Last updated:** 2026-10-14
**Current work:** narrated synthetic demo delivery and dental recovery implementation on latest main `4497459` (AWS baseline `23cdc7b`), branch
`codex/w0-containment`. The full parity assignment remains incomplete; no overall completion claim.
[Capability/provider matrix](./docs/PROVIDER_EVIDENCE.md) and
[session evidence](./docs/SESSION_CONTEXT.md) distinguish local fixes, documented APIs,
actual account probes, and blocked end-to-end capabilities.

**Latest local slice — FW-45 narrated film and landing integration (ADR-086):**
The actual authenticated synthetic recording is now a 171.6-second (about 2:52), 1600×1000 film
with local Kokoro af_heart narration, original quiet instrumental music, a poster, 43 English
captions and a ten-chapter descriptive transcript. Independent local Whisper transcription
checked all ten narration chapters without material omissions. Native landing playback is
user-controlled, with no autoplay/loop and no MP4 fetch before play. The shared brand now uses
the open-D ribbon across the mark, favicon and Apple icon.

22 tests across four files, 10 affected lint/type checks and the isolated Next production build
pass. Actual Chrome landing/transcript desktop and mobile QA has no overflow, page errors or axe
violations; play, seek, fullscreen, captions, download and byte-range delivery are verified.
These checks are separate from ADR-085's 205 cases. The finish review requested established
Inter/Newsreader fonts and removal of a decorative transcript eyebrow. Both fixes pass updated
desktop/mobile QA; self-hosted fonts include their OFL notices. The reviewer returned SHIP for
those fixes, without claiming independent whole-film/audio/motion approval. Owned review servers
and runtime are stopped/removed. The detector could not run (permission denied, exit 126), so it
supplies no verdict. No production publication or deployment occurred.

The film labels synthetic data and simulated call/analysis, distinguishes imported financial
evidence and does not claim live payer/bank/PMS integration, settlement or recovered revenue.
Production notes and hashes are in `docs/demo-film/`; local editable sources are gitignored.
ADR-085 is committed as `de6b1ac`.

**Immediate next:** commit ADR-086, then FW-43 additive canonical source
observations, reviewed legacy binding and additive snapshots. The eight legacy actor-write
repairs and the full financial/connector plan remain open; the full goal is ACTIVE.

**Previous local slice — FW-45 authenticated synthetic rehearsal (ADR-085), committed as `de6b1ac`:**
Real Clerk development sign-in succeeded through an official short-lived ticket. Bearer-token
`/v1/me` returned 200 for the exact local OWNER without test headers. The actual UI imported two
claims, completed a 39-second synthetic payer-matched call, and displayed readable conversation
and a pending legacy summary with CALL_BACK. Claim A remains MANUAL_REVIEW; there is no native
observation, audio, actual DTMF, payer contact or paid-model proof.

The browser accepted reports of $100 + $80, batch net $150 after a $30 provider adjustment,
cash $150 and matches of $100 + $50. Posting header $150 and entries $180 stayed distinct, with
exact-line A and claim-only B associations. Correction to $140 staled and blocked old reservations;
full releases then rematch $140 left cash capacity $10 and batch capacity $0. Database proof
corroborates the sequence. It does not establish settlement, claim allocation or recovered money.

205 distinct focused cases pass across separate runs, followed by an overlapping 24-case recheck.
Final affected lint/type checks pass 30/30; API and isolated Next production builds pass. Actual
authenticated call/audit desktop and mobile QA, including the audit drawer, has no overflow,
page errors or WCAG axe violations. Session revocation, owned-service shutdown and private test/
build cleanup are complete; the local rehearsal database is preserved. Eight older API audit
writes need a separate tested actor repair; historical null actors remain unassigned.

Raw capture is complete at 1440×900, 25fps and 1242.24s, with 11 extra review shots. The edited/
captioned video, poster/transcript package, landing integration and deployment remain open.
ADR-084 is committed as `19f4b9b`.

**Next task at the ADR-085 checkpoint (superseded above):** edit the actual recording and integrate its finished
poster/captions/transcript with user-controlled responsive playback. FW-43 source observations,
reviewed legacy binding/additive snapshots and the remaining financial/connector/full-plan work
stay open. FW-45 and the full goal are not complete.

**Previous local slice — FW-45 isolated demo launcher (ADR-084), committed as `19f4b9b`:**
The launcher starts the actual API and Next app from private runtimes with explicit environment
allowlists. The API child repeats the read-only preflight before binding its admitted loopback
origin and requires configured Clerk keys. Next uses a physical private source/public/shared-UI
copy, excludes repository dotenv and receives no database or job secret. Two trusted root/app
dependency links and installed TypeScript/React types/Node types checks address the first failed
Next startup. The web hostname must explicitly be `localhost`; the API permits admitted loopback
hosts and ports must differ and be nonzero, without silent rewriting. Parent-owned IPC messages
bind readiness to the launch UUID and approved origins; API readiness and the served manifest hash
are checked before SERVICES_RUNNING. Startup uses exact ports, with no fallback or unrelated
process termination. Bounded shutdown stops only owned process groups, preserves the database and
reports unconfirmed cleanup. Child logs are discarded. Actual CLI smoke passes: running services,
exact manifest/public200, test-header auth bypass rejected401, SIGTERM stop, released listeners and
unchanged database hashes. The smoke used fake Clerk keys. The final combined suite passes 70/70
across 8 files; affected API/dependency lint/typecheck24/24, all three strict CLI types and API
production build pass. Independent API/process/web review is clear.
ADR-083 is committed as `f3c8796`. SERVICES_RUNNING leaves authentication, authenticated rehearsal
and recording NOT_VERIFIED; no new schema migration, public API contract or product UI is added.

**Previous local slice — FW-45 create-only demo provisioning (ADR-083), committed as `f3c8796`:**
`demo:provision` reuses the isolated runtime and explicit local demo guard from ADR-082
(`be680d6`). It stages all checked migration bytes before creating a fresh admitted localhost
database. Existing databases and competing creation are refused; there is no reset, drop or
resume path. After exact migration-journal and empty-workflow checks, one transaction creates
the exact synthetic practice, Owner, payer configuration and `demo.provisioned` audit. A read-only
postcheck precedes the receipt with actor/audit IDs, provision UUID, manifest hash and migration
digest/count. Failures preserve created databases; uncertain child/cleanup/report outcomes do
not claim nothing was created. Authentication, rehearsal and recording remain NOT_VERIFIED.
15 database tests and 27 focused tests pass across two runs (42 cases); independent review found
no actionable issue. Actual CLI 33-migration creation, unchanged existing-target refusal and
read-only preflight smoke pass. Affected API/dependency lint/typecheck passes 24/24, both CLI
entrypoints pass strict typecheck and the API production build passes. The final 8-case recheck
passes without adding to the 42 distinct cases. No new schema migration, public API or product
UI change is introduced.

**Previous local slice — FW-45 synthetic demo preparation (ADR-082), committed as `be680d6`:**
A connected public fixture bundle and manifest now describe the actual financial-review workflow:
claims/remittance100+80, provider adjustment−30/batch150, cash150 matched100 then50, posting
header150/entries180 and an optional correction140/release chapter. A read-only CLI preflight
requires an exclusive localhost `dentabill_demo_` database, exact local/Clerk actor bindings,
current migration checksums, verified fixture hashes and explicit synthetic configuration.
Known external provider/cloud/billing/mail settings are rejected; Clerk test-key presence is
reported as not verified. The guide follows existing screens and replaces the outdated seed/
simulator instructions. It does not provision the database/actor, launch servers or record video.
Generated Prisma could reload repository dotenv after validation, so the initial115-test baseline
did not prove startup isolation. The private0700 client/bundled runtime now uses no configured env
paths, minimal generation/build environments and an allowlisted command environment. Fresh122/122
checks plus15/15 helper cases pass in separate runs, including zero guarded dotenv reads. A fresh
isolated33-migration CLI smoke passed with unchanged1-org/1-actor/0-claim/0-audit data and nonworking
Clerk keys. Current affected API/dependency checks24/24, strict CLI types and API production build
pass; the earlier30/30 was a broader pre-fix scope. Installed Node/pnpm/tsx
remain trusted; parent preloads already executed cannot be undone. Authentication stays unverified. ADR-081 is committed as
`8dd6f11`. No schema, public API or product UI change is part of this bounded preparation.

**Previous local slice — FW-44 posting-entry relationships (ADR-081), committed as `8dd6f11`:**
Reviewed associations now bind a current accepted posting entry to an exact-source imported claim
and, when supplied, its immutable source line. Supported source system, namespace and claim ID
must agree; a source line requires an exact local line and any supplied procedure ID must agree.
Without a source line, the relationship remains claim-only even if a raw procedure reference exists.
Source snapshots and signed header/entry facts remain separate. Immutable link/full-release
receipts retain source-entry reservations across revisions and receipts until explicit release;
newer or rejected evidence and claim edits can make the relationship stale. No claim amount,
status, cash, settlement or recovered revenue changes.
Migration 33 is frozen and applied only to localhost isolated/shared databases. DB 68 plus
preservation 1, SDK 63, UI 56 and focused API 47/47 pass. Prior DB regressions have passing evidence
for all 292 cases across an initial 290 passes and two timeout rechecks; this was not a clean full
rerun. Independent API/SQL reviews found no actionable issue. The synthetic actual-page/hook/SDK
1280/390px browser batch has no overflow, page errors or axe violations; independent review returned
ship and separate documentation inspection found no durable system change. Detector 126 gives no
verdict; this does not verify the authenticated full app. Full API passes 956/956 across 44 files.
Affected lint/typecheck 30/30 and API/Lambda/Next production builds pass. ADR-080 is committed as
`710060b`; no real source integration, financial action, merge or deployment ran.

**Previous local slice — FW-44 batch source corrections (ADR-080), committed as `710060b`:**
Migration 32 adds immutable stable batch identity, source revision and permanent member ownership
sidecars. Existing version 1 evidence remains unchanged and explicitly unsequenced; version 2
uses a new source record and positive sequence under the original batch identity. Review/history
and cash reconciliation use the latest observed revision, even when a newer revision is rejected.
Members can repeat within that batch; omission cannot transfer ownership. Prior cash matches keep
their reservations until explicit full release. Exact review retries retain the immutable review
object while refreshing currentness metadata. The dashboard exposes source history, membership
changes and a version 2 example; zero net is not withdrawal.
Migration 32 is frozen and applied only to localhost isolated/shared databases. DB 27 plus expanded
preservation 1, prior financial regressions 344, SDK 57, focused batch API 71/71, cash API 66/66 and UI 70 pass, with web/API types and scoped lint.
Full API 909/909 across 43 files and API/Lambda builds pass. The final combined 1280/390px
synthetic component captures report no overflow, page errors or axe violations; independent review
returned ship and the documentation pass found no durable system change. Next production build and affected lint/typecheck 30/30 pass. No real source connector, financial action, merge or
deployment ran. FW-40 is the previous committed slice (`4af99ec`); external delivery stays disabled.

**Previous local slice — FW-40 (ADR-079), committed as `4af99ec`:** review alerts now commit
atomically with source/domain/audit changes. Frozen intent identity, recipient, generic payload
and delivery key feed a synthetic-only dispatcher with one-minute leases, at most five attempts,
a fixed 23-hour retry deadline and immutable receipts. Native human review suppresses alerts
that never reached submission. Owner/Admin Operations exposes audited read-only counts, filters
and history; external email delivery is disabled and no send/retry/rebind action exists.
Migration 31 applied only to localhost isolated/shared databases. DB 37 plus preservation 1,
prior inference/observation/regeneration 53 plus native accounting 34, producer 69 and process/
transport 9 pass. Focused notification API 15, affected lint/typecheck 30 and API/Lambda/Next
builds pass. Full API 878/878 across 43 files passes. The full worker run passed 144/145 cases;
one existing 5-second process timeout occurred under measured host CPU saturation. After aligning
two process-test timeouts to the adjacent test's 25-second bound, the focused recheck passed 3/3.
All 145 worker cases have passing evidence across those runs, not one clean full rerun. Independent
API/dispatcher review found no actionable issues. SDK 56, notifier 20, UI 35 and web typecheck/lint
pass. One 1280/390px
synthetic component capture batch has no overflow, page errors or axe violations; separate visual
review returned ship and documentation review required no system change. Detector exit 126 gives
no verdict; the full authenticated shell was not exercised. No real messages, paid inference,
provider calls, merge or deployment ran.

**Previous local slice:** independent PMS posting receipt observations (ADR-078): immutable revisions,
separate header/entry facts, unknowns, fresh reviews and historical entry-identity protection across
incomplete snapshots. API/SDK/dashboard work locally; source references remain UNLINKED and
source/bank verification/settlement UNVERIFIED. Migration30 local only. NewDB90, prior financial/
tenant287, focusedAPI51, SDK53, UI39 and lint/types30 pass; API/Lambda builds and independent
reviews pass. Next build and fullAPI863/863 across42 files pass. Real connectors, posting relationships, source
corrections, allocation/attribution and the full remaining plan stay open.

**Additional local fix:** FW-30 tenant rate limits now run after authentication on call enqueue
and practice settings. Four before/after regressions and focused77/77 pass (ADR-077). This
removes shared anonymous quotas across practices; deployed/fleet-wide behavior remains unverified.
Independent PMS posting evidence is implemented locally as recorded above.

**Previous local slice:** FW-44 reviewed cash-to-batch reconciliation (ADR-076) supports signed
partial many-to-many matches with exact accepted source/review bindings, two-sided capacities,
retained stale/replacement reservations, immutable retry receipts and explicit full releases.
Migration29/API/SDK/dashboard are locally implemented and validated. FullAPI808/41files, focused55,
newDB59+preservation1, financial/tenant228, UI50, SDK48 and lint/types30 pass; API/Lambda/Next
builds pass. Synthetic desktop/mobile checks and independent API/UI reviews pass. The coherent
slice is committed locally; no merge or deployment. The durable full-scope goal remains ACTIVE.

Next financial dependency: explicit source/batch corrections, reviewed posting relationships,
claim cash allocation/attribution and all remaining recovery/integration/AI/voice/operation gates. Manual
matching does not verify bank receipt, post a payment or settle a claim. No real financial action ran.

**Previous local slice:** FW-44 now preserves explicit remittance batch net, full signed claim
report membership and provider adjustments with original signs/codes/references (ADR-075).
Import, fresh preview, immutable review and dashboard support100+80−30=150 without calling150
verified cash. Incomplete/unknown/unbalanced evidence cannot be accepted; claim report events
cannot be counted in two accepted batches. Migration28 applied only to localhost. NewDB54 plus
preservation1, existing financial/tenant regression174, focusedAPI51, fullAPI753 across40 files,
UI37, SDK43 and lint/types30 pass. API/Lambda/Next production builds pass. Synthetic desktop/mobile
checks and independent API/UI reviews pass; real auth/source integrations remain unverified.
Batch revisions/corrections were unsupported at this checkpoint; ADR-080 adds them above. This slice is committed locally on `codex/w0-containment`.
Full regression/build verification is recorded in
the [handoff](./docs/HANDOFF_2026-10-13.md).

Next: evidence-bound bank-to-batch reconciliation with revision/staleness and cash-capacity
checks, then independent PMS posting receipts. Source authenticity, receipt, posting, settlement,
real connectors and full parity remain open. No production or real financial action ran.

**Previous local slice:** FW-44 cash source import/review now has immutable account-level
observations, ordered revisions, fresh biller acceptance/rejection, bounded replacement identity
checks, audit-safe retries and the dashboard workflow (ADR-074). Additive27 fixes direct SQL/API
Unicode token mismatch without changing applied26 or shared helpers. Cash DB73 plus migration
preservation/rollback3, tenant32, focusedAPI50 and affected lint/types30/30 pass. API and both
Lambda builds pass. Full API **702/702 across39 files** passes; the original interrupted run
is not counted. The coherent cash-source slice is committed on `codex/w0-containment`.
Prior unchanged web32, SDK39, Next production build and synthetic desktop/mobile checks pass.
Migrations26/27 ran only locally; no production deployment or actual financial action occurred.

Follow-on batch-net/provider-adjustment evidence is now implemented locally above; evidence-bound bank
reconciliation and independent PMS posting receipts. Bank verification and settlement stay
UNVERIFIED; real connectors, reviewed external posting and full parity remain open. Exact
verification and continuity are in [the handoff](./docs/HANDOFF_2026-10-13.md).

**Previous local slice:** FW-21 now imports custom remittance evidence through the claim page,
requires a fresh biller preview and records immutable accept/reject decisions (ADR-073).
Exact source-line allocations, signed adjustments and partial reversals remain separate from
cash, posting and settlement. Tenant isolation, duplicate retries, stale approvals, reversal
limits, audit rollback and retained financial references have local tests. The UI preserves
uncertain retry commands and pages evidence within AWS response limits. Migration25 ran only
locally. UI20, SDK34, DB70 plus tenant32, affected typecheck/lint30/30, API build, Lambda
bundles and Next production build pass. Full API **652/652** passes; exact verification is
recorded in session context. No full financial-correctness or production-ready claim.
FW-44 adds independent cash/posting evidence next. Native remittance/provider adjustments,
real PMS/clearinghouse connectors, recovery actions, live AI/voice and AWS deployment remain open.

**Previous local slice:** FW-21 now imports procedure-level source lines and coverage through the
real upload/claim-detail workflow (ADR-072). Repeated codes retain distinct line identities;
explicit totals, coverage sequence/target and missing identities remain accurate. Tenant-scoped,
immutable snapshots commit with parent/audit and survive exact reimports. The UI separates source
totals from local corrections, paginates procedures and isolates detail caches by user/practice.
Migration24 ran only locally. Full API607, SDK30, DB snapshot48 plus migration1/tenant32 pass;
UI19, scoped types/lint30/30, both Lambda bundles and the full Next.js production build pass.
Exact evidence and browser limitations are in session context.
Financial allocations/partial payments/adjustments/reversals remain the next FW-21 slice. Real PMS
and clearinghouse connectors, recovery actions, live AI/voice validation and AWS rollout/evidence
remain substantial work. No paid inference, deployment, actual claims or payments changed.

**Previous local slice:** FW-19/20 now imports with explicit source identity, database-enforced
uniqueness and atomic chunk/audit writes. Repeated/concurrent files cannot duplicate the same
source record. Changed records and legacy matches receive a row report without overwriting
reviewed work. The upload screen requires a stable database name and exposes conflicts, links,
report download and all validation errors. Migration23 preserves legacy duplicates; it ran only
on localhost. Import113, UI24, SDK30 and migration replay pass; scoped type/lint30/30, both
Lambda bundles and the web production build pass. Exact full-suite results and browser limits are in session context.
Real PMS sync, reviewed source updates/legacy binding (FW-43), financial modeling and all
external parity gates remain open. No paid inference, deployment or real claim changes ran.

**Previous local slice:** FW-42 has a functioning contract-discovery CLI with exact corpus/account/
artifact bindings, one attempt per case, private durable raw receipts, conservative spending
allowances and crash-safe replay (ADR-070). It preserves unapproved candidates and cannot return
production observations. Read-only Fireworks account/model checks pass; regional router metadata
returned403. Serving identity, credits/Auto Reload, actual captures, billing and model quality
remain unverified. No inference, phone call, migration or deployment ran. Verification and the
concrete proposed first run are in session context.

**Previous local slice:** FW-15/16 now has 25 independent DRAFT synthetic cases, deterministic
offline scoring and an executable seed/replay/verification CLI (ADR-069). Exact corpus/input
bindings expose omissions and swaps; separate coverage/abstention/subgroup measures prevent
blanket refusal from looking accurate. The baseline uses the fake gateway without gold-label
fixtures. Review packets bind all evidence and keep production approval false. Qualified human
adjudication, provider capture, real model quality/cost and held-out evidence remain missing.
No external inference, deployment or model approval ran. Final checks are in session context.

**Previous local slice:** automatic native post-call jobs now publish immutable findings through
the shared worker runtime and expose safe status, owner recovery, operations completion and a
claim-findings link (ADR-068). Persisted provider/request identity survives duplicate delivery
and configuration changes. Migration22 archives release approvals for no-send receipt recovery;
fresh sends require current approval and claim/source checks. Historical audited findings stay
recoverable after transcript correction and remain visibly stale for review. Defaults remain
synthetic; checked-in models are unapproved. Production is unchanged. Final local verification
is in session context; model evaluation/approval, voice and real connectors remain open.

**Implemented locally:** honest operational reporting with verified payments unavailable;
model-only financial closure blocked; stale summary states protected; atomic summary/state/
audit commit; missing subscriber/NPI blocks enqueue/dial without fallback or retry across
BullMQ/inline/AWS SQS. Unknown raw codes are preserved for review and erroneous reference
annotations corrected. Retell wire events now enter a transactional pending inbox;
canonical final transcripts feed summaries without duplicate cumulative snapshots, and
missing/empty/provisional transcripts abstain. Producer crash/early-delivery recovery
passes across separate processes. Stop-call replaces data deletion; signing configuration
uses the provider-designated API key. Call intents now fence submissions before the provider request; two separate-process worker
crash tests verify one synthetic acceptance with no redial. Accepted calls resume; uncertain
calls remain reserved for reconciliation. SSE catches up across replay/Redis gaps and waits
for actual terminal evidence. Call/summary delivery now commits through a leased transactional
outbox; separate-process producer/relay crashes recover the same command without a second
synthetic call. Inline receipts wait for durable disposition. Cancellation remains visibly
pending until provider confirmation. Owner/admin lookup now reconciles uncertain call IDs
against the saved request and commits verified source evidence plus a distinct durable resume
command; separate-process crashes and create-response races preserve one synthetic call.
Accepted calls now have persisted observer leases/deadlines, bounded provider status/Stop
checks, review after unconfirmed termination and manual read-only status recovery. Crash tests
keep one call while Stop ACKs remain distinct from terminal evidence. Prisma diagnostics now
exclude raw query/error payloads. Owner/Admin Operations now exposes aged/quarantined work,
exact-snapshot recovery with three additional attempts and a distinct reviewed close. Retained
BullMQ and SQS/inline provenance preserve the original domain identity; delayed failure notices
cannot cancel newer approved work or silently acknowledge an unresolved intent. All remain local
and synthetic; account sweeps, deployed recovery/alerts and authorized real-provider tests remain
pending. Current API393, worker186, database77, queue78 and SDK19 tests pass. Full web383 passed
with19 affected UI tests repeated after the final markup/fixture corrections. Types/lint28/28
and Lambda packaging pass. See session context for proof and limits; counts do not certify
external workflows. No production deploy, schedule activation or real calls ran.

**New gateway slice:** FW-10–13 now implements a typed Fireworks text adapter, explicit synthetic
fake, reviewed release policy, source-bound observation validation and bounded transport with
safe failure/usage records. Independent review fixed cancellation losing prior attempts and
foreign-currency ambiguity. Both model candidates remain unapproved; worker/voice integration,
live inference accounting integration and real-provider/dental evaluations remain open. The user added the
Fireworks/ElevenLabs keys; both pass bounded read-only authentication (HTTP200). Gateway274
tests /5files and scoped checks7/7 pass. No inference, speech, call or production change ran. See ADR-063 and session context for final test evidence.

**Durable summary slice:** FW-26 now gives the synthetic worker one durable generation/attempt,
immutable source snapshots, independent usage receipts and resumable summary/review application.
Unknown usage stays reserved across days; retries cannot resubmit an ambiguous request.
Owner/Admin summary status and safe delivery retry are available; final SQS exceptions remain
retryable. Configured legacy Claude is blocked by the production factory. Local migrations14/15,
concurrency/rollback checks and three separate-process crash proofs support this boundary.
That slice left Fireworks per-send accounting (now implemented in FW-41 below) and versioned
summaries (FW-27) outstanding;
the notification outbox gap is now locally addressed by ADR-079/FW-40, with external delivery
remaining open. Verification for that earlier slice: **791 affected-package tests**
(API415, DB94, summary-worker64, summarizer84, queue79, types36, SDK19), typecheck/lint24/24
and both AWS Lambda packages pass. No paid inference or production change ran. See ADR-064
and the latest session entry for evidence and limits.

**Native inference slice:** FW-41 now journals admission before every Fireworks HTTP request,
saves bounded response evidence before validation, and accounts for retries independently.
The explicit worker adapter recovers saved responses without resending, retains uncertain usage,
rejects contradictory token totals, and refunds expired reservations only when no attempt was
admitted. Process crash and pending-transaction cancellation proofs use localhost synthetic
providers. Migrations16–18 are local only; existing jobs remain synthetic and model releases
remain unapproved. Versioned observation publication/review is now local (FW-27 below); notification delivery
now has the local FW-40 outbox (ADR-079), while external delivery remains disabled. For this
earlier native inference slice, **910 affected-package tests** pass (gateway297, DB111, summary-worker87,
API415), along with typecheck/lint24/24 and both AWS Lambda packages. No live inference or
production change ran. See ADR-065.

**Finding review slice:** FW-27 now publishes immutable native findings from saved responses,
with exact final-event/text binding, original-intent chronology, source excerpts and version-bound
biller acknowledgment/dismissal. Changed claims, newer calls and changed transcripts make
review stale; historical review receipts remain visible. Publication failure/retry cannot erase
usage or resend inference. Legacy summaries and financial state remain unchanged. Migration19
is local only. Same-call regeneration and automatic native job routing remain unfinished; no
live model or connector evidence follows from these synthetic workflows. Full DB130, summary95,
API434, web397 and SDK23 passed; final affected API20/web18/worker8 tests pass after the last
isolated edits. Desktop/mobile component checks and Lambda packaging pass. See ADR-066.

**User direction:** ElevenLabs speech/orchestration is permitted, business inference stays
on Fireworks open weights. There is no pilot clinic yet: all development uses fake patient
data. AWS Lambda/SQS/Aurora is the current backend; the Vercel-only notes below are historical.
The frontend remains on Vercel. The live worker is configured for demo mode. AWS readiness
passed on a second direct Function URL probe; custom API-domain readiness remains unverified.

**Still required:** real financial reconciliation, source sync/electronic connectors,
version-bound reviewed actions, durable external-intent recovery, Fireworks worker integration/evals,
voice contract/behavior proof, PHI agreements, production validation and authorized clinic evidence.

### Historical go-live report — 2026-08-22

The following test counts, deploy tasks, and completion claims describe that earlier
session. They are not a current audit of production readiness. ADR-053 supersedes the
older deployment target for the zero-extra-hosting demo.

**Current phase:** Phase 5 — Go-live for investor demo (**tracks A–E2 executed; deploy + telephony next**). Plan: `docs/GOLIVE_PLAN.md` (ADR-051); execution findings: **ADR-052**. All gates green: typecheck 16/16 packages, ESLint 0 errors, **1,006 tests passing**, three Docker images building, api image verified booting and serving `/v1/readyz` 200 with live Postgres + Redis probes.
**Proven end-to-end, not asserted:** one real enqueue drove `PENDING→CALLING→DENIED→MANUAL_REVIEW`, a 42s call with 16 CallEvents, a CallSummary at 0.88 confidence, and an audit row carrying `summaryId` + `confidence` + `promptVersion` — demo-script step 7 working for real.
**Next task:** Deploy to Railway + Vercel (E3–E7), then real telephony. Retell is further along than the docs claimed: the API key works, all three payer agents already exist in the account, and the outbound number + agent IDs are configured. The remaining telephony gap is that the agents carry only an `end_call` tool — **no `press_digit`** — so they can talk to a rep but cannot navigate an IVR. Fix is a compiler from `packages/payer-ivr/src/ivr/maps/*` (already a `WAIT`/`DTMF`/`COLLECT_VOICE_INPUT`/`WAIT_FOR_HUMAN` step machine) into Retell `press_digit` tools + states. The hold detector, duration guard and a `waitForCallEnd` timeout also remain unwired — no real call should be placed until they are.
**Carry-over (deferred, user-driven):** **P2-T52** — `PRODUCT.md` via `$impeccable teach` (interactive skill — cannot be done autonomously).

---

## Phase status

| Phase | Name                      | Status                                                                                                                                     |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Foundations               | **Complete** (12 of 12 tasks done, merged via PRs #1–#13)                                                                                  |
| 2     | UI + API + Ingestion      | **Substantively complete** — 54 of 55 tasks merged (PRs #14–#64); W1–W7 ✓; T52 still deferred to interactive `$impeccable teach` follow-up |
| 3     | Queue + Voice             | **Complete** — 31 of 31 tasks merged (PRs #80–#99); W0–W6 ✓                                                                                |
| 4     | Intelligence + Realtime   | **Substantively complete** — 12 of 21 W0–W8 tasks merged across PRs #101–#121; deferred items captured in ADR-050 carry into Phase 5       |
| 5     | Deployment + cloud target | Queued (cloud decision lives here per ADR-004; first task: P5-T0 ADR cluster)                                                              |

## PRD step checklist

- [x] Step 1 — Monorepo (Phase 1)
- [x] Step 2 — Database Schema (Phase 1)
- [x] Step 3 — Authentication (Phase 2 — Clerk integrated in P2-T28; auth flow + onboarding through P2-T31)
- [x] Step 4 — Dashboard Shell (Phase 2 — P2-T32 → P2-T36 merged; claims list T41 + claim detail T42 + import T51 layered on top)
- [x] Step 5 — API Server (Phase 2 — Fastify scaffold T12, OpenAPI T13, auth T37, claims CRUD T38, pagination T39, state machine T40 all merged)
- [x] Step 6 — CSV Upload (Phase 2 — P2-T43 endpoint, T44 parser, T45 DOB hash, T46 payer lookup, T47 priority, T48 bulk insert + cross-org test, T50 fixtures, T51 upload UI all merged)
- [x] Step 7 — Job Queue (Phase 3 — `@dentabill/queue` BullMQ v5 wiring + retry/DLQ T1/T2; call-worker bootstrap + handler T9/T10; e2e against real Redis T15)
- [x] Step 8 — Retell Integration (Phase 3 — `RetellPort` + `FakeRetell` + `LiveRetell` adapters T5/T6/T7; HMAC-verified webhook T17; per-payer agent prompts; ADR-033/036/040)
- [x] Step 9 — IVR Maps (Phase 3 — Delta Dental PPO / Cigna Dental / MetLife Dental DTMF maps + business-hours guard T3/T4; navigator with retry-on-misdetect + 2-failure operator fallback T11; hold detector T12; per-call cap T13; DLQ consumer T14)
- [ ] Step 10 — Call Analysis (Phase 4)
- [ ] Step 11 — Real-Time Updates (Phase 4)
- [ ] Step 12 — Cloud Deployment (Phase 5; cloud target deferred per ADR-004)

## Recent activity

- **2026-10-15 — ADR-087 demo film:** 67-second Remotion motion-design film (`apps/demo-film`)
  replaces the 2:52 walkthrough on the landing page; call detail screen redesigned (outcome card,
  phone tree path, chat conversation, live banner). Uncommitted; not deployed.
- **2026-10-13 — FW-27 publication/review:** immutable native findings and exact-version biller
  reviews, scoped APIs/SDK/evidence UI, final-event binding and recovered-call chronology.
  Migration19 only on localhost; same-call regeneration remains open. No production or paid
  provider action ran.

- **2026-10-13 — FW-41:** durable native HTTP admission/response journal and worker adapter,
  independent retry allocation, cancellation/restart proofs and conservative usage settlement.
  Migrations16–18 only on localhost; no production activation or paid-provider execution.

- **2026-10-13 — FW-26:** durable synthetic inference reservations/receipts, resumable local
  application/review, tenant-scoped status/retry and process-crash proof. Migrations14/15 only
  on localhost; no production or paid-provider execution. FW-27/40/41 remain open.

- 2026-10-13 — Local FW-37 admin operations/recovery, additive migration13, immutable delivery
  generations across BullMQ/SQS/inline, and stale-failure acknowledgement protection. Real
  PostgreSQL fault tests and retained Redis jobs pass; UI/accessibility reviewed at desktop/mobile.
  Fireworks gateway primary contracts refreshed, with no model approval. See ADR-062 and session
  evidence. Next: typed Fireworks gateway/validation/failure fixtures, then inference ownership.

- 2026-10-13 — Local transactional call/summary outbox and bounded leased recovery; AWS
  schedule prepared but disabled, inline premature receipt fixed, cancellation made atomic
  and pending in the UI. API 325, worker 99, DB 66, queue 65, SDK 19 and call UI 73 checks pass;
  types/lint/Lambda packaging and Terraform validation passed. Latest AWS domain move
  `23cdc7b` (`usedentabill.xyz`) incorporated at final ancestry check. Separate-process crash proof
  uses synthetic broker/provider ledgers. No production changes. See ADR-059.

- 2026-10-13 — Local call intents now prevent blind redial after ambiguous acceptance and
  resume accepted calls across worker crashes; two process-crash regressions use an independent
  synthetic provider ledger. SSE catch-up and provider-terminal closure fixed. Latest AWS
  certificate commit `c34e970` merged into this working branch. Full suites: API 257, worker 78,
  provider 196, DB 65, queue 56, SDK 19; type/lint/Lambda build checks passed. No production changes.

- 2026-04-29 (autonomous burst — Phase 3 complete). 21 PRs merged (PRs #80–#99) covering all of Phase 3:
  - **W0 / W1 / W2 (call worker spine):** ADR-cluster 031–040 (T0); BullMQ queue + retry/DLQ (T1, T2); IVR maps + business hours (T3, T4); RetellPort + FakeRetell + LiveRetell (T5, T6, T7); Prisma `Call` columns + index (T8); call-worker bootstrap + real handler (T9, T10) with the three corrections caught while testing (`findFirst` over `findUnique`, `updateMany` with composite where, serialised `waitForCallEnd` chain); IVR navigator (T11); hold detector + reschedule resolver (T12); per-call duration cap (T13); DLQ consumer (T14); full lifecycle e2e against real BullMQ + real Postgres + FakeRetell (T15).
  - **W3 (API):** `POST /v1/claims/:id/calls` enqueue (T16); HMAC-SHA256 webhook with replay protection via unique `eventId` (T17); cursor-paginated calls list + detail + soft cancel (T18, T19, T20) — cancel is soft-only in Phase 3 (DB marker; live Retell continues until natural termination), Phase 4 needs a true cancel channel; SDK regen + contract test asserting the typed paths union covers every endpoint (T21).
  - **W4 (UI):** Call-Now Pill on claim row + claim detail (T22); live status indicator unlocking the muted-teal accent for `IN_QUEUE` / `CALLING` (T23); virtualised `/dashboard/calls` list + detail with 5s/30s adaptive polling (T24); live overview KPI tiles via `GET /v1/calls/stats` (T25). Web-bundle invariant preserved — every UI surface consumes `@dentabill/api-sdk` only.
  - **W5 (observability + ops):** logger redact paths for `dtmf` + `transcriptText` (T26); `audit()` extension covering Call lifecycle reads + writes (T27); `docs/RUNBOOK.md` oncall playbook with seven scenario sections including the "single claim stuck in CALLING" recovery transaction (T28).
  - **W6 (closeout):** ADR-041 retrospective (T29); doc closeout in this PR (T30) — `PHASE_PLAN.md`, `PROGRESS.md`, `TASKS.md`, `CODEMAP.md`, `SESSION_CONTEXT.md` updated.
  - 41 ADRs total now in `docs/DECISIONS.md` (Phase 3 added 11: ADR-031 → ADR-041).
- 2026-04-26 (late afternoon) — **Phase 2 W7 closeout.** ADR-030 retro appended (8 keep/stop bullets covering one-task-one-PR discipline, bundling co-shipped tasks, conditional Clerk gating reuse for Retell, Impeccable design laws, the merge-commit-on-shared-`TASKS.md` pain to fix in Phase 3, per-row errors over throws, client-side mirror of server-authoritative rules, and real-Postgres integration tests for write paths). DESIGN.md final pass replaced TBD font picks with the ADR-013 lock (Inter 200/300, `−0.96px` letter-spacing at 48px hero, brand-color row finalised). PROGRESS / TASKS / SESSION_CONTEXT updated to reflect 54/55. T52 (`PRODUCT.md` via `$impeccable teach`) intentionally deferred to user — interactive skill, cannot be done autonomously.
- 2026-04-26 (afternoon) — **Phase 2 W6 ingestion pipeline complete + W5 UI tasks (T41/T42).** 13 PRs merged (PRs #54–#64): T40 claim state machine (PR #54), T41 claims list page with TanStack-Virtual table + debounced search (PR #55), T42 `/dashboard/claims/[id]` detail with manual-edit dialog using native `<dialog>` + client-side mirror of server transitions (PR #56), T45 `hashPatientDOB` helper with `${orgId}|${iso}|${secret}` keying + ISO-strict date validation (PR #57), T46 payer-name canonicalisation with token-set + anti-token disambiguation (PR #58), T47 priority scoring per PRD §5 (PR #59), T50 Dentrix / Eaglesoft / Open Dental fixtures (PR #60), T44 streaming CSV parser with per-source 3-column header signature + per-row error returns (PR #61), T43 `POST /v1/ingest/claims` upload endpoint (PR #62), T48+T49 bundled — bulk insert with `(organizationId, claimNumber)` idempotency + DB-asserting integration tests covering cross-org isolation (PR #63), T51 `/dashboard/claims/import` drag-drop upload UI (PR #64). All 7 CI gates green on every PR.
- 2026-04-26 (mid-day) — **Phase 2 W2/W3/W4/W5 progress.** 22 PRs merged (PRs #31–#53) covering: full marketing site (T17 chrome, T18 landing, T19 about, T20 pricing, T21 security, T22 privacy, T23 terms + ADR-029, T24 contact, T25 faq, T26 blog skeleton, T27 marketing e2e), Clerk auth flow (T28 conditional gating, T29 sign-in/up, T30 onboarding, T31 auth e2e), dashboard shell (T32 layout, T33 sidebar, T34 topbar, T35 overview, T36 page stubs), and W5 API claims domain (T37 auth plugin with test-header bypass, T38 claims CRUD with 3-layer multi-tenancy + audit on every read, T39 cursor pagination + status/payer/search/sort filters).
- 2026-04-25 (late eve) — **Phase 2 W1 foundation gates complete (16/16).** Eight more PRs merged after the morning checkpoint:
  - **P2-T12** (PR #23) `apps/api` Fastify v5 scaffold — ZodTypeProvider, request-id, structured logger via `@dentabill/logger`, CORS, `@fastify/rate-limit`, `/v1/healthz` + `/v1/readyz`.
  - **P2-T15** (PR #24) `react-hook-form` + `@hookform/resolvers` Zod resolver wired into `@dentabill/ui` Form component; FieldError display, async submission state.
  - **P2-T7** (PR #25) Playwright + axe + visual regression foundation — `apps/web/e2e/` config, base fixture, axe-core integration, per-OS screenshots at 0.1% diff threshold, new `e2e` CI job.
  - **P2-T9** (PR #26) Bundle budget — `@next/bundle-analyzer` + custom CI assertion (≤200 KB initial JS per route, ≤350 KB total).
  - **P2-T8** (PR #27) Lighthouse CI via `treosh/lighthouse-ci-action` enforcing ADR-020 budgets (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms, perf ≥ 90, a11y = 100).
  - **P2-T16** (PR #28) Web observability — `web-vitals` reporter (`sendBeacon` + `keepalive` fallback), `<ErrorBoundary>` posting to `/v1/errors`, `x-request-id` propagation via `<meta>` + fetch wrapper.
  - **P2-T13** (PR #29) OpenAPI generated from Zod via `@fastify/swagger` + `jsonSchemaTransform`; typed `@dentabill/api-sdk` codegen via `openapi-typescript` + `openapi-fetch`.
  - **P2-T14** (this PR) TanStack Query v5 setup at `@dentabill/ui/query` — `DENTABILL_QUERY_DEFAULTS` (30s staleTime, 5min gcTime, retry 3 with exp backoff capped at 30s, mutations no retry to prevent double-sending claims, `throwOnError` true for boundary integration), `<QueryProvider>` with lazy-loaded devtools, wired into `apps/web` via Client `<Providers>`. **Bundled CI hardening** for the two failures left by PR #29: `apps/api/vitest.setup.ts` now seeds test env defaults (DATABASE_URL/REDIS_URL/NEXT_PUBLIC_APP_URL/NEXT_PUBLIC_API_URL) via `process.env[k] ??= v`, and added the `landing-chromium-linux.png` Playwright baseline so CI's Ubuntu visual snapshot stays green.
- 2026-04-25 (eve) — **Phase 2 W1 foundations underway.** Landed eight PRs in dependency order:
  - **P2-T0** (PR #14) ADR cluster 013–028 (16 ADRs locking Phase 2 design contract — visual lock, framework, styling, primitives, API, forms, server-state, perf budgets, a11y, visual regression, security headers, auth, test pyramid, MDX, i18n + Storybook deferrals).
  - **P2-T1** (PR #15) `@dentabill/ui` design tokens — OKLCH color, shadow stack, radius, spacing, typography, motion + drift-detecting test against `theme.css`.
  - **P2-T2** (PR #16) Tailwind v4 preset — `@theme`, `@utility` (status-pulse, shimmer, hairline-edge, shadow-card-layered), focus-visible ring, prefers-reduced-motion handler.
  - **P2-T3** (PR #17) shadcn primitives — Button, Input, Label, Card, Badge, Skeleton, Separator, Avatar themed via tokens; `cn()` with `extendTailwindMerge` for custom class groups; jsdom + @testing-library; 93 tests.
  - **P2-T4** (PR #18) brand primitives — Pill, HeroDisplay, SectionDisplay, ShadowCard, StatusDot. StatusDot's `active` variant is the only chromatic surface in the system (locked muted teal accent + motion-safe pulse). 24 new tests.
  - **P2-T5** (PR #19) Next.js 15 App Router scaffold — `next/font/google` Inter + Geist Mono, RSC root layout with full Metadata + Viewport, error.tsx, not-found.tsx, loading.tsx, icon.svg, robots.ts, sitemap.ts. Webpack `extensionAlias` so `@dentabill/ui`'s `.js` imports resolve to TS sources without a build step.
  - **P2-T6** (PR #20) edge middleware with strict CSP — per-request 16-byte base64 nonce via Web Crypto, `script-src 'strict-dynamic'`, HSTS preload, X-Frame-Options DENY, COOP same-origin, COEP credentialless, CORP same-origin, Permissions-Policy denying camera/mic/geo/payment/FLoC/Topics. Production enforces; dev reports. 17 tests.
  - **P2-T10/T11** (PR #21) ESLint flat config now wires `eslint-plugin-jsx-a11y` (recommended + 3 elevated to error), `eslint-plugin-react` (flat.recommended), and `eslint-plugin-react-hooks`. `eslint-plugin-tailwindcss` deferred (v3 doesn't ingest Tailwind v4 CSS-first; v4-native plugins still pre-1.0); class ordering delegated to `prettier-plugin-tailwindcss`, dedup remains runtime via twMerge.
- 2026-04-25 (am) — **Phase 1 complete.** Closed out the Prisma trio (P1-T4 / T4A / T5). 30 tests in `@dentabill/db`. PRs #1–#13 merged on `main`.

## Decisions log

See `docs/DECISIONS.md`. Currently **41 ADRs** — 9 from Phase 1 + ADRs 010–012 (impeccable skill, SkillUI tooling, ElevenLabs-inspired DESIGN.md) + the Phase 2 cluster ADR-013 → ADR-028 + ADR-029 (terms-template) + ADR-030 (Phase 2 retro) + the Phase 3 cluster ADR-031 → ADR-040 (Clerk-Orgs deferral, per-payer Retell agents, RetellPort adapters, Phase 3 UI scope, queue topology, webhook HMAC, business-hours guard, per-call cap, hold policy, PHI / Retell-audio boundary) + ADR-041 (Phase 3 retrospective, P3-T29).

## Known issues / open questions

- **Live-call wiring gap (2026-08-21, see `docs/GOLIVE_PLAN.md` §1a):** the IVR navigator, hold detector, and per-call duration cap exist as tested modules but are not wired into the production call handler; `RetellPort` cannot send DTMF, so IVR maps never execute; Retell agent IDs are placeholders. No real call has ever been placed. Demo is unaffected (autopilot/simulation mode); real telephony go-live needs its own engineering phase.

- Branch-protection rules still need enabling in the GitHub UI per the checklist in `docs/SECURITY.md`. Auto-merge is working on PRs but enforcement is per-PR rather than rule-bound.
- No external service credentials yet (Clerk / Retell / Anthropic / Resend / Stripe / Telnyx) — `.env.example` placeholders ready, populate as tasks activate them.
- Docker runtime is OrbStack on macOS; `docker compose up -d` from repo root brings up Postgres + Redis healthy.
