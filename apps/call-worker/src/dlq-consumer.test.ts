import { hashPatientDOB, prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { type DlqJobData, DLQ_JOB_NAME, DLQ_REASONS, QUEUE_NAMES } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDlqJobHandler } from './dlq-consumer.js';

/**
 * Integration tests for the DLQ consumer (P3-T14) against real
 * `dentabill_test` Postgres. Idempotency is the load-bearing property:
 * re-running the same DLQ job MUST be a no-op.
 */

const HASH_SECRET = 'integration-test-secret-not-the-real-one';

const silentLogger = createLogger({
  level: 'fatal',
  pretty: false,
  base: { service: 'call-worker-test' },
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
  readonly callId: string;
}

async function seedOrgClaimAndCall(opts?: {
  attemptNumber?: number;
  callStatus?: 'NAVIGATING_IVR' | 'COMPLETED';
  withCall?: boolean;
}): Promise<SeedResult> {
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
      status: 'CALLING',
      priority: 80,
    },
  });
  if (opts?.withCall === false) {
    return { orgId: org.id, claimId: claim.id, callId: '' };
  }
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: `fake_call_${Math.random().toString(36).slice(2)}`,
      retellAgentId: 'agent_test',
      status: opts?.callStatus ?? 'NAVIGATING_IVR',
      attemptNumber: opts?.attemptNumber ?? 1,
      startedAt: new Date(),
    },
  });
  return { orgId: org.id, claimId: claim.id, callId: call.id };
}

function dlqJob(
  data: DlqJobData,
  id = 'dlq_test_1',
): Parameters<ReturnType<typeof createDlqJobHandler>>[0] {
  return { id, data, name: DLQ_JOB_NAME } as Parameters<ReturnType<typeof createDlqJobHandler>>[0];
}

function buildDlqPayload(input: {
  organizationId: string;
  claimId: string;
  attemptNumber: 1 | 2;
  reason: DlqJobData['reason'];
  failedReason?: string;
}): DlqJobData {
  return {
    originalJobId: 'original-job-1',
    originalQueueName: QUEUE_NAMES.CALLS,
    originalJobName: 'call.place',
    originalData: {
      organizationId: input.organizationId,
      claimId: input.claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: input.attemptNumber,
      claimPriority: 80,
      idempotencyKey: 'job-test-1',
    },
    reason: input.reason,
    ...(input.failedReason !== undefined && { failedReason: input.failedReason }),
    attemptsMade: input.attemptNumber,
    enqueuedAt: '2026-04-28T03:00:00.000Z',
  };
}

