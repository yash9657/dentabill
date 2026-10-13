# Session Context

_Last updated: 2026-10-13 (W0 implementation; AWS baseline reconciled)._

## Current session — W0 implementation on AWS baseline

### Latest continuation: independent observation evaluation (ADR-069)

The previous goal turn made concrete progress with automatic native jobs in `f8bdf99`.
The full parity goal remains active on `codex/w0-containment`; the worktree was clean at
this continuation's start. This slice implements FW-15/16 tooling without claiming model
quality or completing the still-missing qualified dental review. No external model request,
speech, call, paid service, database migration or AWS deployment ran. User still has no clinic;
only fake data is authorized for the present corpus. Existing credentials/stashes are preserved.

- New `@dentabill/evals` has strict corpus/result/reviewer contracts. Each complete result
  inventory binds its exact corpus and target-adjusted requests. Missing/duplicate/extra or
  swapped records fail closed. Group, claim-ID and exact-source leakage across partitions is
  rejected. Case changes invalidate review digests; two independent original annotations and
  final adjudication are preserved when supplied, but their credentials remain unauthenticated.
- The 25 independently authored seed hypotheses remain DRAFT/DEVELOPMENT. They cover negation,
  corrections, claim/speaker attribution, partial/unallocated/reversed payments, COB, ambiguous
  currency, unknown code systems, injection and noise. Expected source anchors are exact UTF-16
  spans. No fixture output is generated from the gold labels. The baseline invokes the existing
  fake gateway with no registered outputs and therefore abstains on every case.
- Deterministic scoring separates gateway/output schema, lexical validation, full reference
  values, exact field-bound citation agreement, answerable coverage, false/required abstention
  and all declared subgroups. Failed and malformed answers stay visible in denominators.
  Citation equality is conservative reference agreement, not entailment. Usage includes attempt
  receipts once and exposes missing/inconsistent/overflowed amounts; price and human-time
  measurements remain null. Correlated synthetic development cases get no confidence interval.
- The `seed`, `score`, `verify` CLI creates private exclusive artifacts, recomputes reports and
  evidence packets from original inputs, and pins evaluator/gateway source, manifests/configs
  and lockfile fingerprints. Stored provenance is always an unauthenticated declaration.
  Packets bind all annotations, inventory, results, target policy/artifact and report; every
  packet keeps production approval false. Runtime release configuration is unchanged.

**Verification:** full evaluator **108 tests / 5 files**, affected Turbo typecheck/lint/build
**9/9**, and frozen offline dependency installation pass. Initial CLI assertions were corrected
to tolerate Node26/tsx's unrelated deprecation warning while still checking closed errors and
private-text exclusion. Lint exceptions are confined to intentional local CLI/test filesystem
paths; no global rule changed. The lockfile adds only the new workspace importer.

An actual pnpm CLI seed → score → verify run passed with byte-identical report and review packet:
`/var/folders/2f/5y0vpg7n1v72nc2p9wm66pfh0000gn/T/dentabill-observation-eval-iofeu8dq/`.
Baseline reference agreement is **4/25**, answerable correct coverage **0/17**, false abstention
**17/17**, selective accuracy **null (0 answered)**. All25 cases are DRAFT, no reviewer evidence
is claimed, no provider attempts occurred, and cost remains unknown/null in this report schema.
These numbers characterize the deliberately weak fake baseline, never a Fireworks model.
Logs: `/tmp/dentabill-evals-tests-final.log`, `-checks-final.log`, `-frozen-install.log`, and
`-cli-{smoke,replay,verify}.log` (all share the `dentabill-evals` prefix).

**Exact next task:** FW-42: refresh read-only account/model/contract evidence and build a capped,
auditable synthetic capture workflow through the durable native gateway, retaining actual
request/response/usage provenance against this frozen evaluation inventory. Confirm the existing
budget and execution authorization before paid requests; prepare any needed approval as a
concrete scoped run. Two qualified dental billers, representative untouched held-out cases and
ratified quality thresholds remain separate requirements. FW-39 monitoring, FW-40 notifications,
voice and supported connectors remain open; no clinic-dependent capability is complete.

### Earlier continuation: automatic native generation1 jobs (ADR-068)

The full parity goal remains active on `codex/w0-containment`. Fresh fetch confirms zero commits
behind main `4497459`; both pre-existing stashes remain intact. The user asked how much remains:
the full assignment still requires substantial model, voice, connector and production work.
No clinic exists; all implementation evidence here uses fake data. No new vendor API probe,
paid inference, speech, call, production migration, deployment or account change ran.

- Shared summary routing now honors stored generation1 provider identity before the explicit
  new-job selector. Default is SYNTHETIC; FIREWORKS additionally needs release ID, approved
  scoped manifest, artifact pin and key. Queue payloads are strict and cannot select provider,
  model, source, data class or generation. Production native requests default PROTECTED; fake
  data class and transports are trusted constructor seams only. Legacy factory construction
  is lazy so a historical Anthropic setting cannot block native receipt recovery.
- Migration22 saves immutable native release manifests. Fresh sends recheck current catalog
  approval, artifact, claim version/amount and latest final event on the call. Older calls may
  receive delayed first analysis without displacing newer evidence. Raw receipts replay with
  the archived manifest/current artifact and no send even after expiry/catalog removal; final
  results publish without configuration. Unknown acceptance retains liability; zero-attempt
  expiry refunds under the org lock without a key/artifact. All22 migrations are local only.
- Native jobs publish ClaimObservation without a CallSummary or financial mutation. Missing
  admission/configuration and persistence failures remain retryable; durable rejected/unknown
  outcomes ACK only after review marker/audit commit. A provider-selection race now throws
  instead of incorrectly acknowledging native work from a stale synthetic choice. Already
  published historical findings return their audited immutable receipt after transcript
  correction; new publication still verifies the source and stale review warnings remain.
- API/runtime status and recovery recognize native completion, preserve legacy evidence and
  audit safe status access. Owner/Admin delivery retry keeps generation1 and its frozen identity,
  including retrying failed persistence of review effects without another model request.
  Operations close requires exact audited publication/review; a late raw response invalidates
  an earlier review-only close snapshot. The call-detail panel has bounded visible polling,
  owner retry, explicit refresh and a findings link; claim findings have scoped refresh.
- Browser checks use actual CSS/fonts with mocked auth/API at 1280/390; no overflow/page errors,
  full source hashes wrap, 44px controls and retry-to-published/refresh flow verified. Screenshots:
  `/private/tmp/dentabill-observation-visual-WE4K6l/analysis-1280.png` and `analysis-390.png`.
  This is component evidence, not deployed Clerk-to-provider validation.

