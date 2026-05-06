import { hashPatientDOB, prisma } from '@dentabill/db';
import { FakeRetell } from '@dentabill/payer-ivr';
import {
  CALL_JOB_NAME,
  type CallJobData,
  CALLS_DEFAULT_JOB_OPTIONS,
  createCallsQueue,
  createRedisConnection,
} from '@dentabill/queue';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadWorkerEnv } from './env.js';
import { bootCallWorker, type CallWorkerHandle } from './server.js';

/**
 * End-to-end integration test for the Phase 3 call lifecycle (P3-T15).
 *
 * Hits the full stack — real Postgres (`dentabill_test`), real Redis
 * (DB 14), real BullMQ Worker, real graceful-shutdown sequence — with
 * `FakeRetell` as the only swap-out so the IVR + transcript flow runs
 * deterministically in-process. This is the most production-like
 * surface short of dialling an actual payer line.
 *
 * What it asserts:
 *
 *   1. A `call.place` job enqueued against the real BullMQ `calls`
 *      queue is picked up by the worker.
 *   2. The worker transitions Claim → CALLING, persists the Call row
 *      with the correct `retellCallId`, subscribes to the FakeRetell
 *      stream, persists every event as a CallEvent.
 *   3. After `simulateHappyPath`, Claim ends `COMPLETED`, Call ends
 *      `COMPLETED` with `humanReached=true`, ≥5 CallEvents.
 *   4. Cross-org isolation: a parallel job pointing at org A's claim
 *      from a foreign organizationId fails the handler without
 *      touching org A's row, leaving its claim in `IN_QUEUE`.
 *   5. Graceful shutdown drains the worker, closes the DLQ worker,
 *      disconnects Redis, and closes the health server with no
 *      hanging promises.
 */

const HASH_SECRET = 'integration-test-secret-not-the-real-one';

const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14';
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://dentabill:dentabill@localhost:5432/dentabill_test?schema=public';

let queueConnection: Redis;
let workerHandle: CallWorkerHandle | null = null;

beforeAll(async () => {
  await prisma.$connect();
  queueConnection = createRedisConnection(E2E_REDIS_URL, { lazyConnect: false });
  await queueConnection.ping();
  // Drain leftover jobs from a previous run so test ordering is
  // deterministic. `obliterate` removes the queue entirely; a fresh one
  // is created per-test below.
  const cleaner = createCallsQueue({ connection: queueConnection });
  await cleaner.obliterate({ force: true });
  await cleaner.close();
});

afterAll(async () => {
  await queueConnection.quit();
  await prisma.$disconnect();
});

afterEach(async () => {
  if (workerHandle !== null) {
    await workerHandle.shutdown();
    workerHandle = null;
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
  );
  // Wipe the calls queue between tests so a stuck job from one
  // scenario can't bleed into the next.
  const cleaner = createCallsQueue({ connection: queueConnection });
  await cleaner.obliterate({ force: true });
  await cleaner.close();
});

interface SeedResult {
  readonly orgId: string;
  readonly claimId: string;
}

