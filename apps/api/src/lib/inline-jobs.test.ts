/**
 * Integration tests for the inline job runtime (ADR-053) against the real
 * test Postgres. Retell and Claude are the in-process fakes, injected so a
 * developer `.env` with live keys can never leak into the run.
 */
import { hashPatientDOB, prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { FakeRetell } from '@dentabill/payer-ivr';
import type { CallJobData, JobDispatcher, SummaryJobData } from '@dentabill/queue';
import { createSummarizerPort } from '@dentabill/summarizer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createInlineJobRuntime, type CreateInlineJobRuntimeDeps } from './inline-jobs.js';

const silentLogger = createLogger({ level: 'fatal', pretty: false, base: { service: 'test' } });

const TEST_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused',
  RETELL_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  WORKER_OUTBOUND_NUMBER: '+15555550100',
  SUMMARIZER_AUTO_TRANSITION_ENABLED: 'true',
};

function fakeDispatcher(): JobDispatcher & {
  dispatchSummary: ReturnType<typeof vi.fn>;
  dispatchCall: ReturnType<typeof vi.fn>;
} {
  return {
    mode: 'inline',
    dispatchCall: vi.fn(async (d: CallJobData) => d.idempotencyKey),
    dispatchSummary: vi.fn(async (d: SummaryJobData) => d.idempotencyKey),
  };
}

function runtimeWith(overrides: Partial<CreateInlineJobRuntimeDeps> = {}): {
  runtime: ReturnType<typeof createInlineJobRuntime>;
  retell: FakeRetell;
  retellCallId: string;
  dispatcher: ReturnType<typeof fakeDispatcher>;
} {
  const retellCallId = `fake_inline_${Math.random().toString(36).slice(2)}`;
  const retell = new FakeRetell({ retellCallIdFactory: () => retellCallId });
  const dispatcher = fakeDispatcher();
  const runtime = createInlineJobRuntime({
    jobDispatcher: dispatcher,
    redis: null,
    logger: silentLogger,
    env: TEST_ENV,
    retellPort: retell,
    summarizer: createSummarizerPort({ deriveWhenUnregistered: true }).summarizer,
    sleep: async () => undefined,
    ...overrides,
  });
  return { runtime, retell, retellCallId, dispatcher };
}

