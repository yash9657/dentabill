# Session Context

_Last updated: 2026-10-13 (W0 implementation; AWS baseline reconciled)._

## Current session — W0 implementation on AWS baseline

### Latest continuation: FW-10–13 release-gated Fireworks text gateway

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