describe('createDlqJobHandler — happy path (Call row exists)', () => {
  it('stamps Call.dlqReason, flips to FAILED, writes call.dlq event, escalates Claim', async () => {
    const { orgId, claimId, callId } = await seedOrgClaimAndCall();
    const handler = createDlqJobHandler({ logger: silentLogger, prisma });

    await handler(
      dlqJob(
        buildDlqPayload({
          organizationId: orgId,
          claimId,
          attemptNumber: 1,
          reason: DLQ_REASONS.EXCEEDED_MAX_HOLD,
          failedReason: 'hold cap exceeded after 600001 ms of silence',
        }),
      ),
      'token',
    );

    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(callAfter.status).toBe('FAILED');
    expect(callAfter.dlqReason).toBe('EXCEEDED_MAX_HOLD');

    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claimAfter.status).toBe('MANUAL_REVIEW');

    const events = await prisma.callEvent.findMany({
      where: { callId, eventType: 'call.dlq' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({
      reason: 'exceeded_max_hold',
      attemptsMade: 1,
      originalJobId: 'original-job-1',
    });
  });
});

describe('createDlqJobHandler — idempotency', () => {
  it('is a no-op when Call.dlqReason is already set (re-run safe)', async () => {
    const { orgId, claimId, callId } = await seedOrgClaimAndCall();
    const handler = createDlqJobHandler({ logger: silentLogger, prisma });

    const payload = buildDlqPayload({
      organizationId: orgId,
      claimId,
      attemptNumber: 1,
      reason: DLQ_REASONS.EXCEEDED_MAX_DURATION,
    });

    // First run: should land
    await handler(dlqJob(payload, 'dlq_test_1'), 'token');
    // Second run: should silently skip
    await handler(dlqJob(payload, 'dlq_test_2'), 'token');

    // Only one call.dlq event survives across re-runs.
    const events = await prisma.callEvent.findMany({
      where: { callId, eventType: 'call.dlq' },
    });
    expect(events).toHaveLength(1);

    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(callAfter.status).toBe('FAILED');
    expect(callAfter.dlqReason).toBe('EXCEEDED_MAX_DURATION');
  });
});

describe('createDlqJobHandler — no Call row (start failed before persist)', () => {
  it('still escalates the claim to MANUAL_REVIEW + emits a structured warn', async () => {
    const { orgId, claimId } = await seedOrgClaimAndCall({ withCall: false });
    const handler = createDlqJobHandler({ logger: silentLogger, prisma });

    await handler(
      dlqJob(
        buildDlqPayload({
          organizationId: orgId,
          claimId,
          attemptNumber: 1,
          reason: DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS,
        }),
      ),
      'token',
    );

    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claimAfter.status).toBe('MANUAL_REVIEW');

    // No Call → no CallEvent.
    const events = await prisma.callEvent.findMany({});
    expect(events).toHaveLength(0);
  });
});

describe('createDlqJobHandler — DLQ reason mapping', () => {
  it.each([
    [DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS, 'EXCEEDED_MAX_ATTEMPTS'],
    [DLQ_REASONS.EXCEEDED_MAX_DURATION, 'EXCEEDED_MAX_DURATION'],
    [DLQ_REASONS.EXCEEDED_MAX_HOLD, 'EXCEEDED_MAX_HOLD'],
    [DLQ_REASONS.CANCELLED_BY_OPERATOR, 'CANCELLED_BY_OPERATOR'],
  ])('maps DlqReason "%s" to Call.dlqReason "%s"', async (reason, expectedEnum) => {
    const { orgId, claimId, callId } = await seedOrgClaimAndCall();
    const handler = createDlqJobHandler({ logger: silentLogger, prisma });
    await handler(
      dlqJob(buildDlqPayload({ organizationId: orgId, claimId, attemptNumber: 1, reason })),
      'token',
    );
    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(callAfter.dlqReason).toBe(expectedEnum);
  });
});

describe('createDlqJobHandler — input validation', () => {
  it('rejects a malformed DLQ payload at the dequeue trust boundary', async () => {
    const handler = createDlqJobHandler({ logger: silentLogger, prisma });
    const malformed = {
      id: 'bad-1',
      data: { reason: 'unknown_reason' } as unknown as DlqJobData,
      name: DLQ_JOB_NAME,
    } as Parameters<ReturnType<typeof createDlqJobHandler>>[0];
    await expect(handler(malformed, 'token')).rejects.toThrow();
  });
});

describe('createDlqJobHandler — does not re-flip MANUAL_REVIEW', () => {
  it('does not write Claim.status if it is already MANUAL_REVIEW', async () => {
    const { orgId, claimId, callId } = await seedOrgClaimAndCall();
    // Pre-flip to MANUAL_REVIEW so we can detect double-write via updatedAt
    // moving forward only on the first DLQ run.
    await prisma.claim.updateMany({
      where: { id: claimId, organizationId: orgId },
      data: { status: 'MANUAL_REVIEW' },
    });
    const before = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });

    const handler = createDlqJobHandler({ logger: silentLogger, prisma });
    await handler(
      dlqJob(
        buildDlqPayload({
          organizationId: orgId,
          claimId,
          attemptNumber: 1,
          reason: DLQ_REASONS.EXCEEDED_MAX_HOLD,
        }),
      ),
      'token',
    );

    const after = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    // Conditional updateMany with `status: { not: 'MANUAL_REVIEW' }` means
    // no row was matched, so updatedAt should NOT have advanced.
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    // Call still got stamped though — the DLQ event landed.
    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(callAfter.dlqReason).toBe('EXCEEDED_MAX_HOLD');
  });
});