**Verification:** database **164/11 files**, API **463/33**, queue **81/6**, SDK **30/2** and
call-worker recovery/outbox **47/2** pass. The final API settlement change also passes calls/native
**73/2**, with native **8/1** repeated after type/lint correction. The summary-worker broad run
passed **123/124**; its sole failure was an outdated provider-disabled expectation, corrected to
the intentional retryable busy outcome. The affected handler file then passed **32/32**, covering
all 124 worker cases across the broad run and affected rerun. This includes 18 automatic-handler
tests and 11 native process cases, with two new automatic-job SIGKILL/restart proofs: one saved
response publishes once; uncertain acceptance retains liability/review without a second send.
UI checks passed **61/3**, then the final status component **21/21** after recovery wording and
role regressions. An initial API run exposed an outdated fresh-generation fixture ID; it was
corrected to canonical `.g1`, retaining historical null-snapshot bindings. After lint-only
corrections, the native handler passes **18/18** again and shared typecheck/lint passes
**30/30** with concurrency 2. Both Lambda packages build: API **35.6 MB / 10.7 MB zip**,
worker **28.7 MB / 9.4 MB zip**. Checks were serialized to respect local memory limits.

**Exact next task:** release evaluation infrastructure (FW-15/16): versioned annotation/evaluation
inputs, deterministic reports and evidence-bound approval artifacts, followed by authorized
synthetic provider contract probes. Do not approve a production model from fixture success;
domain-adjudicated quality and applicable provider contract/region/retention/spend evidence
remain missing. FW-39 monitoring, FW-40 notification outbox, voice and supported connectors
remain open. Defaults stay synthetic and checked-in model manifests remain CANDIDATE.

### Earlier continuation: FW-27 reviewed same-call regeneration

The parity goal remains active on `codex/w0-containment`; main `4497459` is incorporated.
The user asked how much remains: the local feature is one slice; automatic routing, evaluation,
voice and connectors still require substantial work. No clinic exists; use fake data only.
Fireworks/ElevenLabs keys were previously authenticated; Retell-managed Twilio needs no Telnyx
key. No new provider account action, actual generation, speech, call, production migration or
deployment ran. Preserve both pre-existing stashes.

- Migrations 20/21 add immutable Owner/Admin approvals bound to prior observation/run, current
  claim/source, next generation, reason/idempotency key and serialized release/artifact pins.
  Auth lasts 15 minutes. Native reserve and each attempt recheck current permission and evidence.
  Unknown work stays protected; zero-send recovery requires durable audited proof. Original
  results, reviews and usage remain intact. Same-call currentness follows generation rather
  than arrival, and pending newer work blocks stale review with NEWER_GENERATION.
- `createObservationRegenerationService` implements server previews, durable approval and
  explicit execution/resume. Exact keys replay their original authorization before checking
  changed current state. Final results publish without provider configuration. Raw evidence
  uses no-send replay with saved approved manifest/current artifact pin even after expiry.
  The gateway rechecks live release expiry after awaited admission. Saved 503s cannot retry
  in replay-only mode. An expired unused reservation can settle without a key.
- New scoped API preview/approve/resume routes audit evidence access and enforce a 30-second response
  budget with cancellation of future send permission. Late database authorization may commit;
  a real database-lock regression proves it cannot send after response timeout. SDK matches.
- UI exposes exact source/release/token allowance, requires a reason, retains frozen key/body
  after ambiguous failure and uses explicit saved-request lookup/resume. A new approval requires
  another explicit action and fresh preview. Browser 1280/390 checks used actual styles/fonts,
  mocked auth/API, no external requests, no overflow or page errors. Screenshots remain in
  `/private/tmp/dentabill-observation-visual-WE4K6l/regeneration-1280.png` and
  `regeneration-390.png`; temporary server stopped.
- Automatic native job selection remains disabled, model manifests CANDIDATE, legacy jobs
  synthetic. Adding credentials/artifact pin cannot activate inference. No legacy summary,
  financial state or external action is changed. See ADR-067 and DEPLOY_AWS.md.

**Verification:** database **146/11 files**, summary-worker **103/10**, API **456/32**,
model gateway **302/7**, SDK **27/2** pass. Web full suite passed **417/419**; two unchanged
5-second tests timed out during local memory exhaustion, then both affected files passed
**31/31** in an isolated single-worker rerun. New UI tests **18/18** also pass; browser checks
are component-level with mocked auth/API, not deployed Clerk-to-provider evidence. The full
worker run includes all nine process crash cases and seven regeneration service regressions.
Affected Turbo typecheck/lint passes **30/30** with concurrency 2. Final gateway test/type/lint
checks cover the last journal-method delegation change. Both Lambda packages build: API 35.5 MB / 10.7 MB zip and worker 28.4 MB / 9.3 MB zip.

Initial overlapping broad checks exhausted local memory; stopped the owned Turbo process,
then serialized/throttled checks. No user apps, containers, global settings or unrelated processes
were changed. All 21 migrations remain local only. Fresh fetch confirms zero commits behind
main `4497459`. Existing stashes remain intact. No production deploy or external inference ran.

**Exact next task:** add approved-release native generation 1 job routing with durable job identity
and failure/resume semantics, then release evaluation/approval. FW-40 notification outbox,
FW-39 operations/monitoring, provider spend/retention/region evidence, ElevenLabs integration
and supported connectors remain open. This is local synthetic evidence, not full parity.

### Earlier continuation: FW-27 immutable findings and biller review

The parity goal remains active on `codex/w0-containment` with main `4497459` incorporated.
The user has no clinic and uses fake data. Existing Fireworks/ElevenLabs keys already passed
read-only authentication; Retell-managed Twilio still needs no Telnyx key. No provider account
request, model generation, speech, call, purchase, production migration or deployment ran.
Preserve both existing stashes. The user asked how much remained; current publication/review
is one local slice, while voice, workflow automation, evaluation/operations and real connectors
remain substantial work. Do not estimate overall completion from fixture counts.

- Migration19 adds tenant-scoped immutable `ClaimObservation` and `ClaimObservationReview`
  records. Publication freezes source/output/provenance and commits its audit plus inference
  APPLIED marker atomically. Provider usage survives failed publication and replay sends no
  new model request. Existing CallSummary and claim/financial state remain unchanged.
- `generateAndPublishObservation` / `publishStoredObservation` validate strict native results
  and source evidence. New inference requires one latest final CallEvent with raw text; source
  ID is `transcript.<eventId>` and version is SHA-256 of exact text. Replay checks the bound
  event. Publication repeats binding inside the transaction with a shared event lock. Older
  unbound receipts fail closed; provisional/missing/mismatched sources cannot be published.
- Publication versions preserve arrival history. Currentness follows original CallIntent
  creation chronology (Call creation for legacy rows), not reconciliation insertion time.
  This prevents a recovered older call from displacing newer evidence.
- Stored Owner/Admin/Billing Staff roles can acknowledge or dismiss a finding. Reviews bind
  its immutable digest and exact claim version; dismissal needs a note. Changed claims,
  superseded findings, newer calls and changed/missing final transcripts block new review.
  Exact duplicate actor/decision/note returns the historical receipt, including after later
  changes. An overlapping later source/call can linearize after a review and then appear stale.
