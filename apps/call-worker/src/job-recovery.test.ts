import { createHash, randomUUID } from 'node:crypto';

import { prisma, type CallIntentState, type Prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { FakeRetell } from '@dentabill/payer-ivr';
import { CallJobDataSchema, type JobDispatcher, type DlqJobData } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDlqJobHandler } from './dlq-consumer.js';
import { loadWorkerEnv } from './env.js';
import { createCallJobHandler } from './handler.js';
import { enqueueJobOutbox, relayJobOutbox } from './job-outbox.js';
import { previewJobRecovery, recoverJobOutbox, type JobRecoveryPreview } from './job-recovery.js';

const NOW = new Date('2030-01-01T00:00:00.000Z');
const clock = (): Date => new Date(NOW);
const organizations: string[] = [];

beforeAll(async () => {
  await prisma.$connect();
});
afterEach(async () => {
  for (const organizationId of organizations.splice(0)) {
    await prisma.callIntent.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const organization = await prisma.organization.create({
    data: {
      clerkOrgId: `synthetic_recovery_${randomUUID()}`,
      name: 'Synthetic Recovery Practice',
      npi: '1234567890',
    },
  });
  organizations.push(organization.id);
  const actor = await prisma.user.create({
    data: {
      organizationId: organization.id,
      clerkUserId: `synthetic_actor_${randomUUID()}`,
      email: 'synthetic@example.invalid',
      role: 'OWNER',
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization.id,
      claimNumber: 'SYNTHETIC-RECOVERY-CLAIM',
      subscriberId: 'SYNTHETIC-RECOVERY-MEMBER',
      patientDOBHash: 'synthetic-no-patient',
      payerCode: 'DELTA_DENTAL_PPO',
      cdtCodes: ['D1110'],
      claimAmount: '100.00',
      serviceDate: new Date('2026-10-01T00:00:00.000Z'),
      status: 'IN_QUEUE',
      priority: 80,
    },
  });
  const data = {
    organizationId: organization.id,
    claimId: claim.id,
    payerCode: claim.payerCode,
    attemptNumber: 1,
    claimPriority: 80,
    idempotencyKey: `recovery_${randomUUID()}`,
  };
  const intent = await prisma.callIntent.create({
    data: { ...data, payerCode: claim.payerCode, claimVersion: claim.updatedAt },
  });
  const initial = await enqueueJobOutbox(prisma, {
    organizationId: organization.id,
    kind: 'CALL_PLACE',
    data,
  });
  const where = { id: initial.id, organizationId: organization.id };
  await prisma.jobOutbox.updateMany({
    where,
    data: { state: 'QUARANTINED', deliveryAttempts: 10, lastErrorCode: 'DELIVERY_EXHAUSTED' },
  });
  const row = await prisma.jobOutbox.findFirstOrThrow({ where });
  const options = {
    prisma,
    organizationId: organization.id,
    outboxId: row.id,
    clerkUserId: actor.clerkUserId,
    clock,
  };
  return { organization, actor, claim, intent, data, row, where, options };
}
type Seed = Awaited<ReturnType<typeof seed>>;
async function preview(s: Seed): Promise<JobRecoveryPreview> {
  const result = await previewJobRecovery(s.options);
  if (!result.ok) throw new Error(`Unexpected synthetic preview failure: ${result.code}`);
  return result.preview;
}
async function mutate(s: Seed, review: JobRecoveryPreview, action: 'RETRY' | 'CLOSE' = 'RETRY') {
  return recoverJobOutbox({ ...s.options, action, reviewVersion: review.reviewVersion });
}
async function bind(s: Seed, state: CallIntentState = 'TERMINAL') {
  const call = await prisma.call.create({
    data: {
      organizationId: s.organization.id,
      claimId: s.claim.id,
      retellCallId: `synthetic_retell_${randomUUID()}`,
      status: state === 'TERMINAL' ? 'COMPLETED' : 'INITIATED',
    },
  });
  await prisma.callIntent.updateMany({
    where: { id: s.intent.id, organizationId: s.organization.id },
    data: { state, callId: call.id },
  });
  return call;
}

describe('audited job recovery against PostgreSQL', () => {
  it('fences original and older DLQ generations while allowing the current generation to cancel READY', async () => {
    const s = await seed();
    const dlq = createDlqJobHandler({
      prisma,
      logger: createLogger({ level: 'fatal', pretty: false }),
    });
    const fail = async (transportId: string): Promise<void> => {
      const data: DlqJobData = {
        originalData: s.data,
        originalJobId: transportId,
        originalQueueName: 'calls',
        originalJobName: 'call.place',
        reason: 'exceeded_max_attempts',
        attemptsMade: 3,
        enqueuedAt: NOW.toISOString(),
      };
      await dlq({ id: transportId, data } as Parameters<typeof dlq>[0], 'synthetic-dlq');
    };
    expect((await mutate(s, await preview(s))).ok).toBe(true);
    await fail(s.data.idempotencyKey);
    expect(
      await prisma.callIntent.findFirstOrThrow({
        where: { id: s.intent.id, organizationId: s.organization.id },
      }),
    ).toEqual(s.intent);
    await prisma.jobOutbox.updateMany({
      where: s.where,
      data: { state: 'QUARANTINED', deliveryAttempts: 13 },
    });
    expect((await mutate(s, await preview(s))).ok).toBe(true);
    await fail(`outbox.${s.row.id}.recovery.1`);
    expect(
      await prisma.callIntent.findFirstOrThrow({
        where: { id: s.intent.id, organizationId: s.organization.id },
      }),
    ).toEqual(s.intent);
    await fail(`outbox.${s.row.id}.recovery.2`);
    expect(
      await prisma.callIntent.findFirstOrThrow({
        where: { id: s.intent.id, organizationId: s.organization.id },
      }),
    ).toMatchObject({ state: 'CANCELLED' });
    expect(
      await prisma.auditLog.count({
        where: { organizationId: s.organization.id, action: 'call.intent.cancelled' },
      }),
    ).toBe(1);
  });

  it('blocks early quarantine instead of granting more than three additional attempts', async () => {
    const s = await seed();
    await prisma.jobOutbox.updateMany({ where: s.where, data: { deliveryAttempts: 0 } });
    const review = await preview(s);
    expect(review).toMatchObject({ action: 'BLOCKED', blockedReason: 'DELIVERY_NOT_EXHAUSTED' });
    expect(await mutate(s, review)).toMatchObject({ ok: false, code: 'RECOVERY_BLOCKED' });
    expect(await prisma.jobOutbox.findFirstOrThrow({ where: s.where })).toMatchObject({
      deliveryAttemptLimit: 10,
      deliveryAttempts: 0,
      recoveryCount: 0,
    });
  });

  it('refuses an unvalidated BLOCKED action rather than treating it as closure', async () => {
    const s = await seed();
    await prisma.jobOutbox.updateMany({ where: s.where, data: { state: 'PENDING' } });
    const review = await preview(s);
    expect(
      await recoverJobOutbox({
        ...s.options,
        action: 'BLOCKED' as 'CLOSE',
        reviewVersion: review.reviewVersion,
      }),
    ).toEqual({ ok: false, code: 'RECOVERY_BLOCKED' });
    expect(await prisma.jobOutbox.findFirstOrThrow({ where: s.where })).toMatchObject({
      state: 'PENDING',
      closedAt: null,
    });
  });

  it.each(['submittedAt', 'requestHash'] as const)(
    'refuses a READY intent with leftover %s submission evidence',
    async (field) => {
      const s = await seed();
      await prisma.callIntent.updateMany({
        where: { id: s.intent.id, organizationId: s.organization.id },
        data: field === 'submittedAt' ? { submittedAt: NOW } : { requestHash: '1'.repeat(64) },
      });
      expect(await preview(s)).toMatchObject({
        action: 'BLOCKED',
        blockedReason: 'DOMAIN_BINDING_MISMATCH',
      });
    },
  );

  it('grants one retry allowance under concurrent approval and preserves command and attempt history', async () => {
    const s = await seed();
    const review = await preview(s);
    expect(review).toMatchObject({
      action: 'RETRY',
      blockedReason: null,
      recoveryCount: 0,
      deliveryAttempts: 10,
      deliveryAttemptLimit: 10,
    });
    expect(review.reviewVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(review)).not.toContain(s.data.idempotencyKey);
    expect(review).not.toHaveProperty('payload');
    const results = await Promise.all([mutate(s, review), mutate(s, review)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, code: 'STALE_REVIEW' });
    const row = await prisma.jobOutbox.findFirstOrThrow({ where: s.where });
    expect(row).toMatchObject({
      state: 'PENDING',
      deliveryAttempts: 10,
      deliveryAttemptLimit: 13,
      recoveryCount: 1,
      payload: s.row.payload,
      payloadHash: s.row.payloadHash,
      idempotencyKey: s.row.idempotencyKey,
      availableAt: NOW,
      deliveredAt: null,
    });
    expect(
      await prisma.callIntent.findFirstOrThrow({
        where: { id: s.intent.id, organizationId: s.organization.id },
      }),
    ).toEqual(s.intent);
    expect(
      await prisma.claim.findFirstOrThrow({
        where: { id: s.claim.id, organizationId: s.organization.id },
      }),
    ).toEqual(s.claim);
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: s.organization.id, action: 'jobOutbox.retried' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: s.actor.id, resourceId: s.row.id });
    expect(JSON.stringify(audits)).not.toContain('SYNTHETIC-RECOVERY-MEMBER');
  });

  it('spends only the three approved additional attempts with a stable generation transport ID', async () => {
    const s = await seed();
    expect((await mutate(s, await preview(s))).ok).toBe(true);
    const dispatchCall = vi
      .fn<JobDispatcher['dispatchCall']>()
      .mockRejectedValue(new Error('Synthetic unconfirmed delivery.'));
    const dispatchSummary = vi.fn<JobDispatcher['dispatchSummary']>();
    for (let attempt = 11; attempt <= 13; attempt++) {
      const row = await prisma.jobOutbox.findFirstOrThrow({ where: s.where });
      const report = await relayJobOutbox({
        prisma,
        organizationId: s.organization.id,
        jobDispatcher: { dispatchCall, dispatchSummary },
        clock: () => row.availableAt,
      });
      expect(report.failed).toBe(1);
      expect(report.quarantined).toBe(attempt === 13 ? 1 : 0);
    }
    expect(dispatchCall).toHaveBeenCalledTimes(3);
    for (const args of dispatchCall.mock.calls)
      expect(args).toEqual([
        s.data,
        { priority: 21, transportJobId: `outbox.${s.row.id}.recovery.1` },
      ]);
    const exhausted = await prisma.jobOutbox.findFirstOrThrow({ where: s.where });
    expect(exhausted).toMatchObject({
      state: 'QUARANTINED',
      deliveryAttempts: 13,
      deliveryAttemptLimit: 13,
      recoveryCount: 1,
    });
    expect(
      (
        await relayJobOutbox({
          prisma,
          organizationId: s.organization.id,
          jobDispatcher: { dispatchCall, dispatchSummary },
          clock: () => exhausted.availableAt,
        })
      ).selected,
    ).toBe(0);
    expect((await mutate(s, await preview(s))).ok).toBe(true);
    expect(await prisma.jobOutbox.findFirstOrThrow({ where: s.where })).toMatchObject({
      deliveryAttempts: 13,
      deliveryAttemptLimit: 16,
      recoveryCount: 2,
    });
  });

  it('rolls the allowance and audit back together on an audit write failure', async () => {
    const s = await seed();
    const review = await preview(s);
    const faultDb = prisma.$extends({
      query: {
        auditLog: {
          create({ args, query }) {
            if (args.data.action === 'jobOutbox.retried')
              throw new Error('Synthetic PHI diagnostic must not escape.');
            return query(args);
          },
        },
      },
    });
    expect(
      await recoverJobOutbox({
        ...s.options,
        prisma: faultDb,
        action: 'RETRY',
        reviewVersion: review.reviewVersion,
      }),
    ).toEqual({ ok: false, code: 'RECOVERY_FAILED' });
    expect(await prisma.jobOutbox.findFirstOrThrow({ where: s.where })).toEqual(s.row);
    expect(await prisma.auditLog.count({ where: { organizationId: s.organization.id } })).toBe(0);
  });

  it('requires an actual scoped OWNER/ADMIN and rejects cross-tenant rows', async () => {
    const s = await seed();
    const other = await seed();
    const review = await preview(s);
    expect(await previewJobRecovery({ ...s.options, outboxId: other.row.id })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(
      await previewJobRecovery({ ...s.options, clerkUserId: other.actor.clerkUserId }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    await prisma.user.updateMany({
      where: { id: s.actor.id, organizationId: s.organization.id },
      data: { role: 'BILLING_STAFF' },
    });
    expect(await mutate(s, review)).toEqual({ ok: false, code: 'FORBIDDEN' });
    await prisma.user.updateMany({
      where: { id: s.actor.id, organizationId: s.organization.id },
      data: { role: 'ADMIN' },
    });
    expect((await mutate(s, review)).ok).toBe(true);
  });

  it.each(['claim', 'intent', 'row'] as const)(
    'rejects an approval when the reviewed %s changed',
    async (changed) => {
      const s = await seed();
      const review = await preview(s);
      if (changed === 'claim')
        await prisma.claim.updateMany({
          where: { id: s.claim.id, organizationId: s.organization.id },
          data: { status: 'MANUAL_REVIEW', subscriberId: null },
        });
      if (changed === 'intent')
        await prisma.callIntent.updateMany({
          where: { id: s.intent.id, organizationId: s.organization.id },
          data: { state: 'SUBMITTING' },
        });
      if (changed === 'row')
        await prisma.jobOutbox.updateMany({ where: s.where, data: { deliveryAttempts: 11 } });
      expect(await mutate(s, review)).toMatchObject({ ok: false, code: 'STALE_REVIEW' });
      expect(await prisma.jobOutbox.findFirstOrThrow({ where: s.where })).toMatchObject({
        state: 'QUARANTINED',
        recoveryCount: 0,
      });
    },
  );

  it.each(['PENDING', 'DELIVERED', 'CLOSED'] as const)(
    'does not recover a %s row',
    async (state) => {
      const s = await seed();
      await prisma.jobOutbox.updateMany({ where: s.where, data: { state } });
      const review = await preview(s);
      expect(review).toMatchObject({ action: 'BLOCKED', blockedReason: 'NOT_QUARANTINED' });
      expect(await mutate(s, review)).toMatchObject({ ok: false, code: 'RECOVERY_BLOCKED' });
    },
  );

  it('blocks a live lease and allows an expired lease without resetting domain state', async () => {
    const s = await seed();
    await prisma.jobOutbox.updateMany({
      where: s.where,
      data: { leaseToken: 'synthetic-owner', leaseExpiresAt: new Date(NOW.getTime() + 1) },
    });
    expect(await preview(s)).toMatchObject({ action: 'BLOCKED', blockedReason: 'ACTIVE_LEASE' });
    const options = { ...s.options, clock: () => new Date(NOW.getTime() + 2) };
    const expired = await previewJobRecovery(options);
    if (!expired.ok) throw new Error('Expected expired-lease review.');
    expect(
      (
        await recoverJobOutbox({
          ...options,
          action: 'RETRY',
          reviewVersion: expired.preview.reviewVersion,
        })
      ).ok,
    ).toBe(true);
  });

  it.each(['schema', 'hash', 'tenant', 'key', 'extra', 'binding'] as const)(
    'blocks %s payload corruption without returning the payload',
    async (corruption) => {
      const s = await seed();
      let payload: Prisma.InputJsonValue = s.data;
      let payloadHash = s.row.payloadHash;
      if (corruption === 'schema') payload = { syntheticSecret: 'PHI-MARKER' };
      if (corruption === 'extra') payload = { ...s.data, syntheticSecret: 'PHI-MARKER' };
      if (corruption === 'hash') payloadHash = '0'.repeat(64);
      if (corruption === 'tenant' || corruption === 'key' || corruption === 'binding') {
        payload = {
          ...s.data,
          ...(corruption === 'tenant'
            ? { organizationId: 'synthetic-other' }
            : corruption === 'key'
              ? { idempotencyKey: 'synthetic-other' }
              : { attemptNumber: 2 }),
        };
        payloadHash = createHash('sha256')
          .update(JSON.stringify(CallJobDataSchema.parse(payload)))
          .digest('hex');
      }
      await prisma.jobOutbox.updateMany({ where: s.where, data: { payload, payloadHash } });
      const review = await preview(s);
      expect(review).toMatchObject({
        action: 'BLOCKED',
        blockedReason: corruption === 'binding' ? 'DOMAIN_BINDING_MISMATCH' : 'PAYLOAD_INVALID',
      });
      expect(JSON.stringify(review)).not.toContain('PHI-MARKER');
      expect(await mutate(s, review)).toMatchObject({ ok: false, code: 'RECOVERY_BLOCKED' });
    },
  );

  it.each(['SUBMITTING', 'UNKNOWN', 'ACCEPTED'] as const)(
    'routes %s to its existing call workflow without granting delivery or redial',
    async (state) => {
      const s = await seed();
      const call = state === 'ACCEPTED' ? await bind(s, state) : null;
      if (!call)
        await prisma.callIntent.updateMany({
          where: { id: s.intent.id, organizationId: s.organization.id },
          data: { state },
        });
      const before = await prisma.callIntent.findFirstOrThrow({
        where: { id: s.intent.id, organizationId: s.organization.id },
      });
      const review = await preview(s);
      expect(review.followUp).toEqual({
        kind: state === 'ACCEPTED' ? 'CALL_OBSERVATION' : 'CALL_RECONCILIATION',
        intentId: s.intent.id,
        claimId: s.claim.id,
        callId: call?.id ?? null,
      });
      expect(await mutate(s, review)).toMatchObject({ ok: false, code: 'RECOVERY_BLOCKED' });
      expect(
        await prisma.callIntent.findFirstOrThrow({
          where: { id: s.intent.id, organizationId: s.organization.id },
        }),
      ).toEqual(before);
      expect(await prisma.jobOutbox.findFirstOrThrow({ where: s.where })).toEqual(s.row);
    },
  );

  it.each(['TERMINAL', 'CANCELLED'] as const)(
    'closes a bound %s command without inventing a delivery receipt',
    async (state) => {
      const s = await seed();
      if (state === 'TERMINAL') await bind(s);
      else
        await prisma.callIntent.updateMany({
          where: { id: s.intent.id, organizationId: s.organization.id },
          data: { state },
        });
      const review = await preview(s);
      expect(review.action).toBe('CLOSE');
      expect((await mutate(s, review, 'CLOSE')).ok).toBe(true);
      expect(await prisma.jobOutbox.findFirstOrThrow({ where: s.where })).toMatchObject({
        state: 'CLOSED',
        closedAt: NOW,
        deliveredAt: null,
        deliveryAttempts: 10,
        recoveryCount: 0,
        payloadHash: s.row.payloadHash,
      });
      expect(
        await prisma.auditLog.count({
          where: { organizationId: s.organization.id, action: 'jobOutbox.closed' },
        }),
      ).toBe(1);
    },
  );

  it('blocks summary inference recovery until a scoped existing summary makes closure safe', async () => {
    const s = await seed();
    const call = await bind(s);
    const summaryOutbox = await enqueueJobOutbox(prisma, {
      organizationId: s.organization.id,
      kind: 'SUMMARY_GENERATE',
      data: {
        organizationId: s.organization.id,
        callId: call.id,
        promptVersion: 'v1',
        idempotencyKey: `call.${call.id}`,
      },
    });
    await prisma.jobOutbox.updateMany({
      where: { id: summaryOutbox.id, organizationId: s.organization.id },
      data: { state: 'QUARANTINED' },
    });
    s.options.outboxId = summaryOutbox.id;
    const review = await preview(s);
    expect(review).toMatchObject({ action: 'BLOCKED', blockedReason: 'SUMMARY_RETRY_UNSAFE' });
    expect(await mutate(s, review)).toMatchObject({ ok: false, code: 'RECOVERY_BLOCKED' });
    await prisma.callSummary.create({
      data: {
        organizationId: s.organization.id,
        callId: call.id,
        claimStatus: 'pending',
        nextAction: 'MANUAL_REVIEW',
        rawTranscript: 'SYNTHETIC-PRIVATE-TRANSCRIPT',
        claudeSummary: 'Synthetic summary',
      },
    });
    const done = await preview(s);
    expect(done.action).toBe('CLOSE');
    expect(JSON.stringify(done)).not.toContain('SYNTHETIC-PRIVATE-TRANSCRIPT');
    expect(await mutate(s, review, 'CLOSE')).toMatchObject({ ok: false, code: 'STALE_REVIEW' });
    expect((await mutate(s, done, 'CLOSE')).ok).toBe(true);
  });

  it('keeps one call intent across recovered delivery and a duplicate consumer', async () => {
    const s = await seed();
    expect((await mutate(s, await preview(s))).ok).toBe(true);
    const fake = new FakeRetell({
      retellCallIdFactory: () => `synthetic_no_redial_${randomUUID()}`,
    });
    const env = loadWorkerEnv({
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: 'redis://localhost:6379/14',
      NODE_ENV: 'test',
      RETELL_API_KEY: '',
      WORKER_OUTBOUND_NUMBER: '+15555550100',
    });
    const handler = createCallJobHandler({
      prisma,
      env,
      retellPort: fake,
      observationWindowMs: 0,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
      logger: createLogger({ level: 'fatal', pretty: false }),
    });
    const job = { id: `outbox.${s.row.id}.recovery.1`, data: s.data } as Parameters<
      typeof handler
    >[0];
    expect((await handler(job, 'synthetic-first')).outcome).toBe('RESCHEDULED');
    await handler(job, 'synthetic-duplicate');
    expect(fake.startedCalls).toHaveLength(1);
    expect(await prisma.call.count({ where: { organizationId: s.organization.id } })).toBe(1);
    expect(await prisma.callIntent.count({ where: { organizationId: s.organization.id } })).toBe(1);
  });
});
