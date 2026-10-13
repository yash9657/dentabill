# DentaBill Deploy — AWS Lambda (API + SQS job worker)

**Decision record:** ADR-053 (job dispatch modes). **Branch:** `infra/aws`. Infrastructure (Terraform) lives outside this repo; this page describes what the code expects from it and how the artifacts are built.

## Job dispatch modes

`JOB_DISPATCH_MODE` selects how `call.place` / `summary.generate` jobs reach their processors. Every producer (`POST /v1/claims/:id/calls`, `POST /v1/calls/:id/summary/retry`, the call handler's summary fan-out, the hold-detector reschedule) goes through `JobDispatcher`, so all of them follow the mode.

| Mode               | Transport                                            | Consumer                                            | Use                         |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------- | --------------------------- |
| `bullmq` (default) | Redis (BullMQ queues)                                | always-on `call-worker` / `summary-worker`          | Docker / local dev          |
| `inline`           | self-POST to `/v1/internal/jobs/*` under `waitUntil` | the API function itself                             | Vercel (`DEPLOY_VERCEL.md`) |
| `sqs`              | one SQS **standard** queue (`JOBS_QUEUE_URL`)        | the worker Lambda (`apps/api/src/lambda-worker.ts`) | AWS                         |

In `sqs` mode the API never runs work after a response (Lambda freezes the process once the response completes). The `/v1/internal/jobs/*` routes stay registered but refuse every request unless `INTERNAL_JOB_SECRET` is set; leave it unset on AWS.

### SQS message format

Body: `{"type":"call.place"|"summary.generate","data":<job payload>}`, validated with the queue package's Zod schemas on both sides. Message attributes `jobType` and `idempotencyKey` mirror the routing fields (no PHI). The returned job id is always `data.idempotencyKey`.

### Delays

`DispatchOptions.delayMs` maps to SQS `DelaySeconds`, rounded up to whole seconds and **clamped to 900 s** (the SQS maximum); a clamp is logged as a warning. No current producer passes a delay; the hold-detector reschedule is dispatched immediately in every mode.

### Retries, duplicates and the DLQ

The worker runs **one attempt per receive**; the attempt number is `ApproximateReceiveCount`.

| Result of the attempt                                 | Worker action                                                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| success, or skipped as a duplicate                    | message deleted                                                                                                                  |
| failure, receive count < `JOBS_MAX_RECEIVE_COUNT` (3) | visibility timeout set to the BullMQ backoff (calls 30 s, 60 s; summaries 15 s, 30 s), returned in `batchItemFailures`           |
| failure on the final receive                          | calls: DLQ escalation runs (claim → `MANUAL_REVIEW`, `Call.dlqReason`, `call.dlq` event); summaries: error logged. Then deleted. |
| unparseable body, or a crash outside the processor    | returned in `batchItemFailures` with no visibility change, and never deleted, so the redrive policy moves it to the SQS DLQ      |

Duplicate suppression is the same as inline mode, in Postgres. A call job atomically moves its claim `IN_QUEUE → CALLING` (on a redelivery `CALLING → CALLING` is also accepted; any other claim state is skipped). Summary jobs skip when a `CallSummary` already exists. SQS standard queues deliver at least once, so these checks are the only dedupe.

The SQS DLQ therefore holds only messages the code never handled: poison messages, or jobs whose Lambda invocation died (for example a timeout) on every receive.

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

**API:** `NODE_ENV=production` (required), `DATABASE_URL` (required), `NEXT_PUBLIC_APP_URL` (required), `JOB_DISPATCH_MODE=sqs` (required), `JOBS_QUEUE_URL` (required), `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` (required: production refuses to boot without them), `DOB_HASH_SECRET` and `RETELL_WEBHOOK_SECRET` (required for production, since the dev defaults are not secret), `PORT` (optional, default 8080), plus the optional ones from `DEPLOY_VERCEL.md` (`API_CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`, `CLERK_WEBHOOK_SECRET`, `RETELL_API_KEY`, `DEMO_IGNORE_PAYER_HOURS`, `REDIS_URL`, `SSE_*`). `AWS_REGION` and `AWS_LAMBDA_FUNCTION_NAME` are set by Lambda.

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

- A call job runs the whole phone call inside one worker invocation. If a call outlives the 900 s Lambda timeout, the invocation dies and SQS redelivers the job after the visibility timeout. The redelivery is allowed to take the `CALLING` lease and dials again, the same as a stalled BullMQ job. The duration and hold guards in `apps/call-worker` (`createDurationGuard`, `createHoldDetector`) exist but are not wired into the call handler yet, so `MAX_CALL_DURATION_MS` / `MAX_HOLD_MS` do not currently bound a call. Wire them in with caps well under 900 s before running real telephony on Lambda.
- SQS ignores BullMQ priority, so call jobs run in arrival order.