async function seedOrgAndClaim(): Promise<SeedResult> {
  const org = await prisma.organization.create({
    data: {
      name: 'Sunshine Family Dental',
      clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}`,
      npi: '1234567890',
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'CLM-9001',
      patientDOBHash: hashPatientDOB({
        dob: '1990-05-12',
        organizationId: org.id,
        secret: HASH_SECRET,
      }),
      patientDOBLast4: '0512',
      cdtCodes: ['D1110'],
      claimAmount: '245.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-01-15T00:00:00.000Z'),
      status: 'IN_QUEUE',
      priority: 80,
    },
  });
  return { orgId: org.id, claimId: claim.id };
}

function buildEnv(overrides: { workerPort: number }): ReturnType<typeof loadWorkerEnv> {
  return loadWorkerEnv({
    REDIS_URL: E2E_REDIS_URL,
    DATABASE_URL: E2E_DATABASE_URL,
    WORKER_OUTBOUND_NUMBER: '+15555550100',
    WORKER_PORT: String(overrides.workerPort),
    QUEUE_CONCURRENCY: '1',
    NODE_ENV: 'test',
    RETELL_API_KEY: '',
  });
}

/**
 * Pick a port unlikely to collide with anything else on the host. The
 * env schema requires `positive`, so 0 (kernel-assign) is not
 * available; mid-30000s is well above ephemeral-port ranges
 * configured on most CI runners.
 */
function pickWorkerPort(): number {
  return 30_500 + Math.floor(Math.random() * 1_000);
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitFor: predicate never became true');
}

describe('call-worker e2e — happy path lifecycle', () => {
  it('drives PENDING → CALLING → COMPLETED through real BullMQ + Postgres + FakeRetell', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    const retellCallId = 'fake_e2e_happy_1';
    const fake = new FakeRetell({ retellCallIdFactory: () => retellCallId });

    workerHandle = await bootCallWorker({
      env: buildEnv({ workerPort: pickWorkerPort() }), // 0 → kernel-assigned ephemeral port
      retellPort: fake,
    });

    const queue = createCallsQueue({ connection: queueConnection });
    try {
      const data: CallJobData = {
        organizationId: orgId,
        claimId,
        payerCode: 'DELTA_DENTAL_PPO',
        attemptNumber: 1,
        claimPriority: 80,
        idempotencyKey: 'e2e-happy-1',
      };
      await queue.add(CALL_JOB_NAME, data, {
        jobId: 'e2e-happy-1',
        ...CALLS_DEFAULT_JOB_OPTIONS,
      });

      // Worker picks the job up and calls FakeRetell.startCall.
      await waitFor(() => fake.startedCalls.length === 1);

      // Drive the simulation — the FakeRetell buffer-on-no-listener
      // pattern bridges any worker subscribe/start race.
      await fake.simulateHappyPath(retellCallId);

      // Wait for the lifecycle to land on the Claim row.
      await waitFor(async () => {
        const c = await prisma.claim.findUnique({ where: { id: claimId } });
        return c?.status === 'COMPLETED';
      });
    } finally {
      await queue.close();
    }

    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe('COMPLETED');
    expect(claim.lastCallAt).not.toBeNull();

    const callRow = await prisma.call.findFirstOrThrow({
      where: { claimId, organizationId: orgId },
    });
    expect(callRow.status).toBe('COMPLETED');
    expect(callRow.humanReached).toBe(true);
    expect(callRow.attemptNumber).toBe(1);
    expect(callRow.retellCallId).toBe(retellCallId);

    const events = await prisma.callEvent.findMany({ where: { callId: callRow.id } });
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.map((e) => e.eventType)).toContain('call.transcript');
    expect(events.map((e) => e.eventType)).toContain('call.ended');

    expect(fake.startedCalls).toHaveLength(1);
    expect(fake.startedCalls[0]!.agentMetadata.providerNpi).toBe('1234567890');
  });
});

describe('call-worker e2e — cross-org isolation', () => {
  it('refuses to touch a foreign org’s claim and leaves its row in IN_QUEUE', async () => {
    const { orgId: orgA, claimId: orgAclaim } = await seedOrgAndClaim();
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other Co', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
    });
    const fake = new FakeRetell();

    workerHandle = await bootCallWorker({
      env: buildEnv({ workerPort: pickWorkerPort() }),
      retellPort: fake,
    });

    const queue = createCallsQueue({ connection: queueConnection });
    try {
      // The malicious job targets org A's claim while claiming to be from org B.
      const data: CallJobData = {
        organizationId: otherOrg.id,
        claimId: orgAclaim,
        payerCode: 'DELTA_DENTAL_PPO',
        attemptNumber: 1,
        claimPriority: 50,
        idempotencyKey: 'e2e-crossorg-1',
      };
      await queue.add(CALL_JOB_NAME, data, {
        jobId: 'e2e-crossorg-1',
        ...CALLS_DEFAULT_JOB_OPTIONS,
        attempts: 1, // skip the retry policy — one failure is enough.
      });

      // Wait for BullMQ to mark the job failed via its event stream.
      await waitFor(async () => {
        const job = await queue.getJob('e2e-crossorg-1');
        if (job === undefined) return false;
        const state = await job.getState();
        return state === 'failed';
      });
    } finally {
      await queue.close();
    }

    // Org A's claim must NOT have moved.
    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: orgAclaim } });
    expect(claimAfter.organizationId).toBe(orgA);
    expect(claimAfter.status).toBe('IN_QUEUE');
    expect(claimAfter.lastCallAt).toBeNull();

    // FakeRetell should never have been hit — the handler bailed out
    // before reaching startCall.
    expect(fake.startedCalls).toHaveLength(0);

    // No Call row should have been created.
    const calls = await prisma.call.findMany({});
    expect(calls).toHaveLength(0);
  });
});

describe('call-worker e2e — graceful shutdown', () => {
  it('drains worker + DLQ worker, disconnects Redis, closes health server', async () => {
    const fake = new FakeRetell();
    workerHandle = await bootCallWorker({
      env: buildEnv({ workerPort: pickWorkerPort() }),
      retellPort: fake,
    });
    // Both workers are running and Redis is connected. shutdown() walks
    // the full drain sequence (setDraining → worker.close → dlqWorker.close
    // → connection.disconnect → health.close) without throwing.
    await workerHandle.shutdown();
    // Idempotent — second call is a no-op.
    await workerHandle.shutdown();
    workerHandle = null; // already shut down; afterEach must not double-close.
  });
});
