import type { EndCallInput, RetellPort, StartCallResult } from '@dentabill/payer-ivr';
import {
  CALL_JOB_NAME,
  type CallJobData,
  type DlqQueue,
  DLQ_JOB_NAME,
  DLQ_REASONS,
  QUEUE_NAMES,
} from '@dentabill/queue';
import { describe, expect, it, vi } from 'vitest';

import { createDurationGuard, resolveDurationBreach } from './duration-guard.js';

const baseJobData: CallJobData = {
  organizationId: 'org_test',
  claimId: 'claim_test_001',
  payerCode: 'DELTA_DENTAL_PPO',
  attemptNumber: 1,
  claimPriority: 80,
  idempotencyKey: 'job-test-1',
};

describe('createDurationGuard — pure-logic wall-clock tracking', () => {
  it('returns idle until start() has been called', () => {
    const guard = createDurationGuard({ maxDurationMs: 1_000, clock: () => 0 });
    expect(guard.check().status).toBe('idle');
  });

  it('measures elapsed time monotonically from start()', () => {
    let now = 0;
    const guard = createDurationGuard({ maxDurationMs: 1_000, clock: () => now });
    guard.start();
    now = 250;
    expect(guard.check()).toEqual({ status: 'ok', elapsedMs: 250 });
    now = 999;
    expect(guard.check().status).toBe('ok');
  });

  it('breaches at exactly maxDurationMs (inclusive boundary)', () => {
    let now = 0;
    const guard = createDurationGuard({ maxDurationMs: 1_000, clock: () => now });
    guard.start();
    now = 999;
    expect(guard.check().status).toBe('ok');
    now = 1_000;
    expect(guard.check().status).toBe('breached');
  });

  it('start() is idempotent — second call does not reset the baseline', () => {
    let now = 0;
    const guard = createDurationGuard({ maxDurationMs: 1_000, clock: () => now });
    guard.start();
    now = 500;
    guard.start();
    now = 1_000;
    expect(guard.check()).toEqual({ status: 'breached', elapsedMs: 1_000 });
  });

  it('rejects a non-positive maxDurationMs at construction', () => {
    expect(() => createDurationGuard({ maxDurationMs: 0 })).toThrow(/positive/);
    expect(() => createDurationGuard({ maxDurationMs: -1 })).toThrow(/positive/);
  });
});

interface MockRetellPort extends RetellPort {
  ended: EndCallInput[];
}

function mockRetellPort(): MockRetellPort {
  const ended: EndCallInput[] = [];
  return {
    ended,
    startCall: vi.fn(
      async (): Promise<StartCallResult> => ({
        retellCallId: 'unused',
        queuedAt: '2026-01-01T00:00:00Z',
      }),
    ),
    endCall: vi.fn(async (input: EndCallInput) => {
      ended.push(input);
    }),
    subscribe: vi.fn(() => (): void => {
      /* unsubscribe noop */
    }),
  };
}

interface MockDlqQueue {
  add: ReturnType<typeof vi.fn>;
}

function mockDlqQueue(): MockDlqQueue {
  return { add: vi.fn(async () => ({ id: 'fake-dlq-id' })) };
}

describe('resolveDurationBreach', () => {
  it('ends the live Retell call with duration_cap_exceeded', async () => {
    const retell = mockRetellPort();
    const dlq = mockDlqQueue();
    await resolveDurationBreach({
      dlqQueue: dlq as unknown as DlqQueue,
      retellPort: retell,
      retellCallId: 'fake_call_42',
      originalData: baseJobData,
      originalJobId: 'job-1',
      elapsedMs: 901_000,
    });
    expect(retell.ended).toEqual([
      { retellCallId: 'fake_call_42', reason: 'duration_cap_exceeded' },
    ]);
  });

  it('routes the job to the DLQ with EXCEEDED_MAX_DURATION', async () => {
    const retell = mockRetellPort();
    const dlq = mockDlqQueue();
    const result = await resolveDurationBreach({
      dlqQueue: dlq as unknown as DlqQueue,
      retellPort: retell,
      retellCallId: 'fake_call_42',
      originalData: { ...baseJobData, attemptNumber: 2 },
      originalJobId: 'job-attempt-2',
      elapsedMs: 950_000,
    });
    expect(result.outcome).toBe('dlq_escalated');
    expect(dlq.add).toHaveBeenCalledTimes(1);
    const [jobName, payload, options] = dlq.add.mock.calls[0]!;
    expect(jobName).toBe(DLQ_JOB_NAME);
    expect(payload).toMatchObject({
      reason: DLQ_REASONS.EXCEEDED_MAX_DURATION,
      originalQueueName: QUEUE_NAMES.CALLS,
      originalData: { ...baseJobData, attemptNumber: 2 },
      attemptsMade: 2,
      originalJobName: CALL_JOB_NAME,
    });
    expect(payload).toMatchObject({ failedReason: expect.stringMatching(/950000 ms/) });
    expect(options).toMatchObject({ jobId: 'job-attempt-2' });
  });

  it('uses originalJobId as the DLQ jobId so duplicate breaches collapse', async () => {
    const retell = mockRetellPort();
    const dlq = mockDlqQueue();
    await resolveDurationBreach({
      dlqQueue: dlq as unknown as DlqQueue,
      retellPort: retell,
      retellCallId: 'fake_call_42',
      originalData: baseJobData,
      originalJobId: 'idempotent-xyz',
      elapsedMs: 920_000,
    });
    const options = dlq.add.mock.calls[0]?.[2];
    expect(options).toMatchObject({ jobId: 'idempotent-xyz' });
  });

  it('records the original attemptNumber on the DLQ payload', async () => {
    const retell = mockRetellPort();
    const dlq = mockDlqQueue();
    await resolveDurationBreach({
      dlqQueue: dlq as unknown as DlqQueue,
      retellPort: retell,
      retellCallId: 'fake_call_42',
      originalData: { ...baseJobData, attemptNumber: 1 },
      originalJobId: 'job-attempt-1',
      elapsedMs: 905_000,
    });
    const payload = dlq.add.mock.calls[0]?.[1] as { attemptsMade: number };
    expect(payload.attemptsMade).toBe(1);
  });
});