- Scoped APIs list history, publish saved results and record reviews; generated SDK types
  match. Claim detail shows exact evidence excerpts/transcripts, release information, synthetic
  labeling independent of FIREWORKS provenance, unverified payer-reported amounts, and stale
  warnings even after prior review. Publication/review never requests inference or performs
  external/financial actions. Actor-attributed safe access audits precede GET and POST evidence
  responses, including duplicate receipts; audit failure withholds evidence. Auth scope changes
  clear cached findings and draft notes.
- Independent review caught recovered-call ordering, missing event binding and hidden stale
  warnings. These are corrected; final-source correction also makes review stale. No legacy
  confidence, representative identity, verified payment or production model approval is invented.

**Verification:** full database **130/10 files**, summary-worker **95/9**, API **434/31**,
web **397/70** and SDK **23/2** pass. After the last isolated changes, API observation **20/20**,
web observation/detail **18/18** and worker publication **8/8** pass; the broad API/web suites
preceded the final POST-access-audit and transcript-warning/hash-display edits respectively.
Separate native/synthetic process recovery proofs are included in the summary-worker suite.
Affected Turbo typecheck/lint passes **30/30**. All 19 migrations are applied only to localhost
identity/runtime/summary/process databases.
Both Lambda packages build (API35.1MB/10.6MBzip; worker28.4MB/9.3MBzip).

Headless Chrome rendered the actual component/CSS/tokens/local Inter at 1280 and 390px,
with synthetic mocked auth/API and nonlocal requests blocked. Evidence expansion, note validation,
exact review payload, recorded state and stale history worked, with no page errors or overflow.
The final mobile check uses the real 64-character source-version shape: abbreviated excerpt
label, full wrapping hash in details. This is component verification, not live Clerk/API E2E.
Screenshots: `/private/tmp/dentabill-observation-visual-WE4K6l/final-1280.png` and
`/private/tmp/dentabill-observation-visual-WE4K6l/hash-390.png`. Temporary server stopped.

**Exact next task:** finish FW-27 with explicitly authorized same-call replacement generations,
protected original receipts and deterministic publication supersession; then automatic native
job routing once a release is approved. FW-40 notification outbox, FW-39 operational monitoring,
provider spend/retention/region evidence, model evaluation/approval, ElevenLabs voice integration
and real connectors remain open. Current production jobs remain synthetic. This local review
slice does not complete FW-27 or establish live quality/full Lunabill parity. See ADR-066.

### Earlier continuation: FW-41 durable native Fireworks attempts

The parity goal remains active on `codex/w0-containment`. A fresh fetch confirms zero commits
behind main `4497459`; the AWS backend baseline is incorporated. Fireworks/ElevenLabs keys
already passed basic read-only authentication and Retell remains configured. Retell-managed
Twilio needs no Telnyx key. No new private account request, paid inference, speech, call, purchase,
production migration or deployment ran. The user has no clinic; all fixtures use fake data.
Preserve both pre-existing stashes.

- The native gateway now requires an awaited journal before any HTTP send. The worker exports
  `createDurableObservationGateway`, binding a scoped terminal call, claim/source versions,
  request/wire/release hashes, attempt cap and original send deadline to the database. It is
  an explicit adapter, not a new production job/runtime selector. Both live releases remain
  unapproved and the existing summary handler remains synthetic.
- Migrations16–18 add per-attempt billing day, raw response and completion evidence/history.
  Every retry needs a committed prior error response/interpretation and another full budget
  allocation. Unknown prior usage remains reserved across days, even after a later success;
  contradictory usage rejects output and cannot release liability using a false zero. These
  operational token allocations are not provider-certified dollar ceilings.
- Complete bounded success responses are stored before JSON/model/finish/usage/semantic
  validation. Non-success response bodies are discarded; status/retry delay are saved.
  Raw evidence survives failed final-result audit, and later owners validate it without another
  provider request, even after the original send deadline. Unknown acceptance without a saved
  response cannot authorize a retry. Partial/oversized bodies that never become durable raw
  receipts conservatively remain unknown; they cannot create recovery sends.
- Native fetch rechecks cancellation/deadline after database admission. Interrupted parsing
  may later refine an unknown-usage completion from saved evidence once, retaining history.
  A definite parsed interpretation and known usage survive later caller cancellation unchanged.
  Completion identity excludes nondeterministic replay timing; cache reads do not create a
  send lease. Expired zero-attempt reservations refund exactly once when revisited under the org lock and
  invalidate old ownership; attempted/ambiguous requests are not refunded by expiry alone.
- Independent review corrected cancellation replay lockout, inconsistent-usage settlement,
  unsent-expiry leakage and known-usage interruption. Real native HTTP also exposed fractional
  timing storage and cached-read lease issues. Local processes scrub provider credentials,
  use a localhost provider with fsynced acceptance records, and SIGKILL at reservation,
  raw-response commit and second admission. Pending-admission cancellation uses a real blocked
  Postgres transaction, then releases it and proves no late HTTP.

**Verification:** full model-gateway **297/6 files**, database **111/9**, summary-worker
**87/8** and API **415/30** pass: **910 tests** in these affected packages. Summary includes
8 native process proofs plus the 3 earlier synthetic summary process proofs. The native
process suite also passed independently on its dedicated database. Affected Turbo type/lint
passes **24/24**, with gateway **4/4** repeated after the final interpretation fix. Both Lambda
packages build (API35.0MB/10.6MBzip; worker28.3MB/9.3MBzip). All 18 migrations are applied only
on isolated localhost identity/runtime/summary/process databases. The first full process run
exposed a too-short 1s fixture deadline under concurrent checks; fixtures now use 5s, wait for
actual original expiry and pass as a full suite. Production limit remains unchanged.

**Exact next task:** FW-27 versioned observations and summary replacement, preserving historical
source/release evidence and never inventing legacy confidence/representative fields. FW-40
notification outbox, source-access/review workflow, account spend/retention/region evidence,
model evaluation/approval, ElevenLabs configuration/streaming and real connectors remain open.
FW-41 local implementation/proof is complete; its checkbox awaits merge. No live quality,
provider compatibility or full Lunabill parity is established. See ADR-065 and DEPLOY_AWS.md.

### Earlier continuation: FW-26 durable synthetic inference and receipt recovery

The active parity goal continues on `codex/w0-containment`, with latest main `4497459`
incorporated. Both added provider keys already passed read-only authentication; no new account
requests, model inference, speech, call, purchase or production action ran in this continuation.
The user has no clinic and uses fake data. Retell-managed Twilio remains the existing carrier;
no Telnyx credential is needed. Preserve the two pre-existing stashes.

