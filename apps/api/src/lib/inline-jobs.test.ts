/**
 * Integration tests for the inline job runtime (ADR-053) against the real
 * test Postgres. Retell and Claude are the in-process fakes, injected so a
 * developer `.env` with live keys can never leak into the run.
 */
import { enqueueJobOutbox } from '@dentabill/call-worker';
import { hashPatientDOB, prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { FakeRetell } from '@dentabill/payer-ivr';
import type { CallJobData, JobDispatcher, SummaryJobData } from '@dentabill/queue';
import { createSummarizerPort } from '@dentabill/summarizer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSqsJobWorker } from '../lambda-worker.js';

import {
  createCallObservationSweep,
  createInlineJobRuntime,
  type CreateInlineJobRuntimeDeps,
} from './inline-jobs.js';

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

async function seed(
  opts: {
    npi?: string | null;
    subscriberId?: string | null;
    status?: 'IN_QUEUE' | 'PENDING';
    withIntent?: boolean;
  } = {},
): Promise<{
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
      subscriberId: opts.subscriberId === null ? null : (opts.subscriberId ?? 'MEMBER-INLINE-1'),
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
      status: 'PENDING',
      priority: 80,
    },
  });
  const queued =
    (opts.status ?? 'IN_QUEUE') === 'IN_QUEUE'
      ? await prisma.claim.update({
          where: { id: claim.id, organizationId: org.id },
          data: { status: 'IN_QUEUE' },
        })
      : claim;
  const data: CallJobData = {
    organizationId: org.id,
    claimId: claim.id,
    payerCode: 'DELTA_DENTAL_PPO',
    attemptNumber: 1,
    claimPriority: 80,
    idempotencyKey: `${claim.id}-a1-test`,
  };
  if (opts.withIntent ?? queued.status === 'IN_QUEUE') {
    await prisma.callIntent.create({
      data: { ...data, payerCode: 'DELTA_DENTAL_PPO', claimVersion: queued.updatedAt },
    });
  }
  return { orgId: org.id, claimId: claim.id, data };
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
    'DROP TRIGGER IF EXISTS reject_runtime_submission ON "CallIntent"',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_runtime_submission()');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_runtime_audit ON "AuditLog"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_runtime_audit()');
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog" RESTART IDENTITY CASCADE',
  );
});

