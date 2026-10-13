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

| Result of the attempt                                 | Worker action                                                                                                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| success, duplicate, or fenced uncertainty             | message deleted                                                                                                                                                                                |
| failure, receive count < `JOBS_MAX_RECEIVE_COUNT` (3) | visibility timeout set to the BullMQ backoff (calls 30 s, 60 s; summaries 15 s, 30 s), returned in `batchItemFailures`                                                                         |
| failure on the final receive                          | calls: atomically cancel only exact READY intent and conditionally route claim to review; submitted/unknown calls stay protected. Failed persistence stays retryable. Summaries: error logged. |
| unparseable body, or a crash outside the processor    | returned in `batchItemFailures` with no visibility change, and never deleted, so the redrive policy moves it to the SQS DLQ                                                                    |

Call submission ownership is a persisted CallIntent, shared by all dispatch modes. API
reservation/claim version/audit commit before delivery; the worker commits SUBMITTING before
create and never redials SUBMITTING/UNKNOWN. ACCEPTED resumes the stored call. Legacy jobs
without an exact reservation fail closed. Summary jobs skip existing CallSummary records.
Queue exhaustion does not prove an external call failed.

The SQS DLQ still requires monitored recovery; messages may outlive the processor through
poison payloads, repeated crashes or persistence failure. The local safety slice has no
outbox relay or automatic unknown-ID reconciliation yet. A crash before dispatch can leave
READY work undispatched, and a final-commit/summary-dispatch gap remains. Do not enable real
telephony until these gates plus persisted termination deadlines are closed.

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

- A call job runs the whole phone call inside one worker invocation. If a call outlives the 900 s Lambda timeout, the invocation dies and SQS redelivers the job after the visibility timeout. Local FW-25 code now resumes an ACCEPTED intent or fences a SUBMITTING/UNKNOWN intent instead of redialling; this is not yet deployed, and stalled intents still need automated reconciliation. The duration and hold guards in `apps/call-worker` (`createDurationGuard`, `createHoldDetector`) exist but are not wired into the call handler yet, so `MAX_CALL_DURATION_MS` / `MAX_HOLD_MS` do not currently bound a call. Wire them in with caps well under 900 s before running real telephony on Lambda.
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
SUBMITTING call intents or manufacture a new job key to force a dial. A supported recovery
UI, alerts and reviewed quarantine replay remain follow-on work; there is no automatic reset.
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
No schedule was activated here. On retained inline mode, matching receipts require terminal
intent state; lost/long receipts can still quarantine and require operating review.

Rollout order matters: apply reviewed additive migrations, deploy the matching worker and
allow old invocations to drain before exposing the new API/web recovery action. An older
worker strips the resume field and can acknowledge a command without observing its call.
Verify source-to-resume-to-terminal-to-summary behavior through the actual staged API, queue
and worker before authorized live usage. Retain the new worker/evidence semantics on rollback;
do not discard intents, source events or resume commands. Local two-process crash and both
create-response-race tests do not substitute for this deployed verification.

A recovered nonterminal call remains subject to the existing observer limitations. FW-36
must add persisted ownership/deadlines and missing-terminal-event reconciliation before live
calls; this action does not sweep the account, hard-stop a call, or resolve provider absence.