- Additive migrations fourteen/fifteen create org-scoped budgets, immutable generation 1 request
  snapshots, one durable attempt per run and a review-application marker. They were applied
  only to isolated localhost identity/runtime/process/summary databases. No historical provider
  usage or acceptance is fabricated. Same-day legacy usage is imported once as baseline.
- Organization locks serialize admission and accounting. RESERVED can be reclaimed after
  expiry; submitted requests never become sendable again. Ambiguous acceptance retains its
  reservation across UTC days. A late receipt from the original owner can settle evidence.
  Bigint usage includes invalid output/overruns and commits independently of summary effects;
  `summaryTokensUsed` is a bounded compatibility display. Operational token allocations are
  not provider-certified token or dollar ceilings.
- The summary handler accepts only the fixed synthetic descriptor, preserves original
  claim/source/version evidence and stores the receipt before summary/state/audit application.
  A saved response resumes without inference. Rejected/unknown review effects also resume
  atomically, with a marker required before review acknowledgement. Independent review fixed
  lost rejection effects, stale-config allocation checks, stored provider mismatch and lock
  ordering. Legacy Redis cost guards no longer block recovery.
- Nonempty `ANTHROPIC_API_KEY` makes production factory creation fail closed. Explicit
  LiveClaude comparison fixtures remain with zero SDK retries and nullable usage. Neither
  Fireworks nor ElevenLabs keys activate live inference. Fireworks observations cannot be
  mapped into legacy confidence/representative fields by invention.
- Owner/Admin GET summary/status exposes safe scoped state; strict-empty POST retry preserves
  existing summaries, requires terminal calls and cannot start a replacement/ambiguous run.
  Runtime busy/unconfirmed failures remain SQS retries/redrive or inline503 after exhaustion.
  UNKNOWN/REJECTED acknowledgement requires the exact generation 1 run and committed review
  marker. General quarantined-summary recovery remains `SUMMARY_RETRY_UNSAFE` pending its
  separate authorization/recovery proof. SDK schemas are regenerated.

**Verification:** full API **415/30 files**, database **94/8**, summary worker **64/6**
(including three process proofs), summarizer **84**, queue **79/6**, types **36/5** and SDK
**19/2** pass: **791 tests** across these affected packages.
Affected typecheck/lint **24/24** and Lambda packaging pass (API35.0MB/10.6MBzip;
worker28.3MB/9.3MBzip). Final API typecheck/lint also passes after the lock-order regression.
A fresh fetch confirms zero commits behind main `4497459`. Separate-process
fixtures scrub credentials and use a localhost HTTP provider with fsynced synthetic receipts.
SIGKILL before send permits one first request; after provider acceptance it never resubmits;
a saved response survives application failure and applies without another request. No external
provider compatibility, quality or production readiness follows from these tests.

**Exact next tasks:** FW-41 awaited admission and receipt hooks for every Fireworks HTTP attempt,
then FW-27 versioned observation/summary integration that preserves source/release evidence.
The gateway's current void progress callback is best effort and cannot journal admission.
FW-40 now explicitly owns the still-missing durable notification outbox; current post-commit
notification can be lost. Model approval, account spend/retention/region evidence, ElevenLabs
configuration, qualified dental evaluations, real connectors and full parity remain open.
See ADR-064 and DEPLOY_AWS.md; no production rollout was authorized or performed.

### Earlier continuation: FW-10–13 release-gated Fireworks text gateway

The full parity goal remains active. Latest main `4497459` (the AWS PR merge) is now
incorporated; AWS content was already present, so this merge changed no application files.
The user added `FIREWORKS_API_KEY` and `ELEVENLABS_API_KEY` to root `.env`. Presence-only
checks confirm those and the existing Retell key in root/API/web configuration, without
printing values or finding duplicate definitions. Read-only authentication now succeeds for both providers (HTTP200); account limits, inference/agent
permissions and contractual suitability remain unverified. Telnyx is unnecessary for Retell-managed Twilio.
`.env.example` now includes the new names and corrects the historical carrier comments.
Only two bounded read-only provider requests ran: Fireworks accounts and ElevenLabs user.
No inference, speech, purchase, call, deployment, production migration or account change ran.
The user has no clinic; development remains synthetic. Preserve the existing stashes.

- New leaf package `@dentabill/model-gateway` implements one versioned claim-observation
  port, explicit synthetic adapter and native-fetch Fireworks transport. It is not yet wired
  into summary workers or the voice path. There is no API-key activation, default live model,
  implicit fake, repair prompt or fallback to another model/provider.
- Reviewed server manifests bind exact fixed US endpoint/regional route, observed response
  model IDs, organization/workload scope, prompt/schema/validator-rule hashes, application
  artifact hash, limits, publisher/license/serving/region/retention/price evidence references,
  review expiry and evaluation/run authorization. The policy digest invalidates changed scope
  or limits. Both checked-in candidates remain unapproved. Evidence references and the
  deployment artifact hash are trusted operator records, not automatic vendor attestation.
- Strict schemas require echoed claim/version and exact versioned source spans. Local rules
  enforce tenant/source consistency, UTF-16 offsets, integer USD amounts within billed value,
  lexical currency/amount/code consistency, explicit code nomenclature or UNKNOWN, and strict
  abstention/review-only actions. Anchors and lexical checks cannot prove payer attribution,
  applicability, clinical correctness, payment or truth. Mixed adjudication, overpayments,
  unsupported amount notation and missing/conflicting evidence require human review.
- Transport fixes the host/path, refuses redirects, builds only allowlisted JSON fields and
  isolates prompt caches by an opaque tenant/release hash. Limits are 128KiB request, 1MiB
  response, depth32, 4096 output tokens, 30s including body/parse/validation/backoff, and two
  attempts maximum. Only explicit 429/500/502/503/504 may retry once; network ambiguity,
  cancellation, invalid output, auth/payment failures do not. Retry-After cannot extend the
  deadline. Provider model identity, one completed assistant choice, UTF-8 and output shape
  are checked; reasoning/tool payloads never become observations.
- Usage missing from any attempt stays unknown. Safe progress snapshots preserve completed
  and active attempts if gateway cancellation wins the race against transport cleanup.
  Review reproduced and fixed a two-send cancellation that previously lost attempt history;
  currency review also found and tightened foreign-currency ambiguity. No raw provider body,
  exception, key, prompt or output is emitted by gateway diagnostics. Returned observations
  are sensitive evidence and must not be logged by future callers.

**Verification:** model-gateway **274 tests / 5 files** pass, including four real localhost
HTTP/socket tests. Scoped typecheck/lint/build and the complete focused Turbo run pass **7/7**
tasks. No authenticated inference or accuracy claim is made. These tests establish our
boundary behavior only. The operations UI fixture now correctly models 10→13 attempts after
three additional deliveries; its 13 tests pass. Existing API/worker behavior is unchanged.

