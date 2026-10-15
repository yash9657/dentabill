import { prisma, reserveInferenceRun } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import type { SummaryJobData, SummaryJobResult } from '@dentabill/queue';
import { FakeClaude, SummaryValidationError, LiveClaude } from '@dentabill/summarizer';
import type { Job } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadSummaryWorkerEnv, type SummaryWorkerEnv } from './env.js';
import { createSummaryJobHandler, SummaryInferenceBusyError } from './handler.js';

/**
 * Integration tests for the summary-worker handler.
 *
 * Uses real local Postgres for durable inference ownership, receipts, and
 * atomic claim effects. Redis remains only for the legacy-lock regression;
 * inference ownership does not depend on it. All model responses are synthetic.
 */

const silentLogger = createLogger({
  level: 'fatal',
  pretty: false,
  base: { service: 'summary-worker-test' },
});

const baseEnv: SummaryWorkerEnv = loadSummaryWorkerEnv({
  REDIS_URL: 'redis://localhost:6379/15',
  DATABASE_URL: 'postgresql://dentabill:dentabill@localhost:5432/dentabill_test?schema=public',
  ANTHROPIC_API_KEY: '',
  SUMMARIZER_DAILY_TOKEN_BUDGET: '1000000',
  SUMMARIZER_AUTO_TRANSITION_ENABLED: 'false',
});

let redis: Redis;

beforeAll(async () => {
  await prisma.$connect();
  redis = new Redis('redis://localhost:6379/15');
  await redis.flushdb();
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
  );
  await redis.flushdb();
});

const RESOLVED_FIXTURE = {
  claimStatus: 'paid',
  denialReason: null,
  denialCode: null,
  nextAction: 'RESOLVED' as const,
  confidence: 0.97,
  repName: 'Lisa M.',
  referenceNumber: 'REF-9000',
  callbackDate: null,
  amountApprovedCents: 24000,
  notes: null,
};

interface Seeded {
  readonly orgId: string;
  readonly claimId: string;
  readonly callId: string;
}

async function seedOrgClaimCall(): Promise<Seeded> {
  const org = await prisma.organization.create({
    data: { name: 'Acme Dental', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      patientDOBHash: 'h',
      claimNumber: 'CL-SUM-1',
      cdtCodes: ['D2740'],
      claimAmount: '100.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date(),
      status: 'COMPLETED',
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: `rc_test_${Math.random().toString(36).slice(2)}`,
      status: 'COMPLETED',
      attemptNumber: 1,
    },
  });
  await prisma.callEvent.createMany({
    data: [
      {
        callId: call.id,
        eventType: 'call.transcript',
        data: { role: 'agent', text: 'Hi this is the agent' },
      },
      {
        callId: call.id,
        eventType: 'call.transcript',
        data: { role: 'representative', text: 'Yes, that claim was paid in full.' },
      },
      {
        callId: call.id,
        eventType: 'call.ended',
        data: {},
      },
    ],
  });
  return { orgId: org.id, claimId: claim.id, callId: call.id };
}

function jobFor(data: SummaryJobData): Pick<Job<SummaryJobData, SummaryJobResult>, 'id' | 'data'> {
  return { id: `job_summary_${Math.random().toString(36).slice(2)}`, data };
}

function seedRecipient(organizationId: string) {
  return prisma.user.create({
    data: {
      organizationId,
      clerkUserId: `notification-owner-${organizationId}`,
      role: 'OWNER',
      email: 'owner@practice.test',
    },
  });
}

function notificationFor(organizationId: string) {
  return prisma.reviewNotificationIntent.findFirstOrThrow({ where: { organizationId } });
}

describe('createSummaryJobHandler — happy path (kill-switch OFF)', () => {
  it('persists CallSummary, audits, leaves Claim in MANUAL_REVIEW (auto-transition disabled)', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);

    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
    });
    const result = await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: seeded.callId,
        promptVersion: 'v1',
        idempotencyKey: 'sum-1',
      }),
    );

    expect(result.outcome).toBe('MANUAL_REVIEW');
    expect(result.summaryId).not.toBeNull();
    expect(result.tokensUsed).toBeGreaterThan(0);

    const summary = await prisma.callSummary.findFirstOrThrow({
      where: { callId: seeded.callId },
    });
    expect(summary.organizationId).toBe(seeded.orgId);
    expect(summary.nextAction).toBe('RESOLVED');

    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: seeded.claimId } });
    expect(claim.status).toBe('MANUAL_REVIEW');

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: seeded.orgId },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.action)).toContain('callSummary.generate.read');
    expect(audits.map((a) => a.action)).toContain('claim.transition');
  });
});

describe('createSummaryJobHandler — auto-transition ENABLED', () => {
  it('requires review for a paid summary even when automatic transitions are enabled', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);

    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: { ...baseEnv, SUMMARIZER_AUTO_TRANSITION_ENABLED: true },
    });
    const result = await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: seeded.callId,
        promptVersion: 'v1',
        idempotencyKey: 'sum-auto-1',
      }),
    );

    expect(result.outcome).toBe('MANUAL_REVIEW');
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: seeded.claimId } });
    expect(claim.status).toBe('MANUAL_REVIEW');
  });
});

