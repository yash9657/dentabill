# DentaBill Deploy — AWS Lambda (API + SQS job worker)

**Decision record:** ADR-053 (job dispatch modes). **Branch:** `infra/aws`. Infrastructure (Terraform) is in `infra/aws/main.tf`; this page describes what the code expects from it and how the artifacts are built.

## Job dispatch modes

`JOB_DISPATCH_MODE` selects how `call.place` / `summary.generate` jobs reach their processors. Every producer (`POST /v1/claims/:id/calls`, `POST /v1/calls/:id/summary/retry`, the call handler's summary fan-out) goes through `JobDispatcher`, so all of them follow the mode.

| Mode               | Transport                                            | Consumer                                            | Use                         |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------- | --------------------------- |
| `bullmq` (default) | Redis (BullMQ queues)                                | always-on `call-worker` / `summary-worker`          | Docker / local dev          |
| `inline`           | self-POST to `/v1/internal/jobs/*` under `waitUntil` | the API function itself                             | Vercel (`DEPLOY_VERCEL.md`) |
| `sqs`              | one SQS **standard** queue (`JOBS_QUEUE_URL`)        | the worker Lambda (`apps/api/src/lambda-worker.ts`) | AWS                         |

In `sqs` mode the API never runs work after a response (Lambda freezes the process once the response completes). The `/v1/internal/jobs/*` routes stay registered but refuse every request unless `INTERNAL_JOB_SECRET` is set; leave it unset on AWS.

### SQS message format

Body: `{"type":"call.place"|"summary.generate","data":<job payload>}`, validated with the queue package's Zod schemas on both sides. Message attributes `jobType` and `idempotencyKey` mirror the routing fields (no PHI). The returned job id is always `data.idempotencyKey`.

### Delays

`DispatchOptions.delayMs` maps to SQS `DelaySeconds`, rounded up to whole seconds and **clamped to 900 s** (the SQS maximum); a clamp is logged as a warning. No current producer passes a delay; hold-stop acknowledgement no longer automatically dispatches another call. A new reviewed reservation is required after confirmed termination.

### Retries, duplicates and the DLQ

The worker runs **one attempt per receive**; the attempt number is `ApproximateReceiveCount`.

| Result of the attempt                                 | Worker action                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| success, duplicate, or fenced uncertainty             | message deleted                                                                                                                                                                                                                                                                           |
| failure, receive count < `JOBS_MAX_RECEIVE_COUNT` (3) | visibility timeout set to the BullMQ backoff (calls 30 s, 60 s; summaries 15 s, 30 s), returned in `batchItemFailures`                                                                                                                                                                    |
| failure on the final receive                          | calls: atomically cancel only exact READY intent and conditionally route claim to review; submitted/unknown calls stay protected. Failed persistence stays retryable. Summaries: remain batch failures/redrive; an exception is never acknowledged merely because attempts are exhausted. |
| unparseable body, or a crash outside the processor    | returned in `batchItemFailures` with no visibility change, and never deleted, so the redrive policy moves it to the SQS DLQ                                                                                                                                                               |

Call submission ownership is a persisted CallIntent, shared by all dispatch modes. API
reservation/claim version/audit commit before delivery; the worker commits SUBMITTING before
create and never redials SUBMITTING/UNKNOWN. ACCEPTED resumes the stored call. Legacy jobs
without an exact reservation fail closed. Summary jobs skip existing CallSummary records.
Summary generation 1 has a separate persisted reservation/attempt/receipt ledger. A busy owner
remains retryable. UNKNOWN/REJECTED is acknowledgeable only after scoped review effects and
`reviewAppliedAt` commit. A saved response resumes local application without another request.
No Redis lease governs summary inference ownership.
Queue exhaustion does not prove an external call failed.

The SQS DLQ still requires monitored recovery; messages may outlive the processor through
poison payloads, repeated crashes or persistence failure. Local FW-35/36 close the transactional
delivery gap and persist accepted-call observation/termination state. FW-34 adds manual positive
unknown-ID reconciliation. These changes remain undeployed; quarantine operations, authorized
external validation and verified recovery scheduling still gate real telephony.

### Coordinated call-intent release (not executed)

Apply additive migrations `20261013100000_call_intents` and
`20261013110000_call_intent_scope` before the new API/worker code. Pause new dispatch and
review/drain old queues/active provider calls during the coordinated rollout; old workers
ignore CallIntent and are unsafe alongside live new intents. Do not guess a legacy job's
provider acceptance or create replacement intents for ambiguous jobs. Backfill/requeue only
from reviewed evidence with an exact current claim version. The migrations preserve old
Call rows and do not invent historical intents.

Rollback stops dispatch and preserves all new tables/evidence, then reconciles existing
provider calls. Do not simply restore a worker that blindly reissues create. New request
snapshots contain PHI and require access/retention operating controls before real data use.
Only isolated local databases have received these migrations; production release still
requires the user's explicit authorization after remaining release gates are satisfied.

### Coordinated summary-ledger release (not executed)

Apply additive migrations `20261013160000_inference_accounting` and
`20261013170000_inference_review_application` before deploying the coordinated API/worker
artifacts. Pause dispatch and drain/review older consumers first: they ignore the ledger.
Preserve all snapshots, receipts, unknown liabilities and existing summaries on rollback;
restoring a worker that blindly resubmits is unsafe. These migrations have run only on
isolated localhost databases; this runbook is not deployment authorization.

New jobs default to `synthetic-summary.v1`; the local ADR-068 router can explicitly select
approved Fireworks findings. Existing runs retain their provider. Legacy Anthropic inference
remains disabled; its lazy factory cannot prevent recovery of a saved native result. A key
does not approve or select a model. Reviewed releases and authorized rollout remain required.
`SUMMARIZER_DAILY_TOKEN_BUDGET` is operational admission, not a verified dollar ceiling.
Unknown usage remains held across UTC days; legacy `summaryTokensUsed` is a display projection,
not the admission authority. ADR-079/FW-40 now implements the review-notification outbox locally;
local verification is recorded in ADR-079; coordinated rollout and external delivery remain open.

### Versioned observation release (not executed)

Apply additive migration `20261013210000_claim_observations` before the coordinated API/web
release. It adds scoped immutable findings/reviews and preserves all legacy summaries; no
historical model result is backfilled as validated evidence. Publication requires a saved
Fireworks receipt with an exact final CallEvent and text-hash binding. Unbound older receipts
fail closed. Only localhost identity/runtime/summary/process databases have this migration.

The new APIs publish saved results and record biller reviews without requesting inference,
changing claim status, confirming payments or sending messages. Native inference has unapproved
checked-in releases; the local automatic selector described below remains disabled by default.
Rollback retains the new tables, source snapshots and reviews; immutable records must
not be rewritten or deleted by old application code. No production release was authorized.

### Explicit regeneration release (not executed)

Apply additive `20261013220000_observation_regenerations` and
`20261013230000_regeneration_release_snapshot` before this API/worker/web version. The first
permits generation > 1 only through a scoped immutable approval; the second preserves the exact
serialized release manifest. Existing approvals without a valid snapshot fail closed. All 21
migrations are applied only to localhost identity/runtime/summary/process databases.

Owner/Admin preview/approve/resume endpoints execute bounded work synchronously, with no new
SQS/BullMQ job. At a 30-second API timeout or disconnect, a late DB authorization may still commit;
recover the saved request before any new approval. Every actual send retains the existing
journal, original deadline and independent token allocation. Unknown acceptance never resends.
Final/raw saved receipts recover locally; replay-only raw recovery needs the matching current
implementation artifact but no key or unexpired send authorization.

Optional API configuration: `FIREWORKS_API_KEY`,
`OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256` (64 lowercase hex characters), and
`SUMMARIZER_DAILY_TOKEN_BUDGET`. The checked-in model releases remain CANDIDATE; these variables
cannot approve a model or activate automatic production routing. An evaluated scoped manifest,
provider approvals and an explicitly authorized coordinated rollout are still required.
Rollback preserves approvals, findings, reviews and all known/unknown usage. No production
migration, deployment or real model request was performed for this slice.

### Automatic native job release (not executed; ADR-068)

Apply additive `20261014000000_native_release_snapshot` after migration21, then deploy matching
API/worker/web artifacts in a coordinated release. All22 migrations ran only on localhost
identity/runtime/summary/process databases. Preserve nullable historical snapshots; do not
invent approvals or rewrite old inference identities.

`SUMMARY_ANALYSIS_PROVIDER=SYNTHETIC` is the default. A future approved native deployment also
requires `SUMMARY_ANALYSIS_PROVIDER=FIREWORKS`, `OBSERVATION_RELEASE_ID`, `FIREWORKS_API_KEY`,
`OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256`, a reviewed scoped manifest and the existing token
budget. This code has no approved production manifest. New queued native work uses PROTECTED;
there is no environment switch to relabel real patient data synthetic. API/queue clients cannot
choose any of these controls. The shared handler is used by BullMQ and the inline/SQS runtime.

Changing the selector affects only calls with no stored generation1 run. Existing runs keep
their provider, request and release snapshot; this selector is not a kill switch for admitted
work. Withdraw the current release approval or live send configuration/artifact permission to prevent further sends, while
preserving receipts and accounting. Raw replay needs the saved approved manifest and matching
current artifact; final-result publication and proven-unsent/unknown settlement need no key.
No fallback creates another provider request or generation. Separate approved regeneration is
still required for replacement findings.

Validate through staging: native publication and claim-detail link; duplicate delivery; failed
publication with intact usage; process loss after saved raw response with no second send;
unknown acceptance retained for review; missing approval/budget left retryable through SQS
redrive; owner retry of failed review persistence without another send; scoped operations close.
Monitor durable work, not just broker
delivery receipts. Retain all new tables/evidence on rollback; old consumers cannot safely
interpret native completion. Production deployment and scheduler activation remain unperformed.

## Offline evaluation evidence (ADR-069; no deployment change)

`@dentabill/evals` is local tooling and is not imported by the API or workers. Use its
`seed`, `score` and `verify` commands from `packages/evals/README.md` to preserve and recompute
evaluation evidence before proposing a model release. Each packet binds the corpus, labels,
inventory, results, target policy/artifact and evaluator implementation; it never approves
production. The current 25-case seed is unadjudicated development data and the CLI baseline
does not call Fireworks. Model/voice selectors, AWS secrets and deployed artifacts are unchanged.
Authenticated captures, qualified review and the existing release/deployment gates still apply.

ADR-070 adds a separate local `capture prepare/inspect/run` workflow. It uses a private,
single-host filesystem journal and exact run budget/account/code bindings; it is not a Lambda
worker, distributed spending service or production release gate replacement. Keep private raw
capture files out of deployment bundles/version control. Discovery never supplies a usable
observation or approves a model. Existing API/worker selectors and AWS secrets are unchanged.

## Infrastructure expectations

| Item             | API function                                                                                           | Worker function                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Runtime / arch   | `nodejs22.x`, `x86_64`                                                                                 | `nodejs22.x`, `x86_64`                                                                                              |
| Package          | `apps/api/dist-lambda/api.zip`                                                                         | `apps/api/dist-lambda/worker.zip`                                                                                   |
| Handler          | `run.sh` + Lambda Web Adapter layer, `AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap`                          | `index.handler`                                                                                                     |
| Adapter settings | `AWS_LWA_PORT=8080`, `AWS_LWA_INVOKE_MODE=response_stream`, `AWS_LWA_READINESS_CHECK_PATH=/v1/healthz` | —                                                                                                                   |
| Trigger          | CloudFront → Function URL (`RESPONSE_STREAM`)                                                          | SQS, batch size 1, `ReportBatchItemFailures`                                                                        |
| Timeout          | 900 s (SSE streams are capped at 780 s and the client reconnects)                                      | 900 s                                                                                                               |
| IAM (SQS)        | `sqs:SendMessage`                                                                                      | `ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes`, `ChangeMessageVisibility`, `SendMessage` (summary fan-out) |

Queue: visibility timeout ≥ 900 s (AWS requires at least the function timeout), redrive to a DLQ with `maxReceiveCount` equal to the worker's `JOBS_MAX_RECEIVE_COUNT` (default 3). Use a small Prisma pool per instance in `DATABASE_URL` (e.g. `connection_limit=1`–`5`, plus `pgbouncer=true` behind a pooler).

`/v1/healthz` is liveness only. `/v1/readyz` also checks Postgres (and Redis if configured) and is meant for external monitoring.

## Environment variables

**API:** `NODE_ENV=production` (required), `DATABASE_URL` (required), `NEXT_PUBLIC_APP_URL` (required), `JOB_DISPATCH_MODE=sqs` (required), `JOBS_QUEUE_URL` (required), `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` (required: production refuses to boot without them), `DOB_HASH_SECRET` (required for production; generate a private value), `PORT` (optional, default 8080), plus the optional ones from `DEPLOY_VERCEL.md` (`API_CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`, `CLERK_WEBHOOK_SECRET`, `RETELL_API_KEY`, `DEMO_IGNORE_PAYER_HOURS`, `REDIS_URL`, `SSE_*`). `AWS_REGION` and `AWS_LAMBDA_FUNCTION_NAME` are set by Lambda.

**Retell verification:** `RETELL_WEBHOOK_SECRET` must contain the Retell dashboard
API key marked for webhooks, never a generated signing password. It has no
default; absent configuration disables inbound webhooks and still permits the
no-key demo. API startup requires it when `RETELL_API_KEY` is present. The
outbound key does not automatically qualify as the webhook-designated key.
For Terraform's existing Secrets Manager reference and migration from the old
random value, see [`infra/aws/README.md`](../infra/aws/README.md#retell-webhook-credential).

**Worker:** `NODE_ENV=production` (required), `DATABASE_URL` (required), `JOBS_QUEUE_URL` (required: summary fan-out and retry delays), `JOBS_MAX_RECEIVE_COUNT` (optional, default 3, must match the redrive policy), `REDIS_URL` (optional, for a shared summary cost guard; otherwise it is per instance), and the processor settings: `RETELL_API_KEY`, `RETELL_AGENT_ID_*`, `DEMO_AUTOPILOT`, `WORKER_OUTBOUND_NUMBER`, `MAX_CALL_DURATION_MS`, `MAX_HOLD_MS`, `ANTHROPIC_API_KEY`, `DEMO_SUMMARIZER_FALLBACK`, `SUMMARIZER_MAX_OUTPUT_TOKENS`, `SUMMARIZER_DAILY_TOKEN_BUDGET`, `SUMMARIZER_AUTO_TRANSITION_ENABLED`.

`NODE_ENV=production` matters for both functions beyond config: outside production the logger loads the `pino-pretty` transport, which is not shipped in the bundles.

## Build

```bash
pnpm install
pnpm --filter @dentabill/api build:lambda
```

`apps/api/scripts/build-lambda.mjs` regenerates the Prisma client, bundles `src/lambda-server.ts` and `src/lambda-worker.ts` with esbuild (ESM, node22; workspace TypeScript and npm deps, including `@aws-sdk/client-sqs` and `@anthropic-ai/sdk`, are inlined), and copies the Prisma client into a flat `node_modules/` keeping only the `rhel-openssl-3.0.x` engine. Output:

```
apps/api/dist-lambda/
  api/      index.mjs, index.mjs.map, run.sh (exec node index.mjs), node_modules/{@prisma,.prisma}/client
  worker/   index.mjs, index.mjs.map, node_modules/{@prisma,.prisma}/client
  api.zip   worker.zip
```

Everything is copied dereferenced (Lambda zips cannot hold symlinks). The build fails if a function exceeds 250 MB unzipped. Current sizes are about 38 MB / 11 MB zipped for the API and 30 MB / 10 MB for the worker. Set `NODE_OPTIONS=--enable-source-maps` to get TypeScript stack traces from the shipped source maps.

### Local smoke test

The bundles only carry the Linux engine, so run them in the Lambda base image (it is x86_64, emulated on Apple silicon):

```bash
# API: start the server, then hit the readiness route
docker run --rm --platform linux/amd64 -p 8080:8080 -v "$PWD/apps/api/dist-lambda/api:/var/task:ro" \
  -w /var/task --entrypoint /bin/sh --env-file <api env file> public.ecr.aws/lambda/nodejs:22 ./run.sh
curl localhost:8080/v1/healthz

# Worker: the image's runtime interface emulator serves invocations on :8080
docker run --rm --platform linux/amd64 -p 9000:8080 -v "$PWD/apps/api/dist-lambda/worker:/var/task:ro" \
  --env-file <worker env file> public.ecr.aws/lambda/nodejs:22 index.handler
curl -XPOST localhost:9000/2015-03-31/functions/function/invocations -d @sqs-event.json
```

## Known limitations

- The inspected deployed worker still runs the whole call inside one invocation. The local FW-36 release below replaces that wait with durable bounded observation, a provider duration cap and Stop confirmation state. Roll out the matching migrations/API/worker and verify the scheduler before real telephony. Hold detection remains unwired; a Lambda timeout or Stop ACK is never proof of a terminated call.
- SQS ignores BullMQ priority, so call jobs run in arrival order.

## W0 containment release validation (2026-10-13)

Current intended baseline is `infra/aws` through `23cdc7b` (usedentabill.xyz domain move); W0 changes are local on
`codex/w0-containment`, not deployed. See ADR-055/056 and `SESSION_CONTEXT.md`.

The reporting API contract removes legacy recovered-value fields. Deploy matching
API/SDK/frontend builds together after authorization; do not point the updated web
client at an older stats/report API. Verified payment data is explicitly unavailable.

Missing subscriber ID or NPI now blocks enqueue/dial and SQS acknowledges the blocked
job while preserving NEEDS_INFO. Source imports must supply actual identity; never
backfill it from claim number. Synthetic demo builders provide synthetic subscriber IDs.
Model-reported payment routes to review; old automatically resolved rows are not changed
by this code release and must not be treated as verified collections.

Local check commands (dedicated synthetic database required):

```bash
TEST_DATABASE_URL='postgresql://dentabill:dentabill@localhost:5432/dentabill_w0_finance?schema=public' pnpm --filter @dentabill/api test
TEST_DATABASE_URL='postgresql://dentabill:dentabill@localhost:5432/dentabill_w0_summary?schema=public' pnpm --filter @dentabill/summary-worker test
pnpm --filter @dentabill/api typecheck
pnpm --filter @dentabill/web typecheck
pnpm --filter @dentabill/api build:lambda
```

These tests include destructive cleanup of their local fixture tables: never configure
them with the production database. FW-07 adds migration `20261013090000_retell_inbox`. Apply it to the dedicated test
DB before running the suite, using an explicit localhost `DATABASE_URL` and
`pnpm --filter @dentabill/db exec prisma migrate deploy`. Never inherit a production URL.
The migration adds nullable receipt payload/hash, processed timestamp and tenant binding,
plus a pending-call index. Old markers are marked processed because their original payload
was never stored; do not claim it reconstructs historical dropped events.
A successful build does not prove deployment or external behavior. Require coordinated
preview/API browser checks before release, and retain prior artifacts for rollback.
The raw Retell envelope now has local synthetic HTTP/database/cross-process checks and
no expected-failure tests. Before an authorized deployment, review/apply the additive
migration, deploy matching API+worker+frontend artifacts, and supply only the existing
provider-designated signing key as described in `infra/aws/README.md`. The no-key AWS
demo configuration still starts; no key is generated or guessed. Keep provider keys
out of the worker until call intent/deadline/outbox and real-provider gates are met.
Provider credentials alone do not satisfy runtime, signer, duration, consent or agreement gates.

Retain prior code artifacts for rollback; the nullable additive DB columns may remain
in place. Do not roll back by dropping pending event evidence. An accepted unknown-call
event is durably pending, but operational unmatched-event reconciliation/retention and
age alerts are not implemented yet (FW-33). The row payload clears after successful
binding; its tenant-bound CallEvent follows the existing transcript lifecycle. Real
provider stop confirmation, actual AWS worker recovery and summary outbox remain unverified. Later FW-25 local worker-crash tests establish synthetic no-redial only.

## Transactional delivery and cancellation release gate (FW-35 / FW-32)

Local code adds `20261013120000_job_outbox` after the two CallIntent migrations. The subsequent FW-34 release also adds migration eleven (see below); all migrations
are required for the matching API/worker. Only dedicated local synthetic databases
have been migrated. Deploy coordinated API, worker and generated SDK/web builds after
explicit release authorization; the new call response includes nullable `cancelRequestedAt`.
Cancellation leaves provider status/end time intact until terminal evidence arrives.

Terraform prepares an EventBridge `rate(1 minute)` rule targeting the existing private worker
with exact input `{"type":"outbox.relay","version":1}`. `outbox_relay_schedule_enabled`
defaults to `false`. Enabling it is a separate release/configuration action with recurring
Lambda/database usage; no schedule has been enabled by this work. Lambda permission is
scoped to the rule ARN and source account. EventBridge retries are zero with a 60-second
age; Lambda's independent asynchronous retry behavior may still duplicate invocations.
The relay handles duplicates with DB leases, not assumptions about schedule delivery.
Current contracts: [target input](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_Target.html),
[resource policy](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-use-resource-based.html),
[retry policy](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_RetryPolicy.html),
[Lambda asynchronous retries](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html).

The trusted relay selects at most 25 eligible commands, uses 30-second leases, waits up to 5
seconds per transport receipt and stops starting work after a 20-second budget. Slow DB
operations are not forcibly interrupted. Attempts persist before dispatch; failures back off
from 1 second to a 300-second cap; ten attempts quarantine the row. No raw payload/error is
included in relay logs. Sweep counters are `selected`, `sent`, `failed`, `quarantined`.
Inspect tenant-scoped state/age without selecting payloads, for example:

```sql
SELECT "state", count(*), min("availableAt") AS oldest_available,
       max("deliveryAttempts") AS most_attempts
FROM "JobOutbox"
WHERE "organizationId" = '<authorized organization id>'
GROUP BY "state";
```

Pending eligible work should recover on a later sweep. DELIVERED proves transport receipt,
not business completion. QUARANTINED is not success: inspect its error code, intent state,
provider evidence and transport health before any reviewed replay. Do not reset UNKNOWN or
SUBMITTING call intents or manufacture a new job key to force a dial. Local scoped operations/review controls are implemented in FW-37 below; deployed alerts and
recovery evidence remain unverified. There is no automatic reset.
Existing READY intents from older code have no inferred outbox history; the API backfills an
identical command on a repeated request. Historical lost summary jobs are not reconstructed.

For local BullMQ development the call-worker starts a nonoverlapping five-second sweep and
drains it before closing queues. For retained inline deployments, authenticated
`POST /v1/internal/jobs/outbox/relay` accepts only an empty object and fixed server limits;
configure a trusted recurrence separately. No inline scheduler was provisioned. Long-running
inline calls may lose the bounded HTTP receipt and retry/quarantine despite eventual
completion; the intent fence prevents redial, and operator reconciliation remains necessary.
SQS is the intended AWS transport. Keep transport acceptance and terminal evidence distinct.

Before an authorized release: retain prior artifacts, apply reviewed additive migrations,
deploy matching code with the rule disabled, verify synthetic receipt/recovery and pending
cancellation through the actual API/worker, then enable and observe the scheduled sweep.
Do not roll back by dropping outbox/inbox/intent evidence or deploying pre-intent workers
against unresolved work. Local type/tests/build and backend-disabled Terraform validate
are not a deployed AWS recovery test.

## Existing-call recovery release gate (FW-34)

`20261013130000_call_reconciliation` is additive migration eleven. Only isolated localhost
synthetic databases have been migrated. No AWS migration, resource update or read-only Retell
account lookup ran in this slice. The existing `RETELL_API_KEY` configures the read-only
recovery client; current Retell-managed Twilio does not require `TELNYX_API_KEY`. Missing
Retell configuration produces an explicit unavailable state/503 rather than a fake recovery.

Claim detail reads `GET /v1/claims/:id/call-recovery`; an Owner/Admin can invoke
`POST /v1/call-intents/:id/reconcile` with an empty body. Tenant, provider ID, phone number,
timeouts and bounds cannot be supplied by the caller. The API derives them from the scoped
saved intent. Submission grace, per-intent cooldown and lookup lease are sixty seconds each;
combined provider lookup is bounded to twenty-five seconds (not a hard database query budget).
Audit records attempts and outcomes using opaque IDs only. Inspect scoped state without
request snapshots/transcripts; `reconcileOutcome`, `reconciledAt`, `reconcileAttempts` and
lease/cooldown timestamps explain the latest check. NO_MATCH and LOOKUP_FAILED are unresolved,
not non-acceptance; REVIEW_REQUIRED needs evidence review. Never reset to READY to force a call.

A positive match saves a `CALL_PLACE` outbox command with optional `resume:{intentId,callId}`
and distinct key `call.resume.<intentId>`. The new worker validates the exact binding and only
observes it. Retained original queue IDs cannot suppress this command. Delivery depends on
the existing outbox relay: an authorized AWS release must verify/enable that prepared schedule.
No schedule was activated here. The FW-36 worker/receipt release also accepts an exact ACCEPTED
binding only when its deadline and next observation are persisted; this is a monitoring obligation,
not terminal provider evidence. Lost receipts can still quarantine and require operating review.

Rollout order matters: apply reviewed additive migrations, deploy the matching worker and
allow old invocations to drain before exposing the new API/web recovery action. An older
worker strips the resume field and can acknowledge a command without observing its call.
Verify source-to-resume-to-terminal-to-summary behavior through the actual staged API, queue
and worker before authorized live usage. Retain the new worker/evidence semantics on rollback;
do not discard intents, source events or resume commands. Local two-process crash and both
create-response-race tests do not substitute for this deployed verification.

FW-36 now adds the local accepted-call observer described below. These recovery actions do
not enumerate the whole provider account or prove provider absence.

## Accepted-call observation release gate (FW-36 / FW-38)

Apply additive migration `20261013140000_call_observation` before this worker/API version.
Only isolated localhost synthetic databases were migrated during implementation. Deploy and
drain the matching workers before exposing status controls or accepting their durable-monitoring
receipts. Keep the existing EventBridge recovery rule disabled until the reviewed release and
an explicit activation approval. Its fixed `outbox.relay` event now runs delivery and observation
independently; the secret-authenticated internal recovery route does the same. No tenant, limit,
provider ID, or timeout override is accepted in that scheduled payload. BullMQ runs the same
recovery work every five seconds while its process is alive.

The worker no longer waits indefinitely for the complete live call. It returns after a bounded
observation window, with deadline/due state saved in Postgres. Each scheduled invocation checks
up to five due ACCEPTED rows, including legacy rows lacking timers, within a twenty-five-second
external-work budget (slow database calls are not preempted). Normal checks become due after thirty
seconds; actual execution depends on scheduler cadence, backlog and available budget. Leases are sixty seconds, extended for the explicit ninety-second fake demo
window. Unexpired ownership prevents duplicate observers. SQS completion means that this
monitoring obligation is durable; the recovery schedule must actually be operating for liveness.

`MAX_CALL_DURATION_MS` accepts 60000–7200000; its code default is 900000, while the example
configuration is 1800000. New submissions freeze the value in their request/deadline and send
Retell's per-call duration override. Legacy calls use their saved snapshot cap or 900000 anchored
to original submission/creation. Changing the environment does not extend existing deadlines.
Stop requests are limited to three, separated by at least sixty seconds, and confirmation ends
five minutes after the first request. An ACK is not termination. Thereafter automatic remote
checks cease, periodic DB-source checks continue, and an Owner/Admin can use Check call status
for a bounded read-only lookup. No manual action reuses the create endpoint.

Owner/Admin `POST /v1/calls/:id/check-status` accepts an empty body, derives the saved
provider ID, reserves a sixty-second cooldown and audits the attempt before a read-only
lookup. An unexpired observer lease also blocks the check. Missing configuration returns503;
cooldown/conflicting state returns409. The route never accepts provider IDs or Stop flags.

Call detail/list project safe monitoring dates and stable codes, never lease tokens, request
snapshots, provider error bodies, or transcripts in diagnostics. Inspect `observationReviewAt`,
`observationErrorCode`, `lastObservedAt`, `nextObservationAt`, and stop counters/timestamps when
triaging stalled calls. Missing provider configuration is explicit; no synthetic Stop ACK is
accepted for a persisted live call. Preserve the accepted intent and provider ID for review.
Do not reset it to READY, drop evidence, or install an old indefinite-wait consumer on rollback.

Before live enablement, verify through staged AWS that the schedule survives worker termination,
recovers a lost terminal webhook, respects leases/cooldowns and observes actual end confirmation.
Run only authorized calls to controlled destinations. Confirm the vendor duration override and
Stop behavior on that line; current tests use actual SDK transports against a loopback synthetic
provider, not a real telephone network. Hold limits remain unwired. Broader quarantine/age alerts
and tenant operating controls are FW-37. The Prisma event sink now logs only allowlisted target/
timestamp data, but this does not certify all application error paths or PHI lifecycle controls.

## Operations and delivery recovery release gate (FW-37)

Apply additive `20261013150000_job_recovery` before matching worker/API versions. It adds
`deliveryAttemptLimit` (default10), `recoveryCount` and `closedAt`, plus the `CLOSED` enum.
Drain old workers before exposing approvals: old code does not honor increased attempt
allowances or recovery transport generations. Do not downgrade consumers while approved
recovery remains outstanding. The migration was applied only to isolated localhost test DBs.

Settings → Operations is restricted to stored Owner/Admin roles. The overview shows pending,
five-minutes-past-due and quarantined delivery counts, overdue/review calls, uncertain submissions
and legacy READY intents without their original delivery command. Lists are tenant-scoped,
cursor-paginated and oldest-first. Dates/counts are saved-work evidence, not a deployed scheduler
heartbeat. `oldestPendingAt` is the oldest already-due available time; `oldestQuarantinedAt`
is the oldest request creation time, not the time quarantine began. No email/Slack alert is sent.

Review a quarantined delivery before approving its current snapshot. Retry grants exactly three
additional attempts only to an exhausted, valid READY command whose queued claim version is
unchanged. The command and domain identity remain fixed. Unknown/submitting calls link to the
existing read-only recovery flow; accepted calls link to Check call status. A conflicting update
returns409 and requires a fresh review. Closing verified no-work-needed delivery sets CLOSED
without marking it DELIVERED. Summary replay is blocked until FW-26 establishes durable spend
and execution ownership; do not work around that by manufacturing a new summary key.

Retained BullMQ jobs require a distinct transport generation for an approved recovery;
`outbox.<rowId>.recovery.<count>` leaves the domain payload/key unchanged. Stale delivery failure
notices cannot cancel newer approved work. SQS preserves the validated optional envelope
`transportJobId`; inline preserves it in `x-dentabill-transport-job-id` after shared-secret
authorization. The domain command and inline receipt key are unchanged. All consumers must
be upgraded and drained before approvals: old consumers strip this provenance. A failure
no-op with unresolved READY/SUBMITTING ownership is not durable completion and returns SQS
retry or inline503. Verify current-generation cancellation as well as rejection of stale
notices through each enabled transport. Further execution/heartbeat/DLQ observability and
deployed recovery proof remain required.

Before activation, verify this review/approval workflow with synthetic data through the actual
staged API, transport and worker, including a retained original failed job, stale approval,
delayed old failure notice and process loss. The existing AWS recovery rule remains disabled.
Keep source evidence, original command, attempt history and audit rows on rollback. This local
slice does not authorize production migration, scheduler activation or real payer calls.

## Fireworks text gateway rollout boundary (ADR-063/065)

`@dentabill/model-gateway` now has an explicit durable adapter exported by summary-worker,
plus scoped saved-result publication/review APIs and the explicit local ADR-068 runtime selector. Adding local `FIREWORKS_API_KEY` /
`ELEVENLABS_API_KEY` does not modify
AWS secrets or enable either provider. Both checked-in model releases are CANDIDATE. Existing
AWS demo/Retell configuration remains as deployed; Telnyx is not required for the current
Retell-managed Twilio numbers (the outbound number variable still has its legacy name).

FW-26/41 implement local reservations/attempt/usage accounting; FW-27 now includes versioned
findings, reviewed regeneration and automatic job integration. A trusted server caller must authorize and load evidence,
derive the organization/data class and exact claim version, load a reviewed scoped manifest,
provide the deployed implementation artifact SHA-256, and inject the server-only Fireworks key.
Do not accept manifest, artifact hash, data class or provider settings from an untrusted request.
Do not log gateway observations; they contain evidence. Preserve failed/ambiguous attempts and
unknown usage in accounting. Contract/rule hashes do not independently attest compiled code;
the future build/release pipeline must verify artifact identity against review.

Release review must bind current provider contracts, observed model identity, license/artifact/
serving revision, region/retention/PHI evidence, price snapshot, evaluation and run authorization.
The leaf library requires an awaited journal; the worker adapter supplies the org-scoped token
ledger. This is an operational allocation, not a provider-certified dollar ceiling. Source
access control and versioned workflow application remain the trusted caller's responsibility.
Native retries require committed error evidence and a second allocation; unknown prior usage
remains held. Original send deadlines survive process restarts, while saved responses may be
validated locally afterward. No response-retrieval or provider-idempotency guarantee is assumed.
Rollback disables the release/new inference and returns work to human review; it never selects
Claude/GPT or another provider automatically. Enabling or changing AWS provider settings remains
a separate reviewed production action. No such action occurred in this slice.

Before a future coordinated release, apply migrations `20261013180000_fireworks_attempt_journal`,
`20261013190000_fireworks_receipt_refinement` and `20261013200000_fireworks_error_refinement`
after the summary-ledger migrations. They ran only on isolated localhost test databases.
Drain old consumers, retain raw response and completion history, and preserve unknown liabilities
on rollback. A cancelled interpretation may be refined once from its already-saved response;
this cannot authorize a new send. On a later scoped reservation lookup, zero-attempt expired reservations refund only under the
organization lock after proving no attempt exists and invalidating old ownership. Requests
that may have reached the provider remain reserved. This runbook does not authorize deployment.

## Source-aware CSV import rollout (ADR-071; not deployed)

Migration23 `20261014010000_claim_source_identity` ran only on localhost. It retains legacy
claims and duplicates; it does not infer IDs, backfill or merge. Apply after the preceding
migrations before running the new API. Coordinate API and web deployment: the new endpoint
requires `x-import-source`, and the upload UI sends it. CORS must permit this header. Drain
or disable old import requests during rollout; older code writes unscoped legacy rows.
Rollback should disable imports rather than re-enable the prior race-prone importer. Keep
provenance/history intact; do not drop the new fields or rewrite imported identities.

Before production approval, validate migration time/index creation on a representative copy,
existing duplicate reports, authenticated browser upload/preflight, same-file and concurrent
re-upload, conflict reporting and no mutation of reviewed claims. Current evidence is local
Postgres plus synthetic browser/API data, not deployed AWS/Clerk/PMS operation. CSV database
names are operator-declared: retain the same name for repeated exports. Secret rotation or
namespace changes need reviewed reconciliation. No real PMS sync or payment posting is enabled.

## Procedure and coverage snapshots (ADR-072; not deployed)

Apply migration24 `20261014020000_claim_source_details` after migration23 and before this API
version. It adds three tables/checks/triggers without backfilling existing claims. It was applied
only to localhost `dentabill_test` and `dentabill_w0_identity`. Complete snapshots are written
within the importer’s existing transaction; deferred triggers reject incomplete child counts,
billed totals or coverage targets at commit. Keep these triggers when deploying/operating.

Coordinate API before the new web version: GET claim detail gains required nullable
`sourceDetails`; list/POST/PATCH responses remain shallow. Legacy claims legitimately have null
details. Old import workers must be drained/disabled, since they would ignore the JSON columns.
A legacy import that already fingerprinted unknown details will now conflict rather than silently
backfill. Rollback should disable new imports and preserve the tables/history; do not re-enable
older summary-only ingestion for these files or drop source evidence.

Before rollout approval, validate lock/transaction duration at representative upload sizes,
backup/restore with deferred and immutable triggers, the source namespace/secret stability,
real authenticated upload-to-detail viewing, practice-switch isolation, and reviewed amount
changes while imported facts stay fixed. Exact reimports retain child IDs. Current evidence uses
local synthetic data only. No financial posting, source synchronization or production approval
is implied. Future payment references must revisit the existing parent-claim cascade/retention
policy before treating line IDs as a permanent financial ledger.

## Remittance evidence and review (ADR-073; not deployed)

Migration25 `20261014030000_remittance_evidence` follows24. It ran only on localhost
`dentabill_test` and `dentabill_w0_identity`. It preserves legacy data without backfill and adds
restrictive financial references: claims with evidence, referenced users and source lines cannot
be deleted. Keep immutable/deferred triggers active. Test migration timing and restore on a
representative copy; ensure support and retention procedures account for these restrictions.
This migration does not establish a complete retention/erasure policy.

Deploy API before the new web screen. GET/POST claim remittances and GET preview/POST review
require stored owner/admin/billing roles. Stable source namespace/record IDs and the existing
DOB_HASH_SECRET are necessary for exact-replay fingerprints; rotating that secret requires
reviewed source reconciliation. No new vendor key, provider call, cash transfer or posting runs.
Request and canonical JSON are limited to1MiB; paged response content is limited to2MiB with
at most10 records (11 fetched), leaving Lambda proxy-envelope/escaping headroom below the
[6MiB synchronous response quota](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).
Clients must honor actual cursors even when a page is shorter than the requested limit.

Before production approval, test authenticated import/preview/review, concurrent reversals,
lost responses with the identical idempotency key, stale approvals, deletion retention, role
revocation, practice switching, response-size limits, audit privacy and backup/restore. Monitor
closed remittance failure codes and transaction latency, never raw source JSON or Prisma errors.
Rollback disables the new workflow/UI while preserving all evidence and reviews; do not drop
ledger tables or bypass constraints. Current tests are synthetic local evidence, not AWS end-to-end proof.

### Cash source evidence expansion (ADR-074; not deployed)

Migration27 `20261014050000_cash_source_token_bounds` follows26 and adds cash-only UTF-16,
ECMAScript trimming and Unicode category admission checks. Both migrations have run only on
localhost `dentabill_test` and `dentabill_w0_identity`; production rollout remains unapproved.
Apply27 before exposing the new cash API. It validates existing rows within one transaction;
incompatible retained tokens fail the migration without rewriting financial evidence. Investigate
any failure before retrying; do not bypass validation, rewrite applied26 or alter shared helpers.
Local final verification: cash DB76, tenant32, focusedAPI50, fullAPI702 and affected lint/types30
pass; API and both Lambda builds pass. See session context for exact logs and the synthetic
browser/build limitations.

Migration26 `20261014040000_cash_source_evidence` follows25. It creates three immutable cash-source
tables, scoped restrictive references, canonical/admission checks and a bounded identity-graph
helper; it does not modify historical claim/remittance amounts. Apply both migrations after the
existing chain and generate Prisma before building. Deploy API before the new web route. No
new provider key, bank credential, scheduler, payment action or paid API call is required.

Validate custom synthetic JSON from `apps/api/test/fixtures/cash-evidence`: review pending100,
posted90 revision, removed record (no synthetic debit), independent debit20 and explicit pending
replacement. Verify no duplicate on exact retry, stale preview409, audit failure rollback,
role/tenant separation and graph overlap blocks. Page responses can be shorter than requested;
follow cursor/hasMore. Accounts shown are those represented by the current transaction page,
with whole-account summaries.64KiB inputs and2MiB pages leave Lambda response headroom.

The dashboard is `/dashboard/cash-evidence`, with source history and unverified account totals.
Observe closed failure codes, query/lock latency and audit health without logging bank source
fields. Root/API imports and reviews serialize on the organization tuple; load-test this before
production scale. Roll back application exposure if needed while retaining the immutable tables.
Never drop financial evidence to roll back UI code. Real connectors, batch reconciliation,
PMS posting receipts, retention policy and authorized AWS end-to-end verification remain gates.

### Remittance batch evidence expansion (ADR-075; not deployed)

Migration28 `20261014060000_remittance_batch_evidence` follows27. It adds four immutable tables,
exact composite claim-evidence/review references, batch-only token helpers and organization
admission/sealing triggers. It leaves prior source data and helper definitions unchanged. Apply
the existing migration chain and regenerate Prisma before exposing the API/SDK/dashboard route
`/dashboard/remittance-batches`. No provider credential or external financial instruction is added.

Validate synthetic100+80 claim reports with deduction30 and net150, incomplete/unknown/unbalanced
blocks, accepted reversal members, duplicate member conflicts, exact retries, stale previews,
audit rollback and tenant/role isolation. Raw/canonical/JSONB256KiB,100 member/adjustment and
page2MiB/20-record limits provide bounded envelopes; clients must follow cursor/hasMore.
Monitor closed error codes, audit health and organization lock latency without logging payloads.
Retain immutable evidence if rolling back application exposure. One snapshot per source batch
was supported at this checkpoint; ADR-080 adds correction support below. Authenticated sources,
posting and production retention/restore evidence remain required. This migration has run only on localhost test DBs.

### Cash-to-batch reconciliation expansion (ADR-076; not deployed)

Migration29 `20261014170000_cash_batch_reconciliation` follows28, adding two immutable tables,
exact source/review references and bounded cash identity/capacity/ledger admission helpers.
Applied only to localhost `dentabill_test` and `dentabill_w0_identity`; prior data and helpers
are retained. Apply the complete migration chain and regenerate Prisma before exposing
`/dashboard/cash-reconciliations`. No credential or external financial instruction is added.

Validate signed partial many-to-many matches, net150 from180−30, stale/replaced source reservations,
explicit full release/rematch, exact retries, stale amount/source/ledger previews, audit rollback,
role/tenant isolation and concurrent capacity races. Releases must remain available even when
source validity or graph traversal fails. Mutation receipts are immutable; list status is dynamic.
Bodies4KiB and pages20/2MiB leave response headroom. Monitor closed failure codes, audit health and
organization lock/query latency without source values. Roll back application exposure while
retaining immutable financial history. No bank verification, claim cash allocation, external
posting or settlement is asserted; authenticated connectors, retention/restore and AWS end-to-end
operation remain gates.

### Tenant limiter hook correction (ADR-077; not deployed)

No migration or environment change. Call enqueue and practice-settings route overrides must
run their10/minute organization limiter at `preHandler`, after `requireAuth`. Validate401 for
anonymous traffic,429 after ten practice requests and independent quota for a second practice.
The plugin store is process-local; this fix does not establish a fleet-wide spend/call ceiling.
No real calls were made by the local regression.

### Independent PMS posting evidence expansion (ADR-078; not deployed)

Migration30 `20261014180000_posting_source_evidence` follows29. Four immutable tables and
posting-only admission/membership helpers preserve prior records and helpers without backfill.
Apply the complete chain and regenerate Prisma before exposing `/dashboard/posting-evidence`.
Only localhost isolated/shared test databases have run this migration; no new vendor credentials
or external payment instruction is enabled.

Validate header150/complete entries180 (difference−30, never a synthetic adjustment), partial/
unknown source facts, negative/mixed entry kinds, exact retries, stale previews, and retained
entry ownership through accepted PARTIAL/ABSENT snapshots. Only accepted COMPLETE/REMOVED
snapshots reset source-entry membership; rejected/unreviewed changes cannot free identities.
Check tenant/role/audit failures and READ COMMITTED/REPEATABLE READ races. Bodies256KiB/100entries
and pages20/2MiB are bounded; follow cursor/hasMore. Source receipt history and all accepted
entry mirrors are retained; roll back application exposure rather than delete evidence.
Monitor audit health, closed errors and organization lock/query latency without source values.
Native sync must capture child edits as well as header versions and correctly interpret native
sentinel dates. Actual authenticated connectors, source-to-claim binding, external posting,
retention/restore and authorized AWS end-to-end evidence remain deployment gates.

### Review-notification outbox expansion (ADR-079; not deployed)

Migration 31 `20261014190000_review_notification_outbox` follows 30. It adds scoped immutable
intent/attempt/receipt records plus guarded delivery state without historical backfill. At this
checkpoint it has run only on localhost isolated/shared databases; direct invariants and
migration-preservation checks pass. Local verification is recorded below; authorized rollout and
production environment evidence remain separate gates.
Regenerate Prisma and coordinate API/summary-worker artifacts after applying the validated chain.
Older workers retain the obsolete post-commit path, so drain/review them before switching writers.

External delivery remains DISABLED. The dispatcher is exported for explicit synthetic transport
injection only; no runtime live adapter, send endpoint or scheduled live relay is enabled. No
provider key or migration alone enables email. Operations adds two audited OWNER/ADMIN GETs with
filtered counts/list/history and safe metadata; it offers no send, retry or recipient-rebind action.

Before release, validate atomic source/intent/audit rollback, stable key/content across crashes,
recipient/source drift, native review suppression, tenant/role/read-audit failures and late-lease
fencing. First submission persists a one-minute lease, at most five attempts and a fixed 23-hour
deadline; expiration/uncertainty must quarantine without extending the window or minting a new key.
Keep SIMULATED, provider acceptance and actual email delivery distinct. Focused producer and
process/transport checks, focused notification API 15, affected lint/typecheck 30 and API/Lambda/
Next builds pass. Full API passes 878/878 across 43 files. Full worker run 144/145 plus a focused
3/3 recheck covers all 145 cases after bounded process-timeout alignment under CPU saturation;
this is not one clean full rerun. Keep that qualification with the evidence in ADR-079.

Rollback application exposure while retaining all intents, leases, attempts, receipts and source
history. Do not delete/reseed pending work or rebind recipients to force delivery. Monitor only
closed status/reason/count fields; never log addresses, bodies, keys or hashes. A future live
release requires verified domain/account configuration, explicit authorization, current provider
idempotency/rate-limit contracts, transport and receipt reconciliation, retention/restore and any
applicable PHI/vendor agreements. No production change or real message occurred in this slice.

### Stable remittance batch revisions (ADR-080; not deployed)

Migration 32 `20261014200000_remittance_batch_revisions` follows migration 31 and is frozen/applied
only to localhost isolated/shared databases. It adds immutable batch/revision/member-ownership
sidecars and backfills structural links while retaining existing payload/hash/review/member/match/
release bytes and prior helper definitions. Apply the complete migration chain and regenerate
Prisma before exposing version 2 imports and history through the coordinated API/SDK/dashboard.
Existing version 1 payloads remain unsequenced; never rewrite them with an invented sequence.

Validate explicit source-order/currentness, new-record and duplicate-sequence conflicts, repeated
same-batch membership, permanent ownership after omission, newer rejected revision staleness,
immutable review replay with refreshed metadata, and reservation preservation across corrected
nets. Replacement matches must remain blocked until prior revision matches are fully released.
Monitor closed conflicts, audit health and lock/query latency without logging source values.
Rollback application exposure while retaining every sidecar and historical receipt; do not delete
ownership or release reservations as an application rollback shortcut. These are local synthetic
contracts, without connector authentication or any financial action. Local DB/API/SDK/UI checks,
API/Lambda/Next builds and affected lint/typecheck 30/30 pass as recorded in ADR-080; production
deployment, restoration/retention and external integration gates remain open. The preceding FW-40 commit is `4af99ec`; external notification delivery stays disabled.

### Reviewed posting-entry relationships (ADR-081; not deployed)

Migration 33 `20261014210000_posting_claim_relationships` follows 32 and is frozen/applied only to
localhost isolated/shared databases. It adds immutable relationship/release records and exact
scoped admission guards, without historical backfill or prior helper changes. Apply the complete
migration chain and regenerate Prisma before exposing the coordinated API/SDK/posting dashboard.
Retain original posting source fields and imported claim snapshots as independent evidence.

Validate exact system/namespace/source-claim identity, duplicate display numbers/repeated codes,
optional line/procedure agreement, latest-observed source and claim-edit staleness, immutable
retry receipts, source-entry reservations across revisions/receipts, full release/rematch, audit
rollback and tenant/concurrency guards. An unknown or mismatched source must not become a guessed
link. Monitor closed conflicts, audit failures and organization/claim lock latency without source
values. Roll back application exposure while retaining all relationship/release receipts and
reservations; never release or delete records merely to roll back code. Local DB/API/SDK/UI
verification, affected lint/typecheck 30/30 and API/Lambda/Next builds pass as recorded in ADR-081. Real source authentication, external posting, bank cash, settlement,
retention/restore and production rollout remain separate gates; no provider credential activates
this local manual workflow. ADR-080 is the preceding committed slice (`710060b`).

### Local synthetic demo preparation (ADR-082; no deployment change)

FW-45 preparation adds a connected public fixture bundle, strict parser/manifest checks, a
read-only local preflight and the current-screen guide in `DEMO.md`. There is no schema migration,
public API change or deployed UI feature in this slice. Require an exclusive localhost database
named `dentabill_demo_…`, current exact migration checksums, intended local/Clerk actor bindings
and explicit synthetic local configuration. Known cloud/provider/billing/mail settings must be
absent; Clerk test-key presence alone is not authentication evidence.

The preflight neither applies migrations nor creates/resets a database, actor or fixture data.
It does not start the app, run old seeds/simulators or install a landing video. Prior115 tests,
checks30/30, CLI types/API build and the read-only smoke establish the earlier fixture/database
checkpoint only. Generated Prisma could reload dotenv after validation; startup-isolation proof
was missing. The remediation creates a private0700 temporary schema/client with native engine and
no env paths, bundles workspace modules, runs generator/esbuild in minimal-env children and executes
the command with an explicit environment allowlist and closed reports. Private artifacts are cleaned
up; installed Node/pnpm/tsx remain trusted and parent preloads already executed cannot be undone.
Fresh122 tests plus15 separate helper cases and the actual isolated read-only33-migration smoke
pass, plus current API/dependency checks24/24, strict CLI types and API build (ADR-082). The earlier
30/30 had a broader pre-fix scope. ADR-083 create-only guarded provisioning and the isolated
web/API launcher remain the next steps. Guarded setup and an environment-clean launcher must precede
an actual authenticated rehearsal; a completed recording and asset integration follow separately.
Do not treat test-header HTTP flow, a synthetic-key positive preflight or raw development startup
as a production/Clerk/browser certification. The full AWS/connector/financial rollout gates and
FW-43 source reconciliation remain open.