**Limits and exact next task:** implement FW-26 durable inference ownership/reservations and
attempt/usage accounting before wiring this adapter into retrying workers or enabling summary
recovery. FW-27 must preserve historical summaries/source versions during replacement. Basic read-only authentication is now confirmed (details
in PROVIDER_EVIDENCE.md). Continue permitted-model/agent, spend-limit, residency/retention and
ElevenLabs configuration inventory before proposing a capped synthetic run. No model is approved and no streaming/tool/voice compatibility,
dental quality, real connector, payment reconciliation or full Lunabill parity is established.
See ADR-063 and FIREWORKS_GATEWAY_CONTRACT.md for the precise boundary.

### Earlier continuation: FW-37 scoped operations and audited recovery

The full parity goal remains active. Retell key presence was rechecked without displaying
values: root `.env`, API `.env` and web `.env.local` share the configured `RETELL_API_KEY`.
Fireworks/ElevenLabs remain empty or absent; Telnyx is not required for the existing
Retell-managed Twilio setup. The user has no clinic and authorizes fake data. Fresh fetch
confirms latest main `55a1896` is already incorporated, alongside AWS baseline `23cdc7b`.
No external provider call, account change, purchase, deployment, production migration or
recovery-schedule activation occurred. Preserve the existing stash.

- Additive migration thirteen (`20261013150000_job_recovery`) adds delivery attempt allowance,
  recovery generation and separate CLOSED/closedAt disposition. Applied only to isolated
  localhost identity/runtime/process/summary/receipts databases; Prisma generated. Existing
  attempts remain monotonic. An exhausted valid READY delivery may receive exactly three
  additional attempts after an Owner/Admin reviews its current snapshot. Early quarantine,
  active leases, changed claim/version, invalid canonical binding, submitted or accepted calls
  cannot be reset. Summary replay remains blocked until FW-26 proves inference ownership/spend.
- `job-recovery.ts` checks the stored role, canonical payload/hash/key, scoped domain binding
  and queued claim version. Serializable approval uses row locks and compare-and-swap, with
  audit and allowance/close in one transaction. Duplicate or stale approval cannot grant twice.
  Source payloads, lease tokens and provider errors are never projected. Confirmed terminal/
  cancelled intent or an existing summary can close exact quarantine as no work needed;
  CLOSED never fabricates DELIVERED, completion or a payment.
- Retained BullMQ jobs use `outbox.<rowId>.recovery.<count>` as transport identity while the
  domain payload/key remain immutable. Current-generation DLQ checks reject delayed old
  failures. Independent review found that SQS/inline also need this provenance: it now survives
  a validated optional SQS envelope field/private authenticated inline header, Lambda attempt,
  runtime and DLQ. The runtime rechecks exact durable intent disposition before acknowledging
  failure handling. Unresolved READY/SUBMITTING no-ops remain SQS retry/inline503, preventing
  the older implementation's silent acknowledgement. Old consumers must drain before rollout.
- New scoped `/v1/operations` overview, cursor lists and preview/recover endpoints require the
  actual stored Owner/Admin role. Five-minute delivery age starts at due time, observation
  checks use a two-minute threshold; legacy missing commands are visible without fabricated
  history. Settings → Operations has organization-keyed queries, safe state copy, links to
  existing reconciliation/status controls and snapshot-bound explicit approval. Stale approval
  refreshes and requires a new decision. Counts do not establish scheduler/worker health.
- Refreshed primary Fireworks evidence in `FIREWORKS_GATEWAY_CONTRACT.md` identifies current
  regional routes, schema/retention/cache/retry limitations and proposed no-key gateway tests.
  No model is approved and no adapter/inference evidence is claimed. The short project brief
  now names AWS and Retell-managed Twilio; historical carrier assumptions are corrected.

**Verification:** full API **393 tests / 30 files**, worker **186/23**, database **77/7**,
queue **78/6**, SDK **19/2** pass. Full web **383/69** passed before the final semantic markup
correction; the **19** affected UI/tab tests passed after that correction and fixture cleanup.
Affected typecheck/lint **28/28** pass. Lambda packaging passes: API **38.7 MB / 11.3 MB zip**,
worker **32.0 MB / 10.0 MB zip**. Actual component renders at desktop1280/mobile390 and native
review dialogs have no page overflow; dialog axe checks found zero violations after one fix.
This is synthetic component browser evidence, not authenticated deployed E2E.

New PostgreSQL tests cover canonical binding, tenant/role isolation, stale/concurrent approval,
audit rollback, preserved commands, three-attempt exhaustion, early quarantine and separate
close semantics. Actual retained failed/completed Redis jobs prove transport generations.
Real DB triggers reject pre-submission writes in the actual SQS/inline runtimes: a stale
failure cannot cancel newer work or be ACKed, while current-generation failure commits one
cancellation without any provider create. Independent review raised and then verified the
cross-transport fix. No authenticated provider calls or AWS service requests were used.

**Limits:** no deployed operations/recovery/alert evidence, no service heartbeat, no external
notifications and no inference-spend-safe summary replay. Delivered-but-unconsumed READY
monitoring and transport redrive operations remain FW-39; pending inbox operations are FW-33.
SQL/application error paths beyond existing allowlists and full PHI lifecycle remain gates.
No clinic/domain-adjudicated quality evidence or complete Lunabill parity is established.
See ADR-062 and the matching rollout/rollback instructions in DEPLOY_AWS.md.

**Exact next task:** implement FW-10–13 as a bounded typed Fireworks text gateway and synthetic
adapter tests using the refreshed contract: server-owned exact release/host policy, structural
and semantic output validation, no hidden fallback, bounded retries/deadlines/cancellation,
and redacted failure/usage envelopes. Keep all models unapproved until account/license/revision/
region/retention and dental evaluation gates are evidenced. Then durable inference-attempt
ownership/usage (FW-26) can unlock safe summary recovery. Continue independent work without
reasking for the already-known missing credentials or clinic.

### Earlier continuation: FW-36 bounded accepted-call monitoring and FW-38 safe diagnostics

The full parity goal remains active. Retell already has a local API key; current carrier is
Retell-managed Twilio, so Telnyx is not required. Fireworks/ElevenLabs credentials remain
absent/empty; testing uses fake data as directed. A fresh fetch confirms main `55a1896` and
AWS branch `23cdc7b` are still incorporated. No provider calls, deployment, schedule activation,
production migration, account change or increased spend occurred.

- Additive migration twelve (`20261013140000_call_observation`) persists call deadline,
  next check, observer lease/attempts/review state and distinct Stop request/attempt/ACK/
  confirmation fields. Applied only to localhost identity/runtime/process/summary/receipts
  test databases; Prisma generated. Initial submission freezes cap/deadline before network.
  Retell per-call max duration override accepts 60000–7200000; existing request hashes remain
  compatible because the optional field is appended. Code default 900000, example1800000.
