# RUNBOOK — Call Worker Oncall

_Phase 3 (Queue + Voice) — last updated 2026-04-29._

This is the oncall playbook for the **call-worker** and the surfaces it
touches (BullMQ + Postgres + Retell + Fastify webhook). One page per
incident; absolute paths to log queries; psql/redis-cli commands you
can paste verbatim.

If you are reading this **and** you are not oncall: stop. The runbook
makes assumptions that are wrong outside an active incident (e.g. the
recovery snippets do not preserve undo history).

## Contents

1. [Health-check matrix](#health-check-matrix)
2. [Redis is down (BullMQ unreachable)](#redis-is-down-bullmq-unreachable)
3. [Retell is down or rejecting starts](#retell-is-down-or-rejecting-starts)
4. [DLQ buildup (`calls-dlq` growing)](#dlq-buildup-calls-dlq-growing)
5. [Business-hours misfire (off-hours dialling)](#business-hours-misfire-off-hours-dialling)
6. [A single claim is stuck in `CALLING`](#a-single-claim-is-stuck-in-calling)
7. [Retell webhook signature failures](#retell-webhook-signature-failures)
8. [Per-call duration cap fires repeatedly](#per-call-duration-cap-fires-repeatedly)

---

## Health-check matrix

The fastest "is anything obviously wrong" pass. Hit each in this order;
the first failure usually localises the incident.

| Surface       | Probe                                        | Healthy response                        |
| ------------- | -------------------------------------------- | --------------------------------------- |
| API           | `curl -fsS http://localhost:3001/v1/healthz` | `200 { "ok": true }`                    |
| API readiness | `curl -fsS http://localhost:3001/v1/readyz`  | `200 { "db": true, "redis": true }`     |
| Call worker   | `curl -fsS http://localhost:3010/healthz`    | `200 { "ok": true, "draining": false }` |
| Postgres      | `psql "$DATABASE_URL" -c 'select 1'`         | `1`                                     |
| Redis         | `docker exec dentabill-redis redis-cli ping` | `PONG`                                  |

If `readyz` is 200 but `healthz` is failing, the worker process
crashed without draining — restart and check the logs for the
crash signature.

---

## Redis is down (BullMQ unreachable)

**Signal.** API `/v1/readyz` returns `redis: false`. Worker logs
include `Connection is closed.` from `ioredis`. New "Call now" clicks
get `503 SERVICE_UNAVAILABLE` from the API.

**Confirm.**

```bash
docker exec dentabill-redis redis-cli ping
# → expect PONG; if "Could not connect" the container is down.
```

**Fix.**

1. Restart the container:
   ```bash
   docker compose --file docker-compose.yml up -d redis
   ```
2. The API and call-worker reconnect automatically (ioredis lazy-reconnects).
3. **Do not restart the worker process** unless `redis-cli ping`
   succeeds and the worker still logs `Connection is closed.` after
   ~10 seconds — ioredis backoff jitter can be that long.

**After-action.**

In-flight calls that were waiting on a `call.ended` event before the
outage may have completed at Retell while we were disconnected. Run
the [stuck-`CALLING`](#a-single-claim-is-stuck-in-calling) recovery for
any Call row whose `endedAt IS NULL` and `startedAt < now() - interval '15 minutes'`.

---

## Retell is down or rejecting starts

**Signal.** Worker logs include `LiveRetell: startCall failed` or
`HTTP 5xx from retell.ai`. New jobs fail and BullMQ retries them
(see ADR-035 for the backoff schedule).

**Confirm.** Retell's status page or a direct `curl https://api.retell.ai/v2/health`.

**Containment.**

If Retell is broadly down, **pause the queue** so we don't burn
through all 3 retry attempts on every claim before BullMQ catches
on. The pause flag is a Redis key, so it survives a worker restart:

```bash
docker exec dentabill-redis redis-cli set "bull:calls:meta-paused" "1"
```

To resume:

```bash
docker exec dentabill-redis redis-cli del "bull:calls:meta-paused"
```

**After-action.**

Once Retell is back, paused jobs resume from the head of the queue
without losing their position. Claims still show `IN_QUEUE` in the
dashboard — no manual cleanup required for a clean recovery.

---

## DLQ buildup (`calls-dlq` growing)

**Signal.** `apps/call-worker/src/dlq-consumer.ts` writes a `CallEvent
type=DLQ` per drained item; if `Call.dlqReason IS NOT NULL` rows
spike, oncall should investigate.

**Look at the latest DLQ reason distribution:**

```bash
psql "$DATABASE_URL" -c "
  SELECT \"dlqReason\", count(*)
    FROM \"Call\"
   WHERE \"dlqReason\" IS NOT NULL
     AND \"updatedAt\" > now() - interval '1 hour'
  GROUP BY \"dlqReason\"
  ORDER BY count(*) DESC;
"
```

**Decision tree.**

- `EXCEEDED_MAX_DURATION` dominant → 15-minute cap (ADR-038) firing.
  Likely a payer's IVR is mis-detecting our DTMF and we're stuck in
  a menu loop. Pull the latest `CallEvent` rows for one such call:

  ```bash
  psql "$DATABASE_URL" -c "
    SELECT \"timestamp\", \"eventType\", left(\"data\"::text, 200) AS data
      FROM \"CallEvent\"
     WHERE \"callId\" = 'call_xxx'
     ORDER BY \"timestamp\";
  "
  ```

  If the IVR map drifted, fix `packages/payer-ivr/src/ivr/maps/<payer>.ts`
  and ship a hotfix PR.

- `EXCEEDED_MAX_HOLD` dominant → payer hold queue is unusually long.
  Confirm with a manual call to the payer line. If it's just slow,
  raise `MAX_HOLD_MS` for that payer in a follow-up — do **not**
  raise it globally.

- `EXCEEDED_MAX_ATTEMPTS` dominant → BullMQ's retry budget exhausted.
  Usually correlates with a Retell or Redis incident; check those
  first.

- `CANCELLED_BY_OPERATOR` non-zero with no operator clicking → the
  cancel route is being called by something automated. Audit the
  `AuditLog` rows with `action='call.cancel'` and a recent timestamp.

---

## Business-hours misfire (off-hours dialling)

**Signal.** A call lands during a payer's off-hours window. The
business-hours guard (ADR-037) runs at API enqueue, so this means
either (a) the guard let it through, or (b) somebody bypassed it.

**Confirm the guard data:**

```bash
node --eval "
  import('./packages/payer-ivr/src/business-hours.js').then(m => {
    console.log(m.checkPayerHours('DELTA_DENTAL_PPO', new Date()));
  });
"
```

**Most common cause.** A holiday isn't in the holiday list. Edit
`packages/payer-ivr/src/business-hours.ts`'s holiday map and ship a
hotfix.

**Recovery for the misfired call.**

The call already went through. Do **not** roll the Claim back — the
rep we reached can't unhear us. Instead:

```bash
psql "$DATABASE_URL" -c "
  UPDATE \"Call\"
     SET \"dlqReason\" = 'CANCELLED_BY_OPERATOR'
   WHERE \"id\" = 'call_xxx';
"
```

…and add a `CallEvent type=ESCALATED` so the audit trail explains
the irregularity:

```bash
psql "$DATABASE_URL" -c "
  INSERT INTO \"CallEvent\" (\"callId\", \"eventType\", \"data\")
  VALUES (
    'call_xxx',
    'call.escalated.off_hours',
    jsonb_build_object('reason', 'business_hours_misfire', 'oncall', '<your name>')
  );
"
```

---

## A single claim is stuck in `CALLING`

This is the #1 most common Phase 3 oncall page. ADR-035's retry policy
combined with a worker crash mid-call can leave a single claim stuck.

**Confirm.**

```bash
psql "$DATABASE_URL" -c "
  SELECT c.id, c.\"claimNumber\", c.\"updatedAt\", call.id AS call_id, call.status, call.\"endedAt\"
    FROM \"Claim\" c
    LEFT JOIN \"Call\" call
      ON call.\"claimId\" = c.id
     AND call.\"endedAt\" IS NULL
   WHERE c.\"status\" = 'CALLING'
     AND c.\"updatedAt\" < now() - interval '15 minutes';
"
```

If a row appears, the claim is genuinely stuck.

**Recovery.**

```sql
-- Inside a transaction, with the claim id you found above.
BEGIN;
UPDATE "Call"
   SET "status"   = 'FAILED',
       "endedAt"  = now(),
       "dlqReason"= 'EXCEEDED_MAX_ATTEMPTS'
 WHERE "claimId" = 'claim_xxx'
   AND "endedAt" IS NULL;

UPDATE "Claim"
   SET "status" = 'MANUAL_REVIEW'
 WHERE "id" = 'claim_xxx';

INSERT INTO "CallEvent" ("callId", "eventType", "data")
SELECT id, 'call.recovered_from_stuck', jsonb_build_object('runbook', 'stuck_calling', 'oncall', '<your name>')
  FROM "Call"
 WHERE "claimId" = 'claim_xxx'
   AND "dlqReason" = 'EXCEEDED_MAX_ATTEMPTS';
COMMIT;
```

The DLQ consumer (`apps/call-worker/src/dlq-consumer.ts`) is **not** invoked
here — we are bypassing the queue path, so the recovery includes the
`CallEvent type=call.recovered_from_stuck` to make the audit trail
explicit.

---

## Retell webhook signature failures

**Signal.** API logs include `WEBHOOK_SIGNATURE_INVALID` 401s for
`/v1/webhooks/retell`.

**Confirm.**

```bash
psql "$DATABASE_URL" -c "
  SELECT count(*) FROM \"AuditLog\"
   WHERE \"action\" = 'webhook.retell.signature_invalid'
     AND \"createdAt\" > now() - interval '1 hour';
"
```

**Decision tree.**

- Spike right after a deploy → `RETELL_WEBHOOK_SECRET` rotation got out
  of sync. Check the prod env (Vercel / Fly / wherever) matches Retell's
  dashboard.
- Spike with a known `eventId` repeated → replay attempt or retry
  loop. The unique-on-`eventId` constraint already turns these into
  200 no-ops; a repeated 401 with the same id means the body changed
  between attempts (Retell's bug, not ours).
- Steady low rate → an unauthenticated scanner. Ignore unless rate
  exceeds 10/min.

**Never** disable signature verification to "see what gets through" —
that's a HIPAA-grade incident.

---

## Per-call duration cap fires repeatedly

**Signal.** `Call.dlqReason = EXCEEDED_MAX_DURATION` rate spikes for a
single payer.

**First check.** Did the IVR map for that payer change recently?

```bash
git log --since='7 days ago' -- 'packages/payer-ivr/src/ivr/maps/'
```

If yes, suspect that change first.

**Second check.** Is the payer announcing a new IVR menu? Manually
call the payer's provider line and listen. If a new option got added
between two existing options, our DTMF responses are now hitting the
wrong menu and the agent gets stuck.

**Mitigation while a fix is shipped.**

Pause new enqueues for that payer:

```bash
# `pause:DELTA_DENTAL_PPO` is checked by the API enqueue route's
# business-hours guard via the same Redis-backed flag pattern as
# `bull:calls:meta-paused`.
docker exec dentabill-redis redis-cli set "calls:pause:DELTA_DENTAL_PPO" "1"
```

(Note: this paused-payer flag is currently **not** wired into the API
— ship that as part of the hotfix if the incident exceeds 30
minutes.)

---

## Pointer table — where the code lives

| Concern           | File                                       |
| ----------------- | ------------------------------------------ |
| Job enqueue       | `apps/api/src/routes/v1/calls.ts`          |
| Webhook signature | `apps/api/src/routes/v1/retell-webhook.ts` |
| Job handler       | `apps/call-worker/src/handler.ts`          |
| Hold detector     | `apps/call-worker/src/hold-detector.ts`    |
| Per-call cap      | `apps/call-worker/src/duration-guard.ts`   |
| DLQ consumer      | `apps/call-worker/src/dlq-consumer.ts`     |
| IVR maps          | `packages/payer-ivr/src/ivr/maps/`         |
| Business hours    | `packages/payer-ivr/src/business-hours.ts` |
| Retell port       | `packages/payer-ivr/src/retell-port.ts`    |
| Audit helper      | `packages/db/src/lib/audit.ts`             |

When in doubt, grep for the dlqReason / eventType / action string the
incident is producing.