describe('createSummaryJobHandler — cost guard', () => {
  it('returns BUDGET_EXCEEDED when org is over budget for the day', async () => {
    const seeded = await seedOrgClaimCall();
    await prisma.organization.update({
      where: { id: seeded.orgId },
      data: { summaryTokensUsed: 999_999_999, summaryTokensResetAt: new Date() },
    });

    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
    });

    const result = await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: seeded.callId,
        promptVersion: 'v1',
        idempotencyKey: 'sum-budget-1',
      }),
    );

    expect(result.outcome).toBe('BUDGET_EXCEEDED');
    expect(fake.invocations).toHaveLength(0);
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: seeded.orgId, action: 'summary.budget_exceeded' },
    });
    expect(audits).toHaveLength(1);
  });

  it('does not let a stale Redis mutex block durable inference recovery', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
    });

    const day = new Date().toISOString().slice(0, 10);
    await redis.set(`summarize:${seeded.orgId}:${day}`, 'OTHER', 'EX', 60);

    await expect(
      handler(
        jobFor({
          organizationId: seeded.orgId,
          callId: seeded.callId,
          promptVersion: 'v1',
          idempotencyKey: 'sum-lock-1',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'MANUAL_REVIEW' });
  });
});

describe('createSummaryJobHandler — durable review notifications', () => {
  const payload = (seeded: Seeded): SummaryJobData => ({
    organizationId: seeded.orgId,
    callId: seeded.callId,
    promptVersion: 'v1',
    idempotencyKey: `notification.${seeded.callId}`,
  });

  it('persists review intent and a frozen recipient without a notifier or Redis dependency', async () => {
    const seeded = await seedOrgClaimCall();
    const recipient = await seedRecipient(seeded.orgId);
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);

    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      summarizer: fake,
      env: baseEnv,
    });
    await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: seeded.callId,
        promptVersion: 'v1',
        idempotencyKey: 'sum-notify-1',
      }),
    );
    const intent = await notificationFor(seeded.orgId);
    expect(intent).toMatchObject({
      purpose: 'REVIEW_AVAILABLE',
      actorKind: 'SYSTEM',
      recipientUserId: recipient.id,
      recipientRole: 'OWNER',
      recipientEmail: recipient.email,
    });
    expect(intent.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(intent.payload)).not.toContain('CL-SUM-1');
    expect(JSON.stringify(intent.payload)).not.toContain('DELTA_DENTAL_PPO');
    const claim = await prisma.claim.findFirstOrThrow({
      where: { organizationId: seeded.orgId, id: seeded.claimId },
    });
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: seeded.orgId, id: intent.inferenceRunId },
    });
    expect(intent.claimVersion).toEqual(run.claimVersion);
    expect(intent.resultingClaimVersion).toEqual(claim.updatedAt);
    expect(
      await prisma.reviewNotificationDelivery.findFirstOrThrow({
        where: { organizationId: seeded.orgId, notificationId: intent.id },
      }),
    ).toMatchObject({ state: 'PENDING' });
    expect(
      await prisma.reviewNotificationAttempt.count({
        where: { organizationId: seeded.orgId },
      }),
    ).toBe(0);
  });

  it('retains a blocked notification when no eligible recipient exists', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
    });
    await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: seeded.callId,
        promptVersion: 'v1',
        idempotencyKey: 'sum-notify-skip-1',
      }),
    );
    const intent = await notificationFor(seeded.orgId);
    expect(intent.recipientUserId).toBeNull();
    expect(
      await prisma.reviewNotificationDelivery.findFirstOrThrow({
        where: { organizationId: seeded.orgId, notificationId: intent.id },
      }),
    ).toMatchObject({ state: 'BLOCKED' });
  });

  it.each(['intent', 'audit'] as const)(
    'rolls back summary application on notification %s failure and recovers from the saved model receipt',
    async (fault) => {
      const seeded = await seedOrgClaimCall();
      await seedRecipient(seeded.orgId);
      const fake = new FakeClaude();
      fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
      let now = new Date();
      const handler = createSummaryJobHandler({
        logger: silentLogger,
        prisma,
        summarizer: fake,
        env: baseEnv,
        clock: () => now,
      });
      const table = fault === 'intent' ? 'ReviewNotificationIntent' : 'AuditLog';
      const predicate = fault === 'intent' ? 'TRUE' : "NEW.action = 'notification.enqueued'";
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION summary_notification_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'synthetic notification failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER summary_notification_fault BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION summary_notification_fault()`,
      );
      try {
        await expect(handler(jobFor(payload(seeded)))).rejects.toThrow();
        expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(0);
        expect(
          await prisma.reviewNotificationIntent.count({ where: { organizationId: seeded.orgId } }),
        ).toBe(0);
        expect(
          await prisma.claim.findFirstOrThrow({
            where: { organizationId: seeded.orgId, id: seeded.claimId },
          }),
        ).toMatchObject({ status: 'COMPLETED' });
        const run = await prisma.inferenceRun.findFirstOrThrow({
          where: { organizationId: seeded.orgId, callId: seeded.callId },
        });
        expect(run).toMatchObject({ state: 'RESPONDED', summaryId: null, appliedAt: null });
        expect(run.resultPayload).not.toBeNull();
        expect(run.totalTokens).not.toBeNull();
        now = new Date(run.leaseExpiresAt!.getTime() + 1);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER summary_notification_fault ON "${table}"`);
        await prisma.$executeRawUnsafe('DROP FUNCTION summary_notification_fault()');
      }
      expect(await handler(jobFor(payload(seeded)))).toMatchObject({ outcome: 'MANUAL_REVIEW' });
      const intent = await notificationFor(seeded.orgId);
      expect(await handler(jobFor(payload(seeded)))).toMatchObject({
        outcome: 'ALREADY_PROCESSED',
      });
      expect(await notificationFor(seeded.orgId)).toEqual(intent);
      expect(fake.invocations).toHaveLength(1);
      expect(
        await prisma.auditLog.count({
          where: { organizationId: seeded.orgId, action: 'notification.enqueued' },
        }),
      ).toBe(1);
    },
  );

  it.each(['REJECTED', 'UNKNOWN'] as const)(
    'retains %s evidence but blocks its stale notification after an operator changes the claim',
    async (state) => {
      const seeded = await seedOrgClaimCall();
      await seedRecipient(seeded.orgId);
      const fake = new FakeClaude();
      const handler = createSummaryJobHandler({
        logger: silentLogger,
        prisma,
        env: baseEnv,
        summarizer: {
          inference: fake.inference,
          summarize: async () => {
            await prisma.claim.updateMany({
              where: { organizationId: seeded.orgId, id: seeded.claimId },
              data: { status: 'WRITTEN_OFF', updatedAt: new Date(Date.now() + 1000) },
            });
            if (state === 'REJECTED') throw new SummaryValidationError(seeded.callId, [], 37);
            throw new Error('Synthetic unknown model response.');
          },
        },
      });
      expect(await handler(jobFor(payload(seeded)))).toMatchObject({
        outcome: state === 'REJECTED' ? 'DLQ' : 'INFERENCE_REVIEW_REQUIRED',
      });
      const notification = await notificationFor(seeded.orgId);
      const delivery = await prisma.reviewNotificationDelivery.findFirstOrThrow({
        where: { organizationId: seeded.orgId, notificationId: notification.id },
      });
      expect(['BLOCKED', 'SUPPRESSED']).toContain(delivery.state);
      expect(delivery.reason).toBe('SOURCE_CHANGED');
      expect(
        await prisma.claim.findFirstOrThrow({
          where: { organizationId: seeded.orgId, id: seeded.claimId },
        }),
      ).toMatchObject({ status: 'WRITTEN_OFF' });
      expect(
        await prisma.inferenceRun.findFirstOrThrow({
          where: { organizationId: seeded.orgId, id: notification.inferenceRunId },
        }),
      ).toMatchObject({ state, reviewAppliedAt: expect.any(Date) });
    },
  );

  it('does not backfill notification intent when replaying a historical summary', async () => {
    const seeded = await seedOrgClaimCall();
    await prisma.callSummary.create({
      data: {
        organizationId: seeded.orgId,
        callId: seeded.callId,
        claimStatus: 'unknown',
        nextAction: 'MANUAL_REVIEW',
        confidence: 0.5,
        rawTranscript: 'Synthetic historical transcript.',
        claudeSummary: '{}',
      },
    });
    const fake = new FakeClaude();
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      summarizer: fake,
      env: baseEnv,
    });
    expect(await handler(jobFor(payload(seeded)))).toMatchObject({ outcome: 'ALREADY_PROCESSED' });
    expect(fake.invocations).toHaveLength(0);
    expect(
      await prisma.reviewNotificationIntent.count({ where: { organizationId: seeded.orgId } }),
    ).toBe(0);
  });
});

describe('createSummaryJobHandler — unknown call', () => {
  it('returns DLQ when callId does not exist within the org', async () => {
    const seeded = await seedOrgClaimCall();
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: new FakeClaude(),
      env: baseEnv,
    });
    const result = await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: 'call_nonexistent',
        promptVersion: 'v1',
        idempotencyKey: 'sum-missing-1',
      }),
    );
    expect(result.outcome).toBe('DLQ');
  });
});

describe('summary containment under retries and stale evidence', () => {
  function payload(seeded: Seeded): SummaryJobData {
    return {
      organizationId: seeded.orgId,
      callId: seeded.callId,
      promptVersion: 'v1',
      idempotencyKey: 'containment',
    };
  }

  it.each(['paid', 'pending'] as const)(
    'never treats %s wording and RESOLVED advice as payment evidence',
    async (claimStatus) => {
      const seeded = await seedOrgClaimCall();
      const fake = new FakeClaude();
      fake.setDefault('DELTA_DENTAL_PPO', { ...RESOLVED_FIXTURE, claimStatus });
      const handler = createSummaryJobHandler({
        logger: silentLogger,
        prisma,
        redis,
        summarizer: fake,
        env: { ...baseEnv, SUMMARIZER_AUTO_TRANSITION_ENABLED: true },
      });
      await handler(jobFor(payload(seeded)));
      const claim = await prisma.claim.findFirstOrThrow({
        where: { id: seeded.claimId, organizationId: seeded.orgId },
      });
      expect(claim.status).toBe('MANUAL_REVIEW');
    },
  );

  it('preserves operator closure, stores the observation, and suppresses a stale notification', async () => {
    const seeded = await seedOrgClaimCall();
    await prisma.claim.updateMany({
      where: { id: seeded.claimId, organizationId: seeded.orgId },
      data: { status: 'RESOLVED' },
    });
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
    });
    const result = await handler(jobFor(payload(seeded)));
    expect(result.outcome).toBe('STALE_RESULT');
    expect(result.summaryId).not.toBeNull();
    expect(
      (
        await prisma.claim.findFirstOrThrow({
          where: { id: seeded.claimId, organizationId: seeded.orgId },
        })
      ).status,
    ).toBe('RESOLVED');
    expect(
      await prisma.reviewNotificationIntent.count({ where: { organizationId: seeded.orgId } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: seeded.orgId, action: 'claim.transition' },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: seeded.orgId, action: 'summary.transition_skipped' },
      }),
    ).toBe(1);
  });

  it('does not overwrite a same-status claim edit made while inference is running', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', { ...RESOLVED_FIXTURE, nextAction: 'SUBMIT_DOCS' });
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      env: { ...baseEnv, SUMMARIZER_AUTO_TRANSITION_ENABLED: true },
      summarizer: {
        inference: fake.inference,
        summarize: async (input) => {
          await prisma.claim.updateMany({
            where: { id: seeded.claimId, organizationId: seeded.orgId },
            data: { claimAmount: '125.00', updatedAt: new Date('2099-01-01') },
          });
          return fake.summarize(input);
        },
      },
    });
    expect((await handler(jobFor(payload(seeded)))).outcome).toBe('STALE_RESULT');
    const claim = await prisma.claim.findFirstOrThrow({
      where: { id: seeded.claimId, organizationId: seeded.orgId },
    });
    expect(claim.status).toBe('COMPLETED');
    expect(claim.claimAmount.toString()).toBe('125');
  });

  it('does not apply an old call summary after a newer call has completed', async () => {
    const seeded = await seedOrgClaimCall();
    await prisma.call.create({
      data: {
        organizationId: seeded.orgId,
        claimId: seeded.claimId,
        retellCallId: 'newer_call',
        status: 'COMPLETED',
        createdAt: new Date('2099-01-01'),
      },
    });
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
    });
    expect((await handler(jobFor(payload(seeded)))).outcome).toBe('STALE_RESULT');
    expect(
      (
        await prisma.claim.findFirstOrThrow({
          where: { id: seeded.claimId, organizationId: seeded.orgId },
        })
      ).status,
    ).toBe('COMPLETED');
  });

  it('does not overwrite a reviewed claim when validation fails during inference', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      env: baseEnv,
      summarizer: {
        inference: fake.inference,
        summarize: async (input) => {
          await prisma.claim.updateMany({
            where: { id: seeded.claimId, organizationId: seeded.orgId },
            data: { status: 'WRITTEN_OFF' },
          });
          const result = await fake.summarize(input);
          return { ...result, summary: { ...result.summary, confidence: Number.NaN } };
        },
      },
    });
    expect((await handler(jobFor(payload(seeded)))).outcome).toBe('DLQ');
    expect(
      (
        await prisma.claim.findFirstOrThrow({
          where: { id: seeded.claimId, organizationId: seeded.orgId },
        })
      ).status,
    ).toBe('WRITTEN_OFF');
  });

  it('replays a committed summary without another inference, transition, charge, or notification', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
    });
    const first = await handler(jobFor(payload(seeded)));
    const second = await handler(jobFor(payload(seeded)));
    expect(second).toMatchObject({
      summaryId: first.summaryId,
      outcome: 'ALREADY_PROCESSED',
      tokensUsed: 0,
    });
    expect(fake.invocations).toHaveLength(1);
    expect(
      await prisma.reviewNotificationIntent.count({ where: { organizationId: seeded.orgId } }),
    ).toBe(1);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: seeded.orgId } }))
        .summaryTokensUsed,
    ).toBe(first.tokensUsed);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: seeded.orgId, action: 'claim.transition' },
      }),
    ).toBe(1);
  });

  it('keeps the durable receipt and usage when summary application rolls back, then resumes without inference', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    let now = new Date();
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
      clock: () => now,
    });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION summary_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'claim.transition' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER summary_test_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION summary_test_fail_audit()`,
    );
    try {
      await expect(handler(jobFor(payload(seeded)))).rejects.toThrow();
      expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(0);
      expect(
        (
          await prisma.claim.findFirstOrThrow({
            where: { id: seeded.claimId, organizationId: seeded.orgId },
          })
        ).status,
      ).toBe('COMPLETED');
      const run = await prisma.inferenceRun.findFirstOrThrow({
        where: { organizationId: seeded.orgId, callId: seeded.callId },
      });
      expect(run.state).toBe('RESPONDED');
      expect(run.resultPayload).not.toBeNull();
      expect(run.totalTokens).not.toBeNull();
      expect(
        (await prisma.organization.findUniqueOrThrow({ where: { id: seeded.orgId } }))
          .summaryTokensUsed,
      ).toBe(Number(run.totalTokens));
      expect(fake.invocations).toHaveLength(1);
      now = new Date((run.leaseExpiresAt?.getTime() ?? now.getTime()) + 1);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER summary_test_fail_audit ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION summary_test_fail_audit()`);
    }
    await prisma.claim.updateMany({
      where: { id: seeded.claimId, organizationId: seeded.orgId },
      data: { status: 'WRITTEN_OFF' },
    });
    await prisma.callEvent.deleteMany({
      where: { callId: seeded.callId, call: { organizationId: seeded.orgId } },
    });
    expect((await handler(jobFor(payload(seeded)))).outcome).toBe('STALE_RESULT');
    expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(1);
    expect(fake.invocations).toHaveLength(1);
    expect(
      (
        await prisma.claim.findFirstOrThrow({
          where: { id: seeded.claimId, organizationId: seeded.orgId },
        })
      ).status,
    ).toBe('WRITTEN_OFF');
  });
});

describe('unfinished transcript containment', () => {
  it('waits for terminal call state without persisting or charging for a partial summary', async () => {
    const seeded = await seedOrgClaimCall();
    await prisma.call.updateMany({
      where: { id: seeded.callId, organizationId: seeded.orgId },
      data: { status: 'HUMAN_REACHED' },
    });
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
    });
    const data = {
      organizationId: seeded.orgId,
      callId: seeded.callId,
      promptVersion: 'v1',
      idempotencyKey: 'partial',
    };
    expect((await handler(jobFor(data))).outcome).toBe('CALL_NOT_TERMINAL');
    expect(fake.invocations).toHaveLength(0);
    expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(0);
    await prisma.call.updateMany({
      where: { id: seeded.callId, organizationId: seeded.orgId },
      data: { status: 'COMPLETED' },
    });
    expect((await handler(jobFor(data))).outcome).toBe('MANUAL_REVIEW');
    expect(fake.invocations).toHaveLength(1);
  });
});

describe('unmapped code preservation', () => {
  it('retains the raw code as evidence and requires review instead of losing the summary', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', {
      ...RESOLVED_FIXTURE,
      denialCode: 'PLAN-X7',
      nextAction: 'SUBMIT_DOCS',
    });
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: { ...baseEnv, SUMMARIZER_AUTO_TRANSITION_ENABLED: true },
    });
    const result = await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: seeded.callId,
        promptVersion: 'v1',
        idempotencyKey: 'unmapped',
      }),
    );
    expect(result.outcome).toBe('MANUAL_REVIEW');
    const summary = await prisma.callSummary.findFirstOrThrow({
      where: { callId: seeded.callId, organizationId: seeded.orgId },
    });
    expect(summary.denialCode).toBe('PLAN-X7');
    expect(
      (
        await prisma.claim.findFirstOrThrow({
          where: { id: seeded.claimId, organizationId: seeded.orgId },
        })
      ).status,
    ).toBe('MANUAL_REVIEW');
    const transition = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: seeded.orgId, action: 'claim.transition' },
    });
    expect(transition.metadata).toMatchObject({ reason: 'UNMAPPED_CODE', autoTransitioned: false });
  });
});

describe('canonical final provider transcript', () => {
  it('uses final source text once and preserves it exactly despite later cumulative snapshots', async () => {
    const seeded = await seedOrgClaimCall();
    const text = '  Agent: Hello.\nUser: Payment is unverified.\n\n';
    await prisma.callEvent.createMany({
      data: [
        {
          callId: seeded.callId,
          eventType: 'webhook.call.ended',
          data: { transcript: { text, turns: null } },
          timestamp: new Date('2026-10-13T12:00:00Z'),
        },
        {
          callId: seeded.callId,
          eventType: 'webhook.call.transcript_snapshot',
          data: { transcript: { text: 'STALE SNAPSHOT', turns: null } },
          timestamp: new Date('2026-10-13T12:01:00Z'),
        },
        { callId: seeded.callId, eventType: 'tool.result', data: { text: 'MODEL OUTPUT' } },
      ],
    });
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
    });
    const result = await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: seeded.callId,
        promptVersion: 'v1',
        idempotencyKey: 'canonical-final',
      }),
    );
    expect(result.summaryId).not.toBeNull();
    expect(fake.invocations).toHaveLength(1);
    expect(fake.invocations[0]?.transcriptTurns).toEqual([
      { role: 'source', text, timestamp: new Date('2026-10-13T12:00:00Z') },
    ]);
    expect(
      await prisma.callSummary.findFirstOrThrow({
        where: { organizationId: seeded.orgId, callId: seeded.callId },
      }),
    ).toMatchObject({ rawTranscript: text });
  });

  it('preserves structured final turns and distinguishes remote speech from confirmed human speech', async () => {
    const seeded = await seedOrgClaimCall();
    await prisma.callEvent.create({
      data: {
        callId: seeded.callId,
        eventType: 'webhook.call.ended',
        data: {
          transcript: {
            text: null,
            turns: [
              { role: 'agent', text: '  Hello. ', startOffsetSeconds: 0 },
              { role: 'user', text: 'Press 1.\n', startOffsetSeconds: 2.5 },
            ],
          },
        },
      },
    });
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
    });
    await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: seeded.callId,
        promptVersion: 'v1',
        idempotencyKey: 'structured-final',
      }),
    );
    expect(fake.invocations[0]?.transcriptTurns.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'agent', text: '  Hello. ' },
      { role: 'remote', text: 'Press 1.\n' },
    ]);
  });

  it.each([
    { eventType: 'webhook.call.ended', data: {} },
    { eventType: 'webhook.call.ended', data: { transcript: { text: '', turns: [] } } },
    {
      eventType: 'webhook.call.transcript_snapshot',
      data: { transcript: { text: 'Provisional only', turns: null } },
    },
  ])(
    'abstains on missing, empty, or provisional evidence without inference or financial effects (%j)',
    async (source) => {
      const seeded = await seedOrgClaimCall();
      await prisma.callEvent.create({ data: { callId: seeded.callId, ...source } });
      const fake = new FakeClaude();
      fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
      const handler = createSummaryJobHandler({
        logger: silentLogger,
        prisma,
        redis,
        summarizer: fake,
        env: baseEnv,
      });
      const result = await handler(
        jobFor({
          organizationId: seeded.orgId,
          callId: seeded.callId,
          promptVersion: 'v1',
          idempotencyKey: 'unavailable-final',
        }),
      );
      expect(result).toMatchObject({
        outcome: 'TRANSCRIPT_UNAVAILABLE',
        summaryId: null,
        tokensUsed: 0,
      });
      expect(fake.invocations).toHaveLength(0);
      expect(
        await prisma.callSummary.count({
          where: { organizationId: seeded.orgId, callId: seeded.callId },
        }),
      ).toBe(0);
      expect(
        await prisma.claim.findFirstOrThrow({
          where: { id: seeded.claimId, organizationId: seeded.orgId },
        }),
      ).toMatchObject({ status: 'COMPLETED' });
      expect(
        await prisma.organization.findUniqueOrThrow({ where: { id: seeded.orgId } }),
      ).toMatchObject({ summaryTokensUsed: 0 });
    },
  );
});

describe('durable inference admission and receipts', () => {
  function payload(seeded: Seeded): SummaryJobData {
    return {
      organizationId: seeded.orgId,
      callId: seeded.callId,
      promptVersion: 'v1',
      idempotencyKey: `call.${seeded.callId}`,
    };
  }
  it('blocks even an explicitly injected unapproved live adapter before reservation or network', async () => {
    const seeded = await seedOrgClaimCall();
    const loader = vi.fn(async () => {
      throw new Error('Synthetic loader must not run.');
    });
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      summarizer: new LiveClaude({ apiKey: 'synthetic-key', anthropicLoader: loader }),
      env: baseEnv,
    });
    expect(await handler(jobFor(payload(seeded)))).toMatchObject({
      outcome: 'PROVIDER_DISABLED',
      tokensUsed: 0,
    });
    expect(loader).not.toHaveBeenCalled();
    expect(await prisma.inferenceRun.count({ where: { organizationId: seeded.orgId } })).toBe(0);
  });

  it('settles known invalid-output usage once and never regenerates under a fresh delivery key', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    const summarize = vi.fn(async (input: Parameters<FakeClaude['summarize']>[0]) => {
      throw new SummaryValidationError(
        input.callId,
        [{ path: 'private', message: 'private invalid content' }],
        55,
      );
    });
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      summarizer: { inference: fake.inference, summarize },
      env: baseEnv,
    });
    expect(await handler(jobFor(payload(seeded)))).toMatchObject({
      outcome: 'DLQ',
      tokensUsed: 55,
    });
    expect(
      await handler(
        jobFor({ ...payload(seeded), idempotencyKey: `call.${seeded.callId}.retry.1` }),
      ),
    ).toMatchObject({ outcome: 'INFERENCE_REVIEW_REQUIRED', tokensUsed: 55 });
    expect(summarize).toHaveBeenCalledTimes(1);
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: seeded.orgId, callId: seeded.callId },
    });
    expect(run).toMatchObject({ state: 'REJECTED', totalTokens: 55n, reservedTokens: 0n });
    const budget = await prisma.inferenceBudget.findFirstOrThrow({
      where: { organizationId: seeded.orgId },
    });
    expect(budget).toMatchObject({ knownTokens: 55n, reservedTokens: 0n });
    expect(
      JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId: seeded.orgId } })),
    ).not.toContain('private invalid content');
  });

  it('retains unknown spend across UTC days without resubmitting after an ambiguous provider failure', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    let now = new Date('2026-10-13T23:59:59Z');
    const summarize = vi.fn(async () => {
      throw new Error('Private provider response was lost.');
    });
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      summarizer: { inference: fake.inference, summarize },
      env: baseEnv,
      clock: () => now,
    });
    expect(await handler(jobFor(payload(seeded)))).toMatchObject({
      outcome: 'INFERENCE_REVIEW_REQUIRED',
      tokensUsed: null,
    });
    const original = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: seeded.orgId, callId: seeded.callId },
    });
    expect(original.state).toBe('UNKNOWN');
    expect(original.totalTokens).toBeNull();
    expect(original.reservedTokens).toBeGreaterThan(0n);
    now = new Date('2026-10-15T00:00:00Z');
    expect(
      await handler(
        jobFor({ ...payload(seeded), idempotencyKey: `call.${seeded.callId}.retry.2` }),
      ),
    ).toMatchObject({ outcome: 'INFERENCE_REVIEW_REQUIRED', tokensUsed: null });
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(await prisma.inferenceRun.count({ where: { organizationId: seeded.orgId } })).toBe(1);
    expect(
      (
        await prisma.inferenceRun.findFirstOrThrow({
          where: { id: original.id, organizationId: seeded.orgId },
        })
      ).reservedTokens,
    ).toBe(original.reservedTokens);
    expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(0);
  });

  it('does not apply valid-looking output with missing usage or report its cost as zero', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const summarize = vi.fn(async (input: Parameters<FakeClaude['summarize']>[0]) => ({
      ...(await fake.summarize(input)),
      tokensUsed: null,
    }));
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      summarizer: { inference: fake.inference, summarize },
      env: baseEnv,
    });
    expect(await handler(jobFor(payload(seeded)))).toMatchObject({
      outcome: 'INFERENCE_REVIEW_REQUIRED',
      tokensUsed: null,
    });
    expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(0);
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: seeded.orgId, callId: seeded.callId },
    });
    expect(run).toMatchObject({
      state: 'UNKNOWN',
      totalTokens: null,
      lastErrorCode: 'USAGE_UNKNOWN',
    });
    expect(run.reservedTokens).toBeGreaterThan(0n);
  });

  it.each(
    (['REJECTED', 'UNKNOWN'] as const).flatMap((state) =>
      (['domain', 'notification'] as const).map((fault) => ({ state, fault })),
    ),
  )(
    'replays $state review effects atomically after $fault audit failure without resubmitting',
    async ({ state, fault }) => {
      const seeded = await seedOrgClaimCall();
      await seedRecipient(seeded.orgId);
      const fake = new FakeClaude();
      const summarize = vi.fn(async () => {
        if (state === 'REJECTED') throw new SummaryValidationError(seeded.callId, [], 37);
        throw new Error('Synthetic response lost.');
      });
      const handler = createSummaryJobHandler({
        logger: silentLogger,
        prisma,
        summarizer: { inference: fake.inference, summarize },
        env: baseEnv,
      });
      const predicate =
        fault === 'notification'
          ? "NEW.action = 'notification.enqueued'"
          : "NEW.action IN ('summary.dlq', 'summary.inference_review_required')";
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION summary_test_fail_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'synthetic review failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER summary_test_fail_review BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION summary_test_fail_review()`,
      );
      try {
        await expect(handler(jobFor(payload(seeded)))).rejects.toThrow();
        expect(
          await prisma.inferenceRun.findFirstOrThrow({ where: { organizationId: seeded.orgId } }),
        ).toMatchObject({
          state,
          reviewAppliedAt: null,
          totalTokens: state === 'REJECTED' ? 37n : null,
        });
        expect(
          await prisma.claim.findFirstOrThrow({
            where: { id: seeded.claimId, organizationId: seeded.orgId },
          }),
        ).toMatchObject({ status: 'COMPLETED' });
        expect(
          await prisma.auditLog.count({
            where: { organizationId: seeded.orgId, action: 'inference.review_applied' },
          }),
        ).toBe(0);
        expect(
          await prisma.reviewNotificationIntent.count({ where: { organizationId: seeded.orgId } }),
        ).toBe(0);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER summary_test_fail_review ON "AuditLog"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION summary_test_fail_review()`);
      }
      // Frozen evidence remains usable even if the live transcript is no longer present.
      await prisma.callEvent.deleteMany({ where: { callId: seeded.callId } });
      for (const attempt of [1, 2]) {
        expect(
          await handler(
            jobFor({ ...payload(seeded), idempotencyKey: `review-retry.${String(attempt)}` }),
          ),
        ).toMatchObject({
          outcome: 'INFERENCE_REVIEW_REQUIRED',
          tokensUsed: state === 'REJECTED' ? 37 : null,
        });
      }
      expect(summarize).toHaveBeenCalledTimes(1);
      expect(
        await prisma.claim.findFirstOrThrow({
          where: { id: seeded.claimId, organizationId: seeded.orgId },
        }),
      ).toMatchObject({ status: 'MANUAL_REVIEW' });
      expect(
        (await prisma.inferenceRun.findFirstOrThrow({ where: { organizationId: seeded.orgId } }))
          .reviewAppliedAt,
      ).not.toBeNull();
      expect(
        await prisma.auditLog.count({
          where: { organizationId: seeded.orgId, action: 'inference.review_applied' },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { organizationId: seeded.orgId, action: 'inference.snapshot.read' },
        }),
      ).toBe(2);
      const notification = await notificationFor(seeded.orgId);
      expect(notification).toMatchObject({
        purpose: 'INFERENCE_REVIEW_REQUIRED',
        actorKind: 'SYSTEM',
      });
      expect(notification.resultingClaimVersion).toEqual(
        (
          await prisma.claim.findFirstOrThrow({
            where: { organizationId: seeded.orgId, id: seeded.claimId },
          })
        ).updatedAt,
      );
      expect(
        await prisma.reviewNotificationDelivery.findFirstOrThrow({
          where: { organizationId: seeded.orgId, notificationId: notification.id },
        }),
      ).toMatchObject({ state: 'SUPPRESSED', reason: 'SOURCE_CHANGED' });
      expect(
        await prisma.reviewNotificationIntent.count({ where: { organizationId: seeded.orgId } }),
      ).toBe(1);
      expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(0);
      expect(
        (await prisma.inferenceBudget.findFirstOrThrow({ where: { organizationId: seeded.orgId } }))
          .knownTokens,
      ).toBe(state === 'REJECTED' ? 37n : 0n);
    },
  );

  it('enforces the original token allowance when a reserved invocation resumes under a larger configuration', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    let now = new Date();
    let usage = 0;
    const summarize = vi.fn(async (input: Parameters<FakeClaude['summarize']>[0]) => ({
      ...(await fake.summarize(input)),
      tokensUsed: usage,
    }));
    const deps = {
      logger: silentLogger,
      prisma,
      summarizer: { inference: fake.inference, summarize },
      clock: () => now,
    };
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION summary_test_fail_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic pre-submission failure'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER summary_test_fail_attempt BEFORE INSERT ON "InferenceAttempt" FOR EACH ROW EXECUTE FUNCTION summary_test_fail_attempt()`,
    );
    try {
      await expect(
        createSummaryJobHandler({ ...deps, env: baseEnv })(jobFor(payload(seeded))),
      ).rejects.toThrow();
      const run = await prisma.inferenceRun.findFirstOrThrow({
        where: { organizationId: seeded.orgId },
      });
      expect(run.state).toBe('RESERVED');
      expect(summarize).not.toHaveBeenCalled();
      usage = Number(run.tokenAllowance) + 1;
      now = new Date((run.leaseExpiresAt?.getTime() ?? now.getTime()) + 1);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER summary_test_fail_attempt ON "InferenceAttempt"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION summary_test_fail_attempt()`);
    }
    expect(
      await createSummaryJobHandler({
        ...deps,
        env: { ...baseEnv, SUMMARIZER_MAX_OUTPUT_TOKENS: 100_000 },
      })(jobFor(payload(seeded))),
    ).toMatchObject({ outcome: 'DLQ', tokensUsed: usage });
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(
      await prisma.inferenceRun.findFirstOrThrow({ where: { organizationId: seeded.orgId } }),
    ).toMatchObject({
      state: 'REJECTED',
      lastErrorCode: 'TOKEN_BOUND_EXCEEDED',
      totalTokens: BigInt(usage),
    });
    expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(0);
  });

  it('does not resume a frozen run belonging to a different provider release through the synthetic adapter', async () => {
    const seeded = await seedOrgClaimCall();
    const claim = await prisma.claim.findFirstOrThrow({
      where: { id: seeded.claimId, organizationId: seeded.orgId },
    });
    await reserveInferenceRun(prisma, {
      organizationId: seeded.orgId,
      callId: seeded.callId,
      claimId: seeded.claimId,
      claimVersion: claim.updatedAt,
      sourceHash: 'a'.repeat(64),
      requestHash: 'b'.repeat(64),
      provider: 'FIREWORKS',
      releaseId: 'unapproved-fixture',
      promptVersion: 'v1',
      requestPayload: {},
      reservationTokens: 100,
      dailyTokenLimit: 1000,
    });
    const fake = new FakeClaude();
    await expect(
      createSummaryJobHandler({
        logger: silentLogger,
        prisma,
        summarizer: fake,
        env: baseEnv,
      })(jobFor(payload(seeded))),
    ).rejects.toMatchObject({ code: 'SUMMARY_INFERENCE_BUSY' });
    expect(fake.invocations).toHaveLength(0);
    expect(await prisma.inferenceAttempt.count({ where: { organizationId: seeded.orgId } })).toBe(
      0,
    );
    expect(
      await prisma.inferenceRun.findFirstOrThrow({ where: { organizationId: seeded.orgId } }),
    ).toMatchObject({ state: 'RESERVED', provider: 'FIREWORKS' });
  });

  it('locks the organization before summary writes while another call on the same claim requires review', async () => {
    const seeded = await seedOrgClaimCall();
    const acceptedCall = await prisma.call.findFirstOrThrow({
      where: { id: seeded.callId, organizationId: seeded.orgId },
    });
    const rejectedCall = await prisma.call.create({
      data: {
        organizationId: seeded.orgId,
        claimId: seeded.claimId,
        retellCallId: 'synthetic-concurrent-review',
        status: 'COMPLETED',
        createdAt: new Date(acceptedCall.createdAt.getTime() - 1000),
      },
    });
    await prisma.callEvent.createMany({
      data: [
        {
          callId: rejectedCall.id,
          eventType: 'call.transcript',
          data: { role: 'representative', text: 'Synthetic review evidence.' },
        },
        { callId: rejectedCall.id, eventType: 'call.ended', data: {} },
      ],
    });
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', { ...RESOLVED_FIXTURE, nextAction: 'SUBMIT_DOCS' });
    const valid = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      summarizer: fake,
      env: { ...baseEnv, SUMMARIZER_AUTO_TRANSITION_ENABLED: true },
    });
    const invalid = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      summarizer: {
        inference: fake.inference,
        summarize: async () => {
          throw new SummaryValidationError(rejectedCall.id, [], 37);
        },
      },
      env: baseEnv,
    });
    const work: Promise<SummaryJobResult>[] = [];
    const key = 261338;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION summary_test_block_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(261338); RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER summary_test_block_insert BEFORE INSERT ON "CallSummary" FOR EACH ROW EXECUTE FUNCTION summary_test_block_insert()`,
    );
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key})::text`;
          work.push(valid(jobFor(payload(seeded))));
          await vi.waitFor(
            async () => {
              const rows = await prisma.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_locks
            WHERE locktype = 'advisory' AND objid::bigint = ${BigInt(key)} AND NOT granted
          `;
              expect(rows[0]?.waiting).toBeGreaterThan(0);
            },
            { timeout: 3000, interval: 20 },
          );
          // This lock conflicts with the explicit parent lock, but is compatible
          // with the FK KEY SHARE lock a child insert alone would otherwise hold.
          await expect(prisma.$queryRaw`
          SELECT "id" FROM "Organization" WHERE "id" = ${seeded.orgId} FOR NO KEY UPDATE NOWAIT
        `).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
          work.push(
            invalid(
              jobFor({
                ...payload(seeded),
                callId: rejectedCall.id,
                idempotencyKey: 'concurrent-review',
              }),
            ),
          );
        },
        { timeout: 5000 },
      );
      const results = await Promise.all(work);
      expect(results[0]).toMatchObject({ outcome: 'AUTO_TRANSITIONED' });
      expect(results[1]).toMatchObject({ outcome: 'DLQ' });
      expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(1);
      expect(
        await prisma.claim.findFirstOrThrow({
          where: { id: seeded.claimId, organizationId: seeded.orgId },
        }),
      ).toMatchObject({ status: 'NEEDS_INFO' });
      expect(
        await prisma.inferenceRun.findFirstOrThrow({
          where: { organizationId: seeded.orgId, callId: rejectedCall.id },
        }),
      ).toMatchObject({ state: 'REJECTED', reviewAppliedAt: expect.any(Date) });
    } finally {
      await Promise.allSettled(work);
      await prisma.$executeRawUnsafe(`DROP TRIGGER summary_test_block_insert ON "CallSummary"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION summary_test_block_insert()`);
    }
  });

  it('admits one inference across concurrent worker instances and distinct transport retry keys', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const summarize = vi.fn(async (input: Parameters<FakeClaude['summarize']>[0]) => {
      enter();
      await gate;
      return fake.summarize(input);
    });
    const deps = {
      logger: silentLogger,
      prisma,
      summarizer: { inference: fake.inference, summarize },
      env: baseEnv,
    };
    const first = createSummaryJobHandler(deps)(jobFor(payload(seeded)));
    await entered;
    try {
      const run = await prisma.inferenceRun.findFirstOrThrow({
        where: { organizationId: seeded.orgId, callId: seeded.callId },
      });
      expect(run.state).toBe('SUBMITTING');
      expect(
        await prisma.inferenceAttempt.count({
          where: { organizationId: seeded.orgId, runId: run.id },
        }),
      ).toBe(1);
      await expect(
        createSummaryJobHandler(deps)(
          jobFor({ ...payload(seeded), idempotencyKey: `call.${seeded.callId}.retry.1` }),
        ),
      ).rejects.toBeInstanceOf(SummaryInferenceBusyError);
    } finally {
      release();
    }
    expect((await first).outcome).toBe('MANUAL_REVIEW');
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(1);
  });
});