- New `call-observer.ts` replaces the indefinite handler wait with lease-fenced bounded steps.
  Historical deadline backfill uses submission/creation, never the current worker time.
  Initial accepted due time includes a thirty-second first-subscriber grace. A sixty-second
  lease protects source/event/finalization writes; explicit demo windows extend the lease.
  Known-ID Get Call revalidates exact saved identity, bounded to ten seconds. Actual terminal
  source, conditional claim transition, audit and one summary outbox commit atomically.
  Newer biller edits survive; stale owners cannot overwrite the final call or summary.
- Cancellation/duration expiry persists Stop attempts before sending. Same-ID retries are
  spaced sixty seconds, at most three; confirmation expires five minutes after first request.
  ACKs remain nonterminal. Exhaustion surfaces review without invented endedAt/transcript/
  summary. After confirmation expiry automatic remote reads stop; DB-source checks continue.
  Fresh no-key FakeRetell cannot acknowledge a persisted live call. Same-process known Fake/
  DemoAutopilot can complete or stop their own scenario; restarted demo memory is not evidence.
- Trusted Lambda/private-route/BullMQ recovery runs outbox and accepted-call scans independently.
  Five-row/twenty-five-second limits and NULLS FIRST avoid skipping legacy missing timers.
  The existing AWS rule stays disabled. Inline receipts require exact ACCEPTED call binding
  plus persisted deadline/due state, or matching terminal disposition. RESCHEDULED is distinct
  from completion. Scheduled observation constructs no summarizer/cost guard.
- Call detail/list expose only safe monitoring dates/codes. Manual Owner/Admin status lookup
  retrieves the existing call read-only after automated confirmation expires; it cannot redial
  or Stop. Role/tenant/payload/cooldown checks and an audited reservation protect this action.
- FW-38 replaces raw Prisma diagnostic event logging with a closed target/timestamp projection.
  Error/warn/info callback tests include an actual SQL failure with synthetic private input.
  Thrown errors elsewhere and complete PHI lifecycle controls remain separate gates.

**Verification:** full API **379 tests / 29 files**, full worker **157/22**, database
**77/7**, provider **268/13**, queue **66/5**, SDK **19/2**, and targeted web calls
**101** tests pass. Affected typecheck/lint passed **28/28** tasks; final fixture fixes also
passed scoped lint/API types. Lambda builds pass: API **38.6 MB / 11.2 MB zip**, worker
**32.0 MB / 10.0 MB zip**. Actual component/Tailwind synthetic renderings at desktop1280
and mobile390 have no horizontal overflow; this is not authenticated end-to-end browser proof.
Independent review fixed legacy null-timer starvation and both recovery routes’ rate-limit
ordering (tenant keys now run after authentication). The full API suite also exposed two
outdated entrypoint mocks and one test-owned webhook receipt cleanup issue; these were
fixed and the complete suite rerun successfully. FW-38 is committed as `89eec8f`.
New local proof includes three separate-process observer crashes/races against a fsynced
synthetic provider ledger, exact one-create/summary assertions, Stop ACK nonterminal behavior,
retry exhaustion/manual later-source recovery, tenant isolation, missing provider safety,
legacy timer scheduling and finalization rollback. Existing SIGKILL recovery now checks
pre-expiry ownership, then advances an injected clock in a fresh process without clearing the
persisted lease. Demo scenarios/cancellation run through the actual adapter with compressed
injected scenario timers; this is not a ninety-second wall-time or deployed demonstration.

**Limits:** no real telephony/end-to-end AWS recovery evidence, no enabled production schedule,
no hold detector integration, no clinic or clinical/domain-adjudicated evaluation. Slow DB
queries are not preempted by network budgets. Stop cannot be exactly once across a lost ACK
or process pause; retries retain the same existing call ID. Summary spend/attempt ownership
is FW-26. Preserve the stash and additive evidence on rollback. See ADR-061 and DEPLOY_AWS.md.

**Exact next task:** FW-37 — safe operating visibility for aged delivery/observation work,
quarantine alerts and audited recovery controls; continue the Fireworks typed gateway and
synthetic evaluations independently of missing external credentials. Authorized deployment,
provider comparison, connectors and clinic evidence remain visibly unverified/blocked.

### Earlier continuation: FW-34 positive-only existing-call recovery

The goal remains active. This continuation implements and tests the manual recovery
vertical slice; no overall parity, deployed recovery or real-provider compatibility claim.
Fresh fetch confirms `origin/main` at `55a1896` and `origin/infra/aws` at `23cdc7b` are
already ancestors of this work branch. No merge/deploy was needed. A secret-safe name-only
`.env` check confirmed `RETELL_API_KEY` is set; Fireworks/ElevenLabs keys remain absent/empty.
User is correct that no Telnyx key was ever required: current telephony is Retell-managed
Twilio. Existing configured Retell handles the app's voice agent. Development continues with
fake data; no new provider requests, account changes or production actions occurred.

- Additive migration eleven, `20261013130000_call_reconciliation`, persists attempts,
  last checked result, cooldown and token-fenced lookup leases. Applied only to isolated
  localhost identity/runtime/process/summary/receipts databases; Prisma generated.
- A new read-only Retell port follows current v3 metadata/list and v2 detail contracts.
  It completes bounded enumeration or fails, checks identities, rejects duplicate/cyclic/
  incomplete results, caps bodies at 2 MiB, forbids redirects/retries and bounds each whole
  operation to ten seconds. Defaults: three pages, twenty candidates, ten per page.
  Provider detail yields normalized final source transcript only, excluding model analysis.
- Core validates the canonical saved request hash and exact intent/payer/agent/from/to/
  outbound-phone identity, then rechecks the fetched detail. Combined lookup is bounded to
  twenty-five seconds. Submission grace, cooldown and lease are sixty seconds. No-match,
  failure, malformed snapshot or multiple/conflicting matches preserve the submission fence;
  none authorizes redial, a new intent or a provider switch. Cross-tenant intent access and
  globally conflicting provider Call IDs cannot bind.
- A positive match commits Call/ACCEPTED binding, source terminal event when available,
  audit and resume outbox together. Get Call evidence records `source=retell_get_call` and
  retrieval time; it never creates a signed-webhook receipt or invents timing. It preserves
  reviewed Claim state. The resume key `call.resume.<intentId>` differs from the retained
  original queue key; strict resume intent/call identity and immutable fields permit only
  ACCEPTED observation or TERMINAL no-op, never provider creation. Inline receipts verify
  the same binding and require TERMINAL. SQS round-trip preserves the resume payload.
- Both original-create/recovery race orderings preserve one Call. A late original response
  reuses the exact recovered provider ID. Conversely, if original binding wins while lookup
  is running, the current unexpired lookup lease can atomically retain verified source,
  audit and resume against that exact bound Call. This prevents dropping the only terminal
  evidence when no webhook arrives. Stale owners cannot write through a newer lease.
