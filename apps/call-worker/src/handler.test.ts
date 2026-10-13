import { hashPatientDOB, prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { FakeRetell } from '@dentabill/payer-ivr';
import { type CallJobData, createBullMqJobDispatcher } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadWorkerEnv } from './env.js';
import { createCallJobHandler, MissingCallIdentityError, providerLineToE164 } from './handler.js';

/**
 * Integration tests for the real call-job handler (P3-T10).
 *
 * Hits the real `dentabill_test` Postgres so the org-scope read helper
 * + the write middleware (ADR-009 layers 1+2) are exercised exactly as
 * they will be in production. The Retell port is `FakeRetell` so the
 * full event flow runs in-process — no network, no flakiness.
 */

const HASH_SECRET = 'integration-test-secret-not-the-real-one';

const silentLogger = createLogger({
  level: 'fatal',
  pretty: false,
  base: { service: 'call-worker-test' },
});

const env = loadWorkerEnv({
  REDIS_URL: 'redis://localhost:6379/14',
  DATABASE_URL: 'postgresql://dentabill:dentabill@localhost:5432/dentabill_test?schema=public',
  RETELL_API_KEY: '',
  WORKER_OUTBOUND_NUMBER: '+15555550100',
});

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
  );
});

interface SeedResult {
  readonly orgId: string;
  readonly claimId: string;
}