async function rejectSubmission(): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_runtime_submission() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.state = 'SUBMITTING' THEN RAISE EXCEPTION 'Synthetic submission persistence failure'; END IF;
    RETURN NEW; END; $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_runtime_submission BEFORE UPDATE ON "CallIntent"
    FOR EACH ROW EXECUTE FUNCTION reject_runtime_submission()`);
}

describe('createInlineJobRuntime — calls', () => {
  it('keeps old recovered SQS failure unacknowledged and accepts exact current generation exhaustion', async () => {
    const { data, orgId } = await seed();
    const outbox = await enqueueJobOutbox(prisma, {
      organizationId: orgId,
      kind: 'CALL_PLACE',
      data,
    });
    await prisma.jobOutbox.updateMany({
      where: { id: outbox.id, organizationId: orgId },
      data: {
        state: 'DELIVERED',
        recoveryCount: 1,
        deliveryAttempts: 11,
        deliveryAttemptLimit: 13,
      },
    });
    const { runtime, retell } = runtimeWith();
    const start = vi.spyOn(retell, 'startCall');
    const worker = createSqsJobWorker({ runtime, logger: silentLogger, maxReceiveCount: 1 });
    await rejectSubmission();
    try {
      const stale = await worker({
        Records: [
          {
            messageId: 'stale',
            receiptHandle: 'stale-handle',
            body: JSON.stringify({ type: 'call.place', data }),
            attributes: { ApproximateReceiveCount: '1' },
          },
        ],
      });
      expect(stale).toEqual({ batchItemFailures: [{ itemIdentifier: 'stale' }] });
      expect(
        await prisma.callIntent.findFirst({
          where: { organizationId: orgId, idempotencyKey: data.idempotencyKey },
        }),
      ).toMatchObject({ state: 'READY' });
      const current = await worker({
        Records: [
          {
            messageId: 'current',
            receiptHandle: 'current-handle',
            body: JSON.stringify({
              type: 'call.place',
              data,
              transportJobId: `outbox.${outbox.id}.recovery.1`,
            }),
            attributes: { ApproximateReceiveCount: '1' },
          },
        ],
      });
      expect(current).toEqual({ batchItemFailures: [] });
      expect(
        await prisma.callIntent.findFirst({
          where: { organizationId: orgId, idempotencyKey: data.idempotencyKey },
        }),
      ).toMatchObject({ state: 'CANCELLED' });
      expect(
        await prisma.auditLog.count({
          where: { organizationId: orgId, action: 'call.intent.cancelled' },
        }),
      ).toBe(1);
      expect(start).not.toHaveBeenCalled();
    } finally {
      start.mockRestore();
    }
  });

  it('threads recovered inline provenance without claiming stale failure persistence', async () => {
    const { data, orgId } = await seed();
    const outbox = await enqueueJobOutbox(prisma, {
      organizationId: orgId,
      kind: 'CALL_PLACE',
      data,
    });
    await prisma.jobOutbox.updateMany({
      where: { id: outbox.id, organizationId: orgId },
      data: { state: 'PENDING', recoveryCount: 1, deliveryAttempts: 11, deliveryAttemptLimit: 13 },
    });
    const { runtime, retell } = runtimeWith({ callJobOptions: { attempts: 1 } });
    const start = vi.spyOn(retell, 'startCall');
    await rejectSubmission();
    try {
      expect(await runtime.runCall(data)).toMatchObject({ status: 'failed', dlq: false });
      expect(
        await runtime.runCall(data, { transportJobId: `outbox.${outbox.id}.recovery.1` }),
      ).toMatchObject({ status: 'failed', dlq: true });
      expect(start).not.toHaveBeenCalled();
    } finally {
      start.mockRestore();
    }
  });
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
    expect(await runtimeWith({ retellPort: retell }).runtime.runCall(data)).toEqual({
      status: 'skipped',
      reason: 'call_intent_already_processed',
    });
    expect(retell.startedCalls).toHaveLength(1);
  });

  it.each(['inline', 'sqs'] as const)(
    'hands an accepted call to persisted observation after one bounded %s attempt',
    async (mode) => {
      const { runtime, retell, dispatcher } = runtimeWith();
      const { data, orgId } = await seed();
      const report =
        mode === 'inline'
          ? await runtime.runCall(data)
          : await runtime.runCallAttempt(data, { attempt: 1, maxAttempts: 3 });
      expect(report).toEqual(
        mode === 'inline'
          ? { status: 'rescheduled', attemptsMade: 1 }
          : { status: 'rescheduled', attempt: 1 },
      );
      const intent = await prisma.callIntent.findFirstOrThrow({
        where: { organizationId: orgId, idempotencyKey: data.idempotencyKey },
      });
      expect(intent).toMatchObject({
        state: 'ACCEPTED',
        callId: expect.any(String),
        callDeadlineAt: expect.any(Date),
        nextObservationAt: expect.any(Date),
      });
      expect(retell.startedCalls).toHaveLength(1);
      expect(dispatcher.dispatchSummary).not.toHaveBeenCalled();
      const replay = await runtime.runCallAttempt(data, { attempt: 2, maxAttempts: 3 });
      // A later no-key delivery cannot recover the first invocation’s in-memory source.
      expect(replay).toMatchObject({ status: 'reconciliation_required' });
      expect(retell.startedCalls).toHaveLength(1);
      expect(
        (
          await prisma.callIntent.findFirstOrThrow({
            where: { id: intent.id, organizationId: orgId },
          })
        ).callDeadlineAt,
      ).toEqual(intent.callDeadlineAt);
    },
  );

  it('constructs scheduled observation independently of summary/worker configuration', async () => {
    const fake = new FakeRetell();
    const sweep = createCallObservationSweep({ prisma, env: {}, retellPort: fake, provider: null });
    expect(await sweep({ limit: 5, budgetMs: 25_000 })).toEqual({
      selected: 0,
      observed: 0,
      terminal: 0,
      rescheduled: 0,
      stopRequested: 0,
      failed: 0,
    });
    expect(fake.startedCalls).toHaveLength(0);
  });

  it.each(['', '-r2'])(
    'fails closed without an exact intent, including reschedule suffix %j',
    async (suffix) => {
      const { runtime, retell } = runtimeWith();
      const { data, claimId } = await seed({ withIntent: false });
      await expect(
        runtime.runCall({ ...data, idempotencyKey: `${data.idempotencyKey}${suffix}` }),
      ).resolves.toEqual({
        status: 'skipped',
        reason: 'call_intent_blocked',
      });
      expect(retell.startedCalls).toHaveLength(0);
      expect((await prisma.claim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe(
        'IN_QUEUE',
      );
    },
  );

  it('retains uncertain provider acceptance without retrying the physical submission', async () => {
    const { runtime, retell, dispatcher } = runtimeWith({
      callJobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 1 } },
    });
    const submit = retell.startCall.bind(retell);
    const startCall = vi.spyOn(retell, 'startCall').mockImplementation(async (input) => {
      await submit(input);
      throw new Error('synthetic response lost after acceptance');
    });
    const { data, claimId, orgId } = await seed();
    expect(await runtime.runCall(data)).toEqual({
      status: 'reconciliation_required',
      attemptsMade: 1,
    });
    expect(startCall).toHaveBeenCalledTimes(1);
    expect(retell.startedCalls).toHaveLength(1);
    expect(
      (
        await prisma.callIntent.findFirstOrThrow({
          where: { organizationId: orgId, idempotencyKey: data.idempotencyKey },
        })
      ).state,
    ).toBe('UNKNOWN');
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe(
      'MANUAL_REVIEW',
    );
    expect(await prisma.call.count({ where: { organizationId: orgId } })).toBe(0);
    expect(dispatcher.dispatchSummary).not.toHaveBeenCalled();
    expect(
      await prisma.auditLog.count({
        where: { organizationId: orgId, action: 'call.intent.cancelled' },
      }),
    ).toBe(0);

    const restarted = runtimeWith({ retellPort: retell }).runtime;
    expect(await restarted.runCall(data)).toEqual({
      status: 'reconciliation_required',
      attemptsMade: 1,
    });
    expect(startCall).toHaveBeenCalledTimes(1);
  });

  it.each([null, '', ' \t\n '])(
    'blocks missing subscriber identity before any vendor call: %j',
    async (subscriberId) => {
      const { runtime, retell, dispatcher } = runtimeWith();
      const startCall = vi.spyOn(retell, 'startCall');
      const { data, claimId, orgId } = await seed({ subscriberId });

      expect(await runtime.runCall(data)).toEqual({
        status: 'blocked',
        reason: 'MISSING_CALL_IDENTITY',
        missingFields: ['subscriberId'],
        attemptsMade: 1,
      });
      expect(startCall).not.toHaveBeenCalled();
      expect(dispatcher.dispatchSummary).not.toHaveBeenCalled();
      const claim = await prisma.claim.findFirstOrThrow({
        where: { id: claimId, organizationId: orgId },
      });
      expect(claim.status).toBe('NEEDS_INFO');
      expect(claim.lastCallAt).toBeNull();
      expect(await prisma.call.count({ where: { organizationId: orgId, claimId } })).toBe(0);
    },
  );
});

describe('createInlineJobRuntime — single attempts (SQS mode)', () => {
  it('retries a database failure before submission, retaining the READY reservation', async () => {
    const { runtime, retell, retellCallId } = runtimeWith();
    const { data, orgId, claimId } = await seed();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_runtime_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'call.intent.submitting' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_runtime_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_runtime_audit()',
    );
    expect(await runtime.runCallAttempt(data, { attempt: 1, maxAttempts: 3 })).toMatchObject({
      status: 'retry',
      attempt: 1,
      retryDelayMs: 30_000,
    });
    expect(retell.startedCalls).toHaveLength(0);
    expect(
      (await prisma.callIntent.findFirstOrThrow({ where: { organizationId: orgId } })).state,
    ).toBe('READY');
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe(
      'IN_QUEUE',
    );
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_runtime_audit ON "AuditLog"');
    const running = runtime.runCallAttempt(data, { attempt: 2, maxAttempts: 3 });
    await waitFor(() => retell.startedCalls.length === 1);
    await retell.simulateHappyPath(retellCallId);
    expect(await running).toEqual({ status: 'completed', attempt: 2 });
    expect(retell.startedCalls).toHaveLength(1);
  });

  it('keeps the final SQS delivery when neither reservation nor terminal failure can commit', async () => {
    const { runtime, retell } = runtimeWith();
    const { data, orgId, claimId } = await seed();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_runtime_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('call.intent.submitting', 'call.intent.cancelled') THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_runtime_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_runtime_audit()',
    );
    const worker = createSqsJobWorker({ runtime, logger: silentLogger, maxReceiveCount: 3 });
    expect(
      await worker({
        Records: [
          {
            messageId: 'uncommitted',
            receiptHandle: 'synthetic-receipt',
            body: JSON.stringify({ type: 'call.place', data }),
            attributes: { ApproximateReceiveCount: '3' },
          },
        ],
      }),
    ).toEqual({ batchItemFailures: [{ itemIdentifier: 'uncommitted' }] });
    expect(retell.startedCalls).toHaveLength(0);
    expect(
      (await prisma.callIntent.findFirstOrThrow({ where: { organizationId: orgId } })).state,
    ).toBe('READY');
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe(
      'IN_QUEUE',
    );
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('does not repeat provider submission when accepted-call persistence fails', async () => {
    const { runtime, retell } = runtimeWith();
    const { data, orgId } = await seed();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_runtime_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'call.start' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_runtime_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_runtime_audit()',
    );
    expect(await runtime.runCallAttempt(data, { attempt: 1, maxAttempts: 3 })).toMatchObject({
      status: 'retry',
    });
    expect(retell.startedCalls).toHaveLength(1);
    expect(
      (await prisma.callIntent.findFirstOrThrow({ where: { organizationId: orgId } })).state,
    ).toBe('SUBMITTING');
    expect(await prisma.call.count()).toBe(0);
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_runtime_audit ON "AuditLog"');
    const restarted = runtimeWith({ retellPort: retell }).runtime;
    expect(await restarted.runCallAttempt(data, { attempt: 3, maxAttempts: 3 })).toEqual({
      status: 'reconciliation_required',
      attempt: 3,
    });
    expect(retell.startedCalls).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'call.intent.cancelled' } })).toBe(0);
  });

  it('acknowledges uncertainty across SQS redeliveries and runtime recreation without DLQ overwrite', async () => {
    const { retell } = runtimeWith();
    const startCall = vi
      .spyOn(retell, 'startCall')
      .mockRejectedValue(new Error('synthetic unknown submission result'));
    const { data, claimId, orgId } = await seed();
    const scheduleRetry = vi.fn(async () => undefined);
    for (const attempt of [1, 2, 3]) {
      const { runtime } = runtimeWith({ retellPort: retell });
      const worker = createSqsJobWorker({
        runtime,
        logger: silentLogger,
        maxReceiveCount: 3,
        scheduleRetry,
      });
      expect(
        await worker({
          Records: [
            {
              messageId: `delivery-${String(attempt)}`,
              receiptHandle: 'synthetic-receipt',
              body: JSON.stringify({ type: 'call.place', data }),
              attributes: { ApproximateReceiveCount: String(attempt) },
            },
          ],
        }),
      ).toEqual({ batchItemFailures: [] });
    }
    expect(startCall).toHaveBeenCalledTimes(1);
    expect(scheduleRetry).not.toHaveBeenCalled();
    expect(
      (
        await prisma.callIntent.findFirstOrThrow({
          where: { organizationId: orgId, idempotencyKey: data.idempotencyKey },
        })
      ).state,
    ).toBe('UNKNOWN');
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe(
      'MANUAL_REVIEW',
    );
    expect(await prisma.auditLog.count({ where: { action: 'call.intent.cancelled' } })).toBe(0);
  });

  it('prevents concurrent runtimes from submitting the same READY intent twice', async () => {
    const { retell, runtime } = runtimeWith();
    let release: () => void = () => undefined;
    const submitted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startCall = vi.spyOn(retell, 'startCall').mockImplementation(async () => {
      await submitted;
      throw new Error('synthetic unknown submission result');
    });
    const { data } = await seed();
    const first = runtime.runCallAttempt(data, { attempt: 1, maxAttempts: 3 });
    await waitFor(() => startCall.mock.calls.length === 1);
    const duplicate = runtimeWith({ retellPort: retell }).runtime;
    try {
      await expect(duplicate.runCallAttempt(data, { attempt: 2, maxAttempts: 3 })).resolves.toEqual(
        { status: 'reconciliation_required', attempt: 2 },
      );
      expect(startCall).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    await expect(first).resolves.toEqual({ status: 'reconciliation_required', attempt: 1 });
  });

  it('fails closed for legacy redelivery without an intent', async () => {
    const { runtime, retell } = runtimeWith();
    const { data } = await seed({ withIntent: false });
    for (const attempt of [1, 3]) {
      await expect(runtime.runCallAttempt(data, { attempt, maxAttempts: 3 })).resolves.toEqual({
        status: 'skipped',
        reason: 'call_intent_blocked',
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

  it.each([
    { attempt: 1, subscriberId: null, npi: '1234567890', missingFields: ['subscriberId'] },
    { attempt: 3, subscriberId: ' \t ', npi: '1234567890', missingFields: ['subscriberId'] },
    { attempt: 3, subscriberId: 'MEMBER-INLINE-1', npi: null, missingFields: ['providerNpi'] },
  ])(
    'acknowledges missing identity through the Lambda batch route without retry or DLQ: %j',
    async ({ attempt, subscriberId, npi, missingFields }) => {
      const { runtime, retell, dispatcher } = runtimeWith();
      const startCall = vi.spyOn(retell, 'startCall');
      const runAttempt = vi.spyOn(runtime, 'runCallAttempt');
      const scheduleRetry = vi.fn(async () => undefined);
      const { data, claimId, orgId } = await seed({ subscriberId, npi });
      const worker = createSqsJobWorker({
        runtime,
        logger: silentLogger,
        maxReceiveCount: 3,
        scheduleRetry,
      });

      expect(
        await worker({
          Records: [
            {
              messageId: 'missing-identity',
              receiptHandle: 'synthetic-receipt',
              body: JSON.stringify({ type: 'call.place', data }),
              attributes: { ApproximateReceiveCount: String(attempt) },
            },
          ],
        }),
      ).toEqual({ batchItemFailures: [] });
      await expect(runAttempt.mock.results[0]?.value).resolves.toEqual({
        status: 'blocked',
        reason: 'MISSING_CALL_IDENTITY',
        missingFields,
        attempt,
      });
      expect(scheduleRetry).not.toHaveBeenCalled();
      expect(startCall).not.toHaveBeenCalled();
      expect(dispatcher.dispatchSummary).not.toHaveBeenCalled();
      const claim = await prisma.claim.findFirstOrThrow({
        where: { id: claimId, organizationId: orgId },
      });
      expect(claim.status).toBe('NEEDS_INFO');
      expect(claim.lastCallAt).toBeNull();
      expect(await prisma.call.count({ where: { organizationId: orgId, claimId } })).toBe(0);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { organizationId: orgId, resourceId: claimId, action: 'call.blocked' },
      });
      expect(audit.metadata).toMatchObject({ reason: 'MISSING_CALL_IDENTITY', missingFields });
    },
  );
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