- Scoped GET status projects safe fields only. Owner/Admin POST accepts an empty body and
  derives provider lookup from saved intent; staff can read status but cannot reconcile.
  Missing provider configuration returns explicit unavailable/503. SDK was regenerated.
  Claim detail offers Check existing call/View call and clear failure/cooldown feedback;
  compact reviewed-claim actions link to detail. Enqueue replay no longer fabricates IN_QUEUE.
  Mutation results are bound to the originating claim so navigation or late responses cannot
  show another claim's recovered-call link.

**Verification:** full API **345 tests / 28 files**, database **66/6**, provider package
**254/13** (including **58** new adapter cases), queue **66/5**, SDK **19/2** passed.
Core adds **29** real-Postgres cases covering source-to-resume-to-finalization, cooldown,
missing/conflicting identities, invalid snapshots, never-settling provider, lease races,
expiry, tenant isolation, provider-ID conflict, audit rollback and forged resume commands.
Two new process tests use actual create/read-only adapters against independent fsynced
synthetic provider/broker ledgers: kill submitter after provider acceptance, then recover in
a fresh process; additionally kill recovery after binding commit and before resume delivery.
Fresh relay/consumer complete with exactly one provider create and one summary obligation.
Two direct race tests cover both create-response commit orderings. Final full worker run
passed **132/17**; the final API recovery/receipt rerun passed **49/2**. Lambda packaging
passed: API **38.6 MB / 11.2 MB zip**, worker **32.0 MB / 10.0 MB zip**. API/UI agent verified **90** web tests,
API/web/SDK types/lint, and actual component/Tailwind desktop1280/mobile390 layouts with no
overflow; this was a synthetic component fixture, not authenticated full-browser end-to-end
validation. Root affected-package typecheck/lint passed across **28** tasks before the final
race adjustment; final worker lint and web typecheck/lint also passed after the fixes. Independent reviews found the late-source
race and cross-claim link risk; both were fixed with regressions.

**Limits:** a recovered nonterminal call can still wait indefinitely after a lost terminal
webhook. FW-34 starts only from UNKNOWN/SUBMITTING and is manual, not an account-wide sweep.
Observer/termination ownership, persisted deadlines, accepted-call detail reconciliation,
quarantine operations and deployed relay remain open. Slow DB queries are not preempted by
provider deadlines. Outbox DELIVERED remains transport receipt; summary inference/cost
ownership remains FW-26. General raw Prisma diagnostic logging is a separate PHI gate:
this core sanitizes its thrown errors, but the shared DB emitter still logs raw diagnostics.
No live clinical data has been used; audit/request/transcript lifecycle controls remain W8.
Do not deploy old workers alongside new recovery producers: their older schema can strip
resume fields and acknowledge without observation. See ADR-060 and DEPLOY_AWS.md rollout order.

**Exact next task:** FW-36 — persisted observer ownership, hard termination/reconciliation
deadlines and recovery of ACCEPTED calls after missing terminal delivery. Keep provider
terminal facts distinct from requested cancellation/timeout. Then FW-37 operating visibility
and audited quarantine review; continue Fireworks gateway work independently of missing keys.
No clinic exists yet; authorized connector/domain evidence remains blocked, while independent
implementation continues. Do not reset uncertain intents or remove the preserved safety stash.

### Earlier continuation: FW-35 durable delivery and FW-32 pending cancellation

The goal remains active. Implementation commit: `bd519a8` on `codex/w0-containment`.
This continuation made tested progress; no production deployment, schedule activation or external calls.
Main remains `55a1896`. Final ancestry checks found the additional AWS domain move
`23cdc7b` after the earlier fetch; it is now merged into this work branch, including
`usedentabill.xyz` / `api.usedentabill.xyz` defaults and diagrams. Terraform format passes
after the merge; no deployment occurred. Both remote branches are ancestors of HEAD. The existing Retell key/carrier answer is unchanged: Retell-managed Twilio;
Telnyx is not a current dependency. No new credential probe or key change occurred.

- Additive migration `20261013120000_job_outbox` creates tenant-scoped immutable queue
  commands, hash/key uniqueness, pending/delivered/quarantined states, availability and
  token-fenced leases. Only isolated localhost identity/runtime/process/summary/receipts
  databases were migrated; Prisma now has ten migrations.
- New call reservation commits claim/intent/audit/outbox together. HTTP202 confirms the
  saved request even if immediate transport delivery fails. Active retry retains the
  identical command/backoff; legacy READY requests can backfill their command. A redundant
  postcommit outbox write no longer makes a committed new reservation return500.
- Final call state/intent/audit and summary obligation commit atomically, even without an
  immediate dispatcher. A finalization/outbox failure rolls back and resumes from saved
  terminal evidence without redial. Summary retry locks the scoped terminal Call to
  serialize retry count, command and audit; transport failure leaves recoverable work.
- Relay validates hash/scope/command, leases with a unique token, persists attempts before
  dispatch, times out transport, backs off and quarantines poison/exhausted work. Losing
  an acknowledgement permits the same command to replay; stale owners cannot overwrite
  a newer lease. It processes at most 25 rows per 20-second work budget (not a hard DB-query
  timeout), default 5-second send bound/30-second lease and ten delivery attempts.
- BullMQ boot starts a nonoverlapping five-second sweep and drains it before closing queues.
  Awaiting queue/worker readiness fixes immediate-shutdown Redis rejection exposed by tests.
  The private AWS worker accepts only an exact fixed relay event or valid SQS envelope.
  Terraform prepares a scoped EventBridge rule, disabled by default; no schedule was enabled.
- Inline dispatch now awaits a matching HTTP200 completion receipt with bounded response/body
  timeout. HTTP202, lost responses and unconfirmed execution keep the outbox pending. Call
  receipts additionally verify the exact saved tenant command is TERMINAL/CANCELLED/UNKNOWN;
  concurrent READY/SUBMITTING/ACCEPTED short-circuits cannot prematurely acknowledge work.
  A secret-authenticated fixed-bound relay route is available; external recurrence is not set up.
- Cancellation atomically records only a request marker/event/audit plus version-conditional
  CALLING-claim review. It preserves provider terminal facts and newer reviewed claim state.
  The service stores the actual Clerk actor. SDK exposes cancelRequestedAt; detail/list UI
  show pending cancellation, disable duplicate requests and wait for provider confirmation.
  A delayed cancellation response cannot replace already cached terminal state.

