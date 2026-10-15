import { prisma, type CallIntentState } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { type CallJobData, type DlqJobData, DLQ_JOB_NAME, DLQ_REASONS } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDlqJobHandler } from './dlq-consumer.js';

const silentLogger = createLogger({ level: 'fatal', pretty: false, base: { service: 'test' } });
const handler = createDlqJobHandler({ logger: silentLogger, prisma });

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
afterEach(async () => {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_intent_cancel_audit ON "AuditLog"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_intent_cancel_audit()');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
});

async function seed(
  state: CallIntentState = 'READY',
  withCall = false,
): Promise<{
  orgId: string;
  claimId: string;
  intentId: string;
  callId: string | null;
  data: CallJobData;
}> {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic DLQ Dental', clerkOrgId: `dlq_${crypto.randomUUID()}` },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'SYNTHETIC-DLQ',
      patientDOBHash: 'synthetic',
      cdtCodes: ['D1110'],
      claimAmount: '245',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-01-15'),
      status: 'PENDING',
      priority: 80,
    },
  });
  const queued = await prisma.claim.update({
    where: { id: claim.id, organizationId: org.id },
    data: { status: 'IN_QUEUE' },
  });
  const call = withCall
    ? await prisma.call.create({
        data: {
          organizationId: org.id,
          claimId: claim.id,
          retellCallId: `synthetic_${crypto.randomUUID()}`,
          status: state === 'TERMINAL' ? 'COMPLETED' : 'NAVIGATING_IVR',
          attemptNumber: 1,
        },
      })
    : null;
  const data: CallJobData = {
    organizationId: org.id,
    claimId: claim.id,
    payerCode: 'DELTA_DENTAL_PPO',
    attemptNumber: 1,
    claimPriority: 80,
    idempotencyKey: `${claim.id}-a1-synthetic`,
  };
  const intent = await prisma.callIntent.create({
    data: {
      ...data,
      payerCode: 'DELTA_DENTAL_PPO',
      claimVersion: queued.updatedAt,
      state,
      callId: call?.id ?? null,
      submittedAt: state === 'READY' ? null : new Date('2026-01-15T12:00:00Z'),
    },
  });
  return { orgId: org.id, claimId: claim.id, intentId: intent.id, callId: call?.id ?? null, data };
}

function dlqJob(data: CallJobData): Parameters<typeof handler>[0] {
  const payload: DlqJobData = {
    originalJobId: data.idempotencyKey,
    originalQueueName: 'calls',
    originalJobName: 'call.place',
    originalData: data,
    reason: DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS,
    attemptsMade: 3,
    enqueuedAt: '2026-10-13T12:00:00Z',
    failedReason: 'PHI sentinel: must not enter audit evidence',
  };
  return { id: `dlq-${data.idempotencyKey}`, data: payload, name: DLQ_JOB_NAME } as Parameters<
    typeof handler
  >[0];
}

