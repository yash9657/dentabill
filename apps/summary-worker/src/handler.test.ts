import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { FakeResend } from '@dentabill/notifier';
import type { SummaryJobData, SummaryJobResult } from '@dentabill/queue';
import { FakeClaude } from '@dentabill/summarizer';
import type { Job } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadSummaryWorkerEnv, type SummaryWorkerEnv } from './env.js';
import { createSummaryJobHandler } from './handler.js';

/**
 * Integration tests for the summary-worker handler.
 *
 * Hits the real `dentabill_test` Postgres + a dedicated Redis DB index
 * so the cost-guard lock, multi-tenant scope, and CallSummary INSERT
 * layers run exactly as in production. The summarizer is `FakeClaude`
 * so we don't pay for real Anthropic calls.
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

  it('throws (BullMQ retry path) when another worker holds the cost-guard lock', async () => {
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
    ).rejects.toThrow(/lock contention/);
  });
});

describe('createSummaryJobHandler — notifier dispatch (P4-T6)', () => {
  it('dispatches review-required notification for a payer-reported payment', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const notifier = new FakeResend();

    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
      notifier,
      resolveRecipient: () => Promise.resolve('owner@practice.test'),
    });
    await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: seeded.callId,
        promptVersion: 'v1',
        idempotencyKey: 'sum-notify-1',
      }),
    );
    expect(notifier.deliveries).toHaveLength(1);
    expect(notifier.deliveries[0]?.template).toBe('summary.review_required');
    expect(notifier.deliveries[0]?.to).toBe('owner@practice.test');
  });

  it('skips notification when resolveRecipient returns null', async () => {
    const seeded = await seedOrgClaimCall();
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_FIXTURE);
    const notifier = new FakeResend();
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
      notifier,
      resolveRecipient: () => Promise.resolve(null),
    });
    await handler(
      jobFor({
        organizationId: seeded.orgId,
        callId: seeded.callId,
        promptVersion: 'v1',
        idempotencyKey: 'sum-notify-skip-1',
      }),
    );
    expect(notifier.deliveries).toHaveLength(0);
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
    const notifier = new FakeResend();
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
      notifier,
      resolveRecipient: async () => 'owner@practice.test',
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
    expect(notifier.deliveries).toHaveLength(0);
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
    const notifier = new FakeResend();
    const handler = createSummaryJobHandler({
      logger: silentLogger,
      prisma,
      redis,
      summarizer: fake,
      env: baseEnv,
      notifier,
      resolveRecipient: async () => 'owner@practice.test',
    });
    const first = await handler(jobFor(payload(seeded)));
    const second = await handler(jobFor(payload(seeded)));
    expect(second).toMatchObject({
      summaryId: first.summaryId,
      outcome: 'ALREADY_PROCESSED',
      tokensUsed: 0,
    });
    expect(fake.invocations).toHaveLength(1);
    expect(notifier.deliveries).toHaveLength(1);
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

  it('rolls back summary, claim, and usage if transition audit fails, then recovers on retry', async () => {
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
      expect(
        (await prisma.organization.findUniqueOrThrow({ where: { id: seeded.orgId } }))
          .summaryTokensUsed,
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER summary_test_fail_audit ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION summary_test_fail_audit()`);
    }
    expect((await handler(jobFor(payload(seeded)))).outcome).toBe('MANUAL_REVIEW');
    expect(await prisma.callSummary.count({ where: { organizationId: seeded.orgId } })).toBe(1);
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
