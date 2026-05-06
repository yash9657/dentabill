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
  it('flips Claim → RESOLVED when SUMMARIZER_AUTO_TRANSITION_ENABLED=true and confidence ≥ 0.95', async () => {
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

    expect(result.outcome).toBe('AUTO_TRANSITIONED');
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: seeded.claimId } });
    expect(claim.status).toBe('RESOLVED');
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
  it('dispatches a claim.resolved notification when notifier + recipient are wired', async () => {
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
    expect(notifier.deliveries[0]?.template).toBe('claim.resolved');
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