describe('DLQ cancellation of exact, unsubmitted intents (real Postgres)', () => {
  it('atomically cancels READY and escalates only its reserved claim version, auditing once', async () => {
    const row = await seed();
    await Promise.all([handler(dlqJob(row.data), 'one'), handler(dlqJob(row.data), 'two')]);
    expect(
      await prisma.callIntent.findUniqueOrThrow({ where: { id: row.intentId } }),
    ).toMatchObject({
      state: 'CANCELLED',
      lastErrorCode: 'DELIVERY_EXHAUSTED',
      completedAt: expect.any(Date),
    });
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: row.claimId } })).status).toBe(
      'MANUAL_REVIEW',
    );
    const audits = await prisma.auditLog.findMany({ where: { organizationId: row.orgId } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'call.intent.cancelled', resourceId: row.intentId });
    expect(JSON.stringify(audits)).not.toContain('PHI sentinel');
    expect(await prisma.call.count()).toBe(0);
  });

  it.each(['SUBMITTING', 'UNKNOWN', 'ACCEPTED', 'TERMINAL', 'CANCELLED'] as const)(
    'preserves %s intent, call evidence, and claim state',
    async (state) => {
      const row = await seed(state, true);
      const before = await prisma.callIntent.findUniqueOrThrow({ where: { id: row.intentId } });
      const claim = await prisma.claim.findUniqueOrThrow({ where: { id: row.claimId } });
      const call = await prisma.call.findUniqueOrThrow({ where: { id: row.callId ?? '' } });
      await handler(dlqJob(row.data), 'token');
      expect(await prisma.callIntent.findUniqueOrThrow({ where: { id: row.intentId } })).toEqual(
        before,
      );
      expect(await prisma.claim.findUniqueOrThrow({ where: { id: row.claimId } })).toEqual(claim);
      expect(await prisma.call.findUniqueOrThrow({ where: { id: row.callId ?? '' } })).toEqual(
        call,
      );
      expect(await prisma.auditLog.count()).toBe(0);
      expect(await prisma.callEvent.count()).toBe(0);
    },
  );

  it.each(['RESOLVED', 'IN_QUEUE'] as const)(
    'preserves a newer %s claim version',
    async (status) => {
      const row = await seed();
      const intent = await prisma.callIntent.findUniqueOrThrow({ where: { id: row.intentId } });
      const reviewed = await prisma.claim.update({
        where: { id: row.claimId, organizationId: row.orgId },
        data: { status, updatedAt: new Date(intent.claimVersion.getTime() + 1000) },
      });
      await handler(dlqJob(row.data), 'token');
      expect(await prisma.claim.findUniqueOrThrow({ where: { id: row.claimId } })).toEqual(
        reviewed,
      );
      expect(
        (await prisma.callIntent.findUniqueOrThrow({ where: { id: row.intentId } })).state,
      ).toBe('CANCELLED');
      expect(
        (await prisma.auditLog.findFirstOrThrow({ where: { resourceId: row.intentId } })).metadata,
      ).toMatchObject({ claimChanged: false });
    },
  );

  it('does not select a newer call or intent sharing the prior attempt number', async () => {
    const row = await seed('TERMINAL', true);
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: row.claimId } });
    const newer = await prisma.callIntent.create({
      data: {
        ...row.data,
        payerCode: 'DELTA_DENTAL_PPO',
        idempotencyKey: `${row.claimId}-a1-next-day`,
        claimVersion: claim.updatedAt,
      },
    });
    const call = await prisma.call.findUniqueOrThrow({ where: { id: row.callId ?? '' } });
    await handler(dlqJob(row.data), 'token');
    expect(await prisma.callIntent.findUniqueOrThrow({ where: { id: newer.id } })).toEqual(newer);
    expect(await prisma.call.findUniqueOrThrow({ where: { id: row.callId ?? '' } })).toEqual(call);
    expect(await prisma.claim.findUniqueOrThrow({ where: { id: row.claimId } })).toEqual(claim);
  });

  it('fails closed for missing intents and mismatched claim, payer, attempt, or tenant', async () => {
    const row = await seed();
    const other = await seed();
    const before = await prisma.callIntent.findUniqueOrThrow({ where: { id: row.intentId } });
    for (const data of [
      { ...row.data, idempotencyKey: `${row.data.idempotencyKey}-missing` },
      { ...row.data, claimId: other.claimId },
      { ...row.data, payerCode: 'CIGNA_DENTAL' },
      { ...row.data, attemptNumber: 2 },
      { ...row.data, organizationId: other.orgId },
    ])
      await handler(dlqJob(data), 'token');
    expect(await prisma.callIntent.findUniqueOrThrow({ where: { id: row.intentId } })).toEqual(
      before,
    );
    expect(await prisma.claim.count({ where: { status: 'IN_QUEUE' } })).toBe(2);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('rolls cancellation and claim state back when audit persistence fails', async () => {
    const row = await seed();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_intent_cancel_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'call.intent.cancelled' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_intent_cancel_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_intent_cancel_audit()',
    );
    await expect(handler(dlqJob(row.data), 'token')).rejects.toThrow();
    expect((await prisma.callIntent.findUniqueOrThrow({ where: { id: row.intentId } })).state).toBe(
      'READY',
    );
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: row.claimId } })).status).toBe(
      'IN_QUEUE',
    );
    expect(await prisma.auditLog.count()).toBe(0);
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_intent_cancel_audit ON "AuditLog"');
    await handler(dlqJob(row.data), 'token');
    expect((await prisma.callIntent.findUniqueOrThrow({ where: { id: row.intentId } })).state).toBe(
      'CANCELLED',
    );
  });

  it('rejects malformed transport input before database mutations', async () => {
    const malformed = {
      id: 'bad',
      data: { reason: 'bad' },
      name: DLQ_JOB_NAME,
    } as unknown as Parameters<typeof handler>[0];
    await expect(handler(malformed, 'token')).rejects.toThrow();
    expect(await prisma.auditLog.count()).toBe(0);
  });
});