**Final verification:** full API **325/27 files**, call-worker **99/14**, database **66/6**,
queue **65/5**, SDK **19/2**, and all call UI/library tests **73/8** passed. Worker coverage
includes eighteen leased-relay regressions and two new separate-process crash boundaries:
producer SIGKILL before first dispatch, and relay SIGKILL after an independent synthetic
broker fsyncs acceptance but before acknowledgement. Fresh relay sends the identical command;
two fresh consumers produce one independent synthetic provider acceptance. API includes real
Postgres transaction failure/replay/concurrency tests; cancellation service has 18 race/rollback
checks and route/UI tests cover both directions of terminal/cancellation races. DB testing
also exposed a test-module identity leak from the global Prisma cache; teardown now clears
its disconnected cache before the next isolated file, preserving strict error-class checks.
Affected typechecks/lints, SDK regeneration and Lambda packaging passed (API 38.5MB/11.2MB zip;
worker 31.9MB/10.0MB zip). Terraform fmt/backend-disabled validate passed using locked providers,
without plan/apply. Synthetic desktop/mobile cancellation layouts were checked with no overflow.
Independent review found premature inline receipts, a redundant postcommit write and wrong
actor identifier; all were fixed with regressions before this checkpoint.

**Limits:** DELIVERED is transport receipt, not completed work. A timeout can still produce a
late duplicate transport delivery; CallIntent protects dialing, but concurrent summary inference
and incurred-cost accounting remain FW-26. The inline path still needs recurrence and may
quarantine a long-running command whose receipt repeatedly times out. AWS scheduled recovery
and real Retell stopping remain unverified. No full parity claim: provider-ID reconciliation,
persisted observer/termination deadlines, operating alerts/quarantine review, source connectors,
financial ledger, approved Fireworks inference/evals and authorized clinic evidence remain open.
Existing missing historical commands are not reconstructed. Preserve evidence on rollback;
pre-intent workers are unsafe against unresolved submissions. See ADR-059/DEPLOY_AWS.md.

**Exact next task:** FW-34 — implement scoped ambiguous provider-ID reconciliation against
current Retell v3 metadata/list contracts, matching the stored request's exact agent/number
identity. Multiple matches require review; empty/incomplete lookup never authorizes redial.
Then FW-36 persisted observer ownership/termination/reconciliation deadlines and FW-37 outbox
operating controls. Continue synthetic Fireworks gateway work independently of missing keys.
The user has no clinic and authorized fake data; real connector/domain validation remains
blocked without a test partner/qualified reviewer, while independent implementation continues.

### Earlier continuation: FW-25 submission ownership and FW-31 streaming

The goal remains active. Implementation commit: `d77eb18`; AWS merge: `57608ad`.
This turn made tested implementation progress; neither complete parity nor full durable
recovery is claimed. User clarified the existing key is Retell:
local Retell access and Retell-managed Twilio were already verified. Telnyx is not an
existing dependency and no Telnyx key is required for the current integration. A fresh
name-only local inventory confirms Retell is nonempty; Fireworks, ElevenLabs and Telnyx
are empty/absent. No keys were printed or changed, and this inventory did not reauthenticate.

- Fetched `main` and `infra/aws` again. Main remains `55a1896`; incorporated new AWS
  certificate-default commit `c34e970` by normal merge, preserving all W0 work. No deployment.
- API reserves `CallIntent`, exact queued claim version and audit in one transaction.
  Concurrent requests reuse the active intent. Delivery failure keeps the same reservation;
  API retry dispatches that same job key. One active intent per tenant/claim is a partial
  unique index. Composite foreign keys bind both Claim and accepted Call to its tenant.
- Worker requires the exact reserved job payload. It commits SUBMITTING, the exact outbound
  request/hash, claim CAS and audit before invoking the provider. A lost response is UNKNOWN;
  a crash leaves SUBMITTING. Neither state is reset or redialled. Known ACCEPTED calls resume
  from stored Call/provider identity, even if source identity has since been removed.
  Terminal intent/Call/conditional claim/audit commit atomically; duplicate finalization is
  a no-op. Both webhook and same-process persisted terminal evidence support restart.
- SDK create sends the opaque intent ID as documented body `idempotency_key` and correlation
  metadata, disables retries and uses a 30-second bound. Current Retell docs promise only a
  one-hour deduplication window, not permanent idempotency. No automatic retry depends on it.
  Removed practice/NPI metadata while retaining necessary dynamic agent variables.
- Inline/SQS/BullMQ use the same durable fence. Removed claim-status lease and `-rN` bypass.
  DLQ cancels only the exact READY reservation, with versioned claim CAS and audit together;
  it never marks an accepted/uncertain/provider call failed. Failed final DLQ persistence
  remains retryable. Hold-stop acknowledgement no longer automatically schedules a redial.
- SSE drains stable `(timestamp,id)` pages, catches up from Postgres in both Redis/noRedis
  modes and deduplicates IDs. Redis is only a wake-up hint. A valid persisted terminal
  provider event is required for closure; local cancellation alone cannot truncate transcript.

**Verification:** full API **257 tests/25 files**, call-worker **78/12**, payer-ivr
**196/12**, db **65/6**, queue **56/5**, SDK **19/2** passed. These include two worker
SIGKILL/restart tests with an independent synthetic provider process and fsynced acceptance
ledger: exactly one external acceptance after lost response and after known acceptance;
fresh workers do not redial. Accepted recovery preserves intervening manual review despite
missing current identity. Other regressions cover concurrent HTTP/job delivery, real audit
failure rollback, cross-tenant FK rejection, stale versions, prior-day reservations submitted
today, exact-intent DLQ, and terminal-event finalization retry. SSE's 13 regressions include
451 tied timestamps, commits behind the replay cursor and cancellation before final evidence.
Affected package types/lints, regenerated SDK contracts and Lambda packaging passed
(API38.4MB/11.2MB zip; worker30.5MB/9.8MB zip). Only isolated local DBs received the two
new migrations; no cloud migration, provider call, claim submission or production mutation.

**Explicit limitations:** missing provider IDs remain fenced for review, not automatically
reconciled. SUBMITTING can mean a live in-flight owner or a dead worker; persisted lease/
deadline logic and recovery operations are still required. There is no outbox relay yet:
crash before dispatch can leave READY work undispatched, and crash/failure after final commit
can lose summary fan-out. Inline dispatch can acknowledge before its background trigger runs.
HTTP Idempotency-Key replay beyond the active-intent lifetime is not implemented. Legacy jobs
without an intent fail closed and need reviewed migration/requeue. Request snapshots contain
PHI and need retention/access operating controls. SSE scans full history in bounded pages
and retains a per-connection ID set; total IO is not optimized. Cancellation CAS remains FW-32.
Provider/platform/clinic evidence remains blocked as recorded below; independent work remains.

**Exact next task:** FW-35 / FW-18 — transactional call + summary outbox, bounded leased relay,
crash-after-send replay, and actual recoverable scheduling within the existing AWS budget.
Then FW-34 (verified metadata/provider-ID reconciliation; empty lookup never permits redial)
and FW-36 (persisted observation/termination deadlines). Keep FW-32 cancellation atomicity
and the synthetic Fireworks gateway moving as independent tracks. Do not undo the no-redial
fence to make old jobs or test fixtures run.

### Earlier continuation: FW-07/FW-08/FW-28

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

**Next at that checkpoint (superseded above):** implement FW-25's durable call intent before any further live-path use:
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