async function seed(opts: { npi?: string | null; status?: 'IN_QUEUE' | 'PENDING' } = {}): Promise<{
  orgId: string;
  claimId: string;
  data: CallJobData;
}> {
  const org = await prisma.organization.create({
    data: {
      name: 'Inline Dental',
      clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}`,
      npi: opts.npi === null ? null : (opts.npi ?? '1234567890'),
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'CLM-INLINE-1',
      patientDOBHash: hashPatientDOB({
        dob: '1990-05-12',
        organizationId: org.id,
        secret: 'inline-test-secret-not-real',
      }),
      patientDOBLast4: '0512',
      cdtCodes: ['D1110'],
      claimAmount: '245.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-01-15T00:00:00.000Z'),
      status: opts.status ?? 'IN_QUEUE',
      priority: 80,
    },
  });
  return {
    orgId: org.id,
    claimId: claim.id,
    data: {
      organizationId: org.id,
      claimId: claim.id,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: `${claim.id}-a1-test`,
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog" RESTART IDENTITY CASCADE',
  );
});

describe('createInlineJobRuntime — calls', () => {
  it('runs the call handler to completion and dispatches the summary job', async () => {
    const { runtime, retell, retellCallId, dispatcher } = runtimeWith();
    const { data, orgId } = await seed();

    const running = runtime.runCall(data);
    await waitFor(() => retell.startedCalls.length === 1);
    await retell.simulateHappyPath(retellCallId);
    const report = await running;

    expect(report).toEqual({ status: 'completed', attemptsMade: 1 });
    const call = await prisma.call.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(call.status).toBe('COMPLETED');
    expect(dispatcher.dispatchSummary).toHaveBeenCalledWith(
      expect.objectContaining({ callId: call.id, idempotencyKey: `call.${call.id}` }),
    );
  });

  it('skips a duplicate trigger once the claim has left IN_QUEUE', async () => {
    const { runtime, retell } = runtimeWith();
    const { data } = await seed({ status: 'PENDING' });
    await expect(runtime.runCall(data)).resolves.toEqual({
      status: 'skipped',
      reason: 'claim_not_in_queue',
    });
    expect(retell.startedCalls).toHaveLength(0);
  });

  it('retries per job options, then runs the DLQ escalation (claim → MANUAL_REVIEW)', async () => {
    const { runtime } = runtimeWith({
      callJobOptions: { attempts: 2, backoff: { type: 'fixed', delay: 1 } },
    });
    // No NPI → the handler throws on every attempt.
    const { data, claimId } = await seed({ npi: null });

    const report = await runtime.runCall(data);

    expect(report).toEqual({
      status: 'failed',
      attemptsMade: 2,
      budgetExhausted: false,
      dlq: true,
    });
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe('MANUAL_REVIEW');
  });
});

describe('createInlineJobRuntime — single attempts (SQS mode)', () => {
  it('first attempt fails with attempts left → retry with the backoff, claim stays CALLING', async () => {
    const { runtime } = runtimeWith();
    const { data, claimId } = await seed({ npi: null });

    const report = await runtime.runCallAttempt(data, { attempt: 1, maxAttempts: 3 });

    expect(report).toMatchObject({ status: 'retry', attempt: 1, retryDelayMs: 30_000 });
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe('CALLING');
  });

  it('a redelivery may re-take the CALLING lease, and the final attempt escalates to DLQ', async () => {
    const { runtime } = runtimeWith();
    const { data, claimId } = await seed({ npi: null });
    await runtime.runCallAttempt(data, { attempt: 1, maxAttempts: 3 });

    await expect(
      runtime.runCallAttempt(data, { attempt: 2, maxAttempts: 3 }),
    ).resolves.toMatchObject({ status: 'retry', attempt: 2, retryDelayMs: 60_000 });
    await expect(runtime.runCallAttempt(data, { attempt: 3, maxAttempts: 3 })).resolves.toEqual({
      status: 'failed',
      attempt: 3,
      dlq: true,
    });
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe('MANUAL_REVIEW');
  });

  it('never redials a claim that left IN_QUEUE / CALLING, even on a redelivery', async () => {
    const { runtime, retell } = runtimeWith();
    const { data } = await seed({ status: 'PENDING' });
    for (const attempt of [1, 2]) {
      await expect(runtime.runCallAttempt(data, { attempt, maxAttempts: 3 })).resolves.toEqual({
        status: 'skipped',
        reason: 'claim_not_in_queue',
      });
    }
    expect(retell.startedCalls).toHaveLength(0);
  });

  it('a successful attempt completes the call', async () => {
    const { runtime, retell, retellCallId } = runtimeWith();
    const { data } = await seed();

    const running = runtime.runCallAttempt(data, { attempt: 1, maxAttempts: 3 });
    await waitFor(() => retell.startedCalls.length === 1);
    await retell.simulateHappyPath(retellCallId);

    await expect(running).resolves.toEqual({ status: 'completed', attempt: 1 });
  });
});

describe('createInlineJobRuntime — summaries', () => {
  async function seedEndedCall(): Promise<{ orgId: string; callId: string }> {
    const { orgId, claimId } = await seed({ status: 'PENDING' });
    const call = await prisma.call.create({
      data: {
        organizationId: orgId,
        claimId,
        retellCallId: `fake_inline_done_${Math.random().toString(36).slice(2)}`,
        status: 'COMPLETED',
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
      },
    });
    await prisma.callEvent.createMany({
      data: [
        {
          callId: call.id,
          eventType: 'call.transcript',
          data: { role: 'agent', text: 'Calling to check the status of claim CLM-INLINE-1.' },
        },
        {
          callId: call.id,
          eventType: 'call.transcript',
          data: { role: 'user', text: 'That claim was processed and paid in full on March 3rd.' },
        },
      ],
    });
    return { orgId, callId: call.id };
  }

  it('runs the summary handler and persists a CallSummary (no Redis: in-memory cost guard)', async () => {
    const { runtime } = runtimeWith();
    const { orgId, callId } = await seedEndedCall();

    const report = await runtime.runSummary({
      organizationId: orgId,
      callId,
      promptVersion: 'v1',
      idempotencyKey: `call.${callId}`,
    });

    expect(report).toEqual({ status: 'completed', attemptsMade: 1 });
    await expect(prisma.callSummary.count({ where: { callId } })).resolves.toBe(1);
  });

  it('skips the automatic summary job when a summary already exists', async () => {
    const { runtime } = runtimeWith();
    const { orgId, callId } = await seedEndedCall();
    const data = {
      organizationId: orgId,
      callId,
      promptVersion: 'v1',
      idempotencyKey: `call.${callId}`,
    };
    await runtime.runSummary(data);

    await expect(runtime.runSummary(data)).resolves.toEqual({
      status: 'skipped',
      reason: 'summary_exists',
    });
    await expect(runtime.runSummaryAttempt(data, { attempt: 2, maxAttempts: 3 })).resolves.toEqual({
      status: 'skipped',
      reason: 'summary_exists',
    });
  });

  it('runs a single summary attempt (SQS mode)', async () => {
    const { runtime } = runtimeWith();
    const { orgId, callId } = await seedEndedCall();

    const report = await runtime.runSummaryAttempt(
      { organizationId: orgId, callId, promptVersion: 'v1', idempotencyKey: `call.${callId}` },
      { attempt: 1, maxAttempts: 3 },
    );

    expect(report).toEqual({ status: 'completed', attempt: 1 });
    await expect(prisma.callSummary.count({ where: { callId } })).resolves.toBe(1);
  });
});