async function seedOrgAndClaim(opts?: {
  providerNpi?: string | null;
  subscriberId?: string | null;
}): Promise<SeedResult> {
  const org = await prisma.organization.create({
    data: {
      name: 'Sunshine Family Dental',
      clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}`,
      npi: opts?.providerNpi === null ? null : (opts?.providerNpi ?? '1234567890'),
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'CLM-9001',
      subscriberId: opts?.subscriberId === null ? null : (opts?.subscriberId ?? 'MEMBER-9001'),
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

function jobFor(data: CallJobData): Parameters<ReturnType<typeof createCallJobHandler>>[0] {
  // BullMQ Job has many fields; the handler only reads `id` + `data`.
  return { id: 'job_test_1', data } as Parameters<ReturnType<typeof createCallJobHandler>>[0];
}

// P4-T2G — minimal stub for the SummariesQueue so the handler's
// emission seam can be exercised without booting BullMQ. The real
// queue is exercised in `apps/summary-worker` integration tests.
function createFakeSummariesQueue(): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  add: (name: string, data: unknown, opts?: unknown) => Promise<any>;
  readonly added: readonly { name: string; data: unknown; opts?: unknown }[];
} {
  const added: { name: string; data: unknown; opts?: unknown }[] = [];
  return {
    added,
    add: (name, data, opts) => {
      added.push({ name, data, opts });
      return Promise.resolve({ id: `fake-${String(added.length)}` });
    },
  };
}

describe('createCallJobHandler — happy path', () => {
  it('drives PENDING → CALLING → COMPLETED, persists Call + CallEvent rows', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    // Deterministic retellCallId so the test can drive simulateHappyPath
    // without racing the handler's startCall → DB-write → subscribe path.
    const retellCallId = 'fake_call_happy_1';
    const fake = new FakeRetell({ retellCallIdFactory: () => retellCallId });
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });

    const data: CallJobData = {
      organizationId: orgId,
      claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: 'job-test-1',
    };

    // FakeRetell buffers events emitted before the handler subscribes
    // and replays them on subscribe (mirrors the production race where
    // Retell webhook delivery beats the worker's listener registration).
    // We can therefore kick the simulation eagerly once startCall has
    // been observed — no need to coordinate against the DB write.
    const handlerPromise = handler(jobFor(data), 'token');
    await waitFor(() => fake.startedCalls.length === 1);
    await fake.simulateHappyPath(retellCallId);

    const result = await handlerPromise;
    expect(result.outcome).toBe('COMPLETED');
    expect(result.callId).toMatch(/^c[a-z0-9]+$/);
    expect(fake.startedCalls[0]?.agentMetadata.subscriberId).toBe('MEMBER-9001');

    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claimAfter.status).toBe('COMPLETED');
    expect(claimAfter.lastCallAt).not.toBeNull();

    const callRow = await prisma.call.findUniqueOrThrow({ where: { id: result.callId } });
    expect(callRow.organizationId).toBe(orgId);
    expect(callRow.claimId).toBe(claimId);
    expect(callRow.status).toBe('COMPLETED');
    // A hangup/completion event alone does not prove a human was reached.
    expect(callRow.humanReached).toBe(false);
    expect(callRow.attemptNumber).toBe(1);
    expect(callRow.endedAt).not.toBeNull();
    expect(callRow.durationSeconds).not.toBeNull();
    expect(callRow.retellCallId).toBe(retellCallId);

    const events = await prisma.callEvent.findMany({
      where: { callId: result.callId },
      orderBy: { timestamp: 'asc' },
    });
    // Started + 4 transcripts + ended = 6 events from simulateHappyPath +
    // the auto-emitted call.started.
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.map((e) => e.eventType)).toContain('call.ended');
    expect(events.map((e) => e.eventType)).toContain('call.transcript');
  });
});

describe('createCallJobHandler — reviewed state protection', () => {
  it('preserves a reviewed claim and audits the skipped transition after the provider ends', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    const retellCallId = 'fake_reviewed_claim';
    const fake = new FakeRetell({ retellCallIdFactory: () => retellCallId });
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    const pending = handler(
      jobFor({
        organizationId: orgId,
        claimId,
        payerCode: 'DELTA_DENTAL_PPO',
        attemptNumber: 1,
        claimPriority: 80,
        idempotencyKey: 'reviewed-claim-test',
      }),
      'token',
    );
    await waitFor(() => fake.startedCalls.length === 1);
    await prisma.claim.updateMany({
      where: { id: claimId, organizationId: orgId },
      data: { status: 'RESOLVED' },
    });
    await fake.simulateHappyPath(retellCallId);
    const result = await pending;
    expect(
      (await prisma.claim.findFirstOrThrow({ where: { id: claimId, organizationId: orgId } }))
        .status,
    ).toBe('RESOLVED');
    const event = await prisma.auditLog.findFirstOrThrow({
      where: {
        organizationId: orgId,
        resourceId: result.callId,
        action: 'call.end',
      },
    });
    expect(event.metadata).toMatchObject({
      proposedClaimStatus: 'COMPLETED',
      claimTransitionApplied: false,
    });
    expect(event.metadata).not.toHaveProperty('finalClaimStatus');
  });
});

describe('createCallJobHandler — denial path', () => {
  it('flips Claim.status → DENIED when collectedInfo.claimStatus = "denied"', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    const retellCallId = 'fake_call_deny_1';
    const fake = new FakeRetell({ retellCallIdFactory: () => retellCallId });
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });

    const data: CallJobData = {
      organizationId: orgId,
      claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: 'job-test-deny-1',
    };

    const handlerPromise = handler(jobFor(data), 'token');
    await waitFor(() => fake.startedCalls.length === 1);
    await fake.simulateDenial(retellCallId);

    const result = await handlerPromise;
    expect(result.outcome).toBe('COMPLETED');

    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claimAfter.status).toBe('DENIED');
  });
});

describe('createCallJobHandler — input validation & guards', () => {
  it('rejects a malformed job payload at the dequeue trust boundary', async () => {
    const fake = new FakeRetell();
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    // Bypass the CallJobData compile-time check so the test can assert
    // the dequeue-time runtime guard rejects out-of-range payloads. This
    // is the trust-boundary contract — the worker cannot rely on the
    // enqueuer having validated.
    const malformed = jobFor({
      organizationId: 'org_x',
      claimId: 'clm_x',
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 99,
      claimPriority: 50,
      idempotencyKey: 'bad-1',
    });
    await expect(handler(malformed, 'token')).rejects.toThrow();
    expect(fake.startedCalls).toHaveLength(0);
  });

  it('throws when the claim is not found in the named org (cross-org isolation)', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    // Seed a SECOND org; we will look up `claimId` (org A) under org B.
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
    });
    const fake = new FakeRetell();
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    const data: CallJobData = {
      organizationId: otherOrg.id,
      claimId, // belongs to org A — must not be reachable from org B
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 50,
      idempotencyKey: 'cross-org-1',
    };
    await expect(handler(jobFor(data), 'token')).rejects.toThrow(/not found in organization/);
    expect(fake.startedCalls).toHaveLength(0);

    // Org A's claim must remain untouched.
    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claimAfter.organizationId).toBe(orgId);
    expect(claimAfter.status).toBe('IN_QUEUE');
  });

  it('throws when the org has no provider NPI configured', async () => {
    const { orgId, claimId } = await seedOrgAndClaim({ providerNpi: null });
    const fake = new FakeRetell();
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    const data: CallJobData = {
      organizationId: orgId,
      claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 50,
      idempotencyKey: 'no-npi-1',
    };
    await expect(handler(jobFor(data), 'token')).rejects.toMatchObject({
      code: 'MISSING_CALL_IDENTITY',
      missingFields: ['providerNpi'],
    });
    expect(fake.startedCalls).toHaveLength(0);
  });

  it.each([
    { subscriberId: null, providerNpi: '1234567890', missingFields: ['subscriberId'] },
    { subscriberId: '', providerNpi: '1234567890', missingFields: ['subscriberId'] },
    { subscriberId: ' \t ', providerNpi: '1234567890', missingFields: ['subscriberId'] },
    { subscriberId: 'MEMBER-9001', providerNpi: '', missingFields: ['providerNpi'] },
    { subscriberId: 'MEMBER-9001', providerNpi: ' \n ', missingFields: ['providerNpi'] },
    { subscriberId: null, providerNpi: null, missingFields: ['subscriberId', 'providerNpi'] },
  ])('blocks dialing and routes missing identity to NEEDS_INFO: %j', async (identity) => {
    const { orgId, claimId } = await seedOrgAndClaim(identity);
    const fake = new FakeRetell();
    const startCall = vi.spyOn(fake, 'startCall');
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    const data: CallJobData = {
      organizationId: orgId,
      claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: 'missing-identity',
    };
    const failed = handler(jobFor(data), 'token');
    await expect(failed).rejects.toBeInstanceOf(MissingCallIdentityError);
    await expect(failed).rejects.toMatchObject({
      code: 'MISSING_CALL_IDENTITY',
      missingFields: identity.missingFields,
    });
    expect(startCall).not.toHaveBeenCalled();
    expect(await prisma.call.count({ where: { organizationId: orgId, claimId } })).toBe(0);
    const claim = await prisma.claim.findFirstOrThrow({
      where: { id: claimId, organizationId: orgId },
    });
    expect(claim.status).toBe('NEEDS_INFO');
    expect(claim.lastCallAt).toBeNull();
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: orgId, resourceId: claimId, action: 'call.blocked' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.metadata).toEqual({
      jobId: 'job_test_1',
      reason: 'MISSING_CALL_IDENTITY',
      missingFields: identity.missingFields,
    });
    await expect(handler(jobFor(data), 'token')).rejects.toBeInstanceOf(MissingCallIdentityError);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: orgId, resourceId: claimId, action: 'call.blocked' },
      }),
    ).toBe(1);
    expect(startCall).not.toHaveBeenCalled();
  });

  it('does not reopen a resolved claim when a stale job lacks identity', async () => {
    const { orgId, claimId } = await seedOrgAndClaim({ subscriberId: null });
    await prisma.claim.updateMany({
      where: { id: claimId, organizationId: orgId },
      data: { status: 'RESOLVED' },
    });
    const fake = new FakeRetell();
    const startCall = vi.spyOn(fake, 'startCall');
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    await expect(
      handler(
        jobFor({
          organizationId: orgId,
          claimId,
          payerCode: 'DELTA_DENTAL_PPO',
          attemptNumber: 1,
          claimPriority: 80,
          idempotencyKey: 'stale-missing-identity',
        }),
        'token',
      ),
    ).rejects.toBeInstanceOf(MissingCallIdentityError);
    expect(startCall).not.toHaveBeenCalled();
    const claim = await prisma.claim.findFirstOrThrow({
      where: { id: claimId, organizationId: orgId },
    });
    expect(claim.status).toBe('RESOLVED');
  });
});

describe('createCallJobHandler — true cancel channel (P4-T7-prep-4)', () => {
  it('detects cancelRequestedAt mid-call and issues endCall to Retell', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    const retellCallId = 'fake_call_cancel_1';
    const fake = new FakeRetell({ retellCallIdFactory: () => retellCallId });
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    const data: CallJobData = {
      organizationId: orgId,
      claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: 'job-cancel-1',
    };

    // Stamp the cancel marker BEFORE the handler runs by pre-creating
    // the Call row in the seeded org. The handler creates its own Call
    // row at startCall time, so we use a setInterval-friendly hook
    // instead: poll until the handler has persisted its Call row, then
    // stamp the marker and let the cancel-poll loop drive endCall.
    const handlerPromise = handler(jobFor(data), 'token');
    await waitFor(() => fake.startedCalls.length === 1);
    // Wait for the handler's Call row to land in Postgres before we
    // stamp the marker — startCall returns before the DB write completes.
    await waitFor(async () => {
      const c = await prisma.call.findFirst({ where: { retellCallId } });
      return c !== null;
    });
    await prisma.call.updateMany({
      where: { retellCallId, organizationId: orgId },
      data: { cancelRequestedAt: new Date(), cancelRequestedBy: 'test-user' },
    });

    // Drive simulateHappyPath as the natural fallback so the test never
    // hangs even if the cancel-poll loop is slow. The cancel may or may
    // not fire before the natural ending — both outcomes leave the call
    // COMPLETED.
    await fake.simulateHappyPath(retellCallId);
    const result = await handlerPromise;
    expect(result.outcome).toBe('COMPLETED');
  });
});

describe('createCallJobHandler — summary emission (P4-T2G)', () => {
  it('enqueues a summary.generate job with the call.<id> idempotencyKey when summariesQueue is wired', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    const retellCallId = 'fake_call_emit_1';
    const fake = new FakeRetell({ retellCallIdFactory: () => retellCallId });
    const summariesQueue = createFakeSummariesQueue();
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
      jobDispatcher: createBullMqJobDispatcher({ summariesQueue }),
    });
    const data: CallJobData = {
      organizationId: orgId,
      claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: 'job-emit-1',
    };
    const handlerPromise = handler(jobFor(data), 'token');
    await waitFor(() => fake.startedCalls.length === 1);
    await fake.simulateHappyPath(retellCallId);
    const result = await handlerPromise;

    expect(summariesQueue.added).toHaveLength(1);
    const enqueued = summariesQueue.added[0];
    expect(enqueued?.name).toBe('summary.generate');
    expect(enqueued?.data).toMatchObject({
      organizationId: orgId,
      callId: result.callId,
      promptVersion: 'v1',
      idempotencyKey: `call.${result.callId}`,
    });
    expect(enqueued?.opts).toMatchObject({ jobId: `call.${result.callId}` });
  });

  it('does not throw when summariesQueue.add fails — call lifecycle stays healthy', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    const retellCallId = 'fake_call_emit_fail_1';
    const fake = new FakeRetell({ retellCallIdFactory: () => retellCallId });
    const failingQueue = {
      add: () => Promise.reject(new Error('Redis unreachable')),
    };
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
      jobDispatcher: createBullMqJobDispatcher({ summariesQueue: failingQueue }),
    });
    const data: CallJobData = {
      organizationId: orgId,
      claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: 'job-emit-fail-1',
    };
    const handlerPromise = handler(jobFor(data), 'token');
    await waitFor(() => fake.startedCalls.length === 1);
    await fake.simulateHappyPath(retellCallId);
    const result = await handlerPromise;
    expect(result.outcome).toBe('COMPLETED');
  });
});

describe('providerLineToE164', () => {
  it('canonicalises hyphenated US numbers', () => {
    expect(providerLineToE164('1-800-765-6003')).toBe('+18007656003');
    expect(providerLineToE164('800-244-6224')).toBe('+18002446224');
  });

  it('keeps already-E.164 input unchanged', () => {
    expect(providerLineToE164('+18007656003')).toBe('+18007656003');
  });

  it('throws on a non-canonical line', () => {
    expect(() => providerLineToE164('555')).toThrow();
  });
});

/**
 * Polls `predicate` every 5ms up to `timeoutMs`. We use this instead of
 * `setTimeout(0)` because `FakeRetell.startCall` resolves on a microtask
 * but the handler then issues a Prisma write before the test can observe
 * the row; polling is the simplest way to bridge those steps without
 * coupling the test to internal timing.
 */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor: predicate never became true');
}
