import type { EndCallInput, RetellPort, StartCallResult } from '@dentabill/payer-ivr';
import {
  CALL_JOB_NAME,
  type CallJobData,
  type CallsQueue,
  type DlqQueue,
  DLQ_JOB_NAME,
  DLQ_REASONS,
  QUEUE_NAMES,
} from '@dentabill/queue';
import { describe, expect, it, vi } from 'vitest';

import { createHoldDetector, resolveHoldBreach } from './hold-detector.js';

const baseJobData: CallJobData = {
  organizationId: 'org_test',
  claimId: 'claim_test_001',
  payerCode: 'DELTA_DENTAL_PPO',
  attemptNumber: 1,
  claimPriority: 80,
  idempotencyKey: 'job-test-1',
};

describe('createHoldDetector — pure-logic silence tracking', () => {
  it('returns idle until start() has been called', () => {
    const det = createHoldDetector({ maxHoldMs: 1_000, clock: () => 0 });
    expect(det.check().status).toBe('idle');
  });

  it('measures silence from start() when no human has spoken', () => {
    let now = 0;
    const det = createHoldDetector({ maxHoldMs: 1_000, clock: () => now });
    det.start();
    now = 500;
    expect(det.check()).toEqual({ status: 'ok', silentMs: 500 });
    now = 1_001;
    expect(det.check()).toEqual({ status: 'breached', silentMs: 1_001 });
  });

  it('resets the silence baseline on noteHumanSpeech()', () => {
    let now = 0;
    const det = createHoldDetector({ maxHoldMs: 1_000, clock: () => now });
    det.start();
    now = 800;
    det.noteHumanSpeech();
    now = 1_400;
    expect(det.check()).toEqual({ status: 'ok', silentMs: 600 });
    now = 1_801;
    expect(det.check().status).toBe('breached');
  });

  it('breaches at exactly maxHoldMs (inclusive boundary)', () => {
    let now = 0;
    const det = createHoldDetector({ maxHoldMs: 1_000, clock: () => now });
    det.start();
    now = 999;
    expect(det.check().status).toBe('ok');
    now = 1_000;
    expect(det.check().status).toBe('breached');
  });

  it('rejects a non-positive maxHoldMs at construction', () => {
    expect(() => createHoldDetector({ maxHoldMs: 0 })).toThrow(/positive/);
    expect(() => createHoldDetector({ maxHoldMs: -1 })).toThrow(/positive/);
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

interface MockCallsQueue {
  add: ReturnType<typeof vi.fn>;
}
interface MockDlqQueue {
  add: ReturnType<typeof vi.fn>;
}

function mockCallsQueue(): MockCallsQueue {
  return { add: vi.fn(async () => ({ id: 'fake-job-id' })) };
}
function mockDlqQueue(): MockDlqQueue {
  return { add: vi.fn(async () => ({ id: 'fake-dlq-id' })) };
}

describe('resolveHoldBreach', () => {
  it('ends the live Retell call with hold_cap_exceeded', async () => {
    const retell = mockRetellPort();
    const calls = mockCallsQueue();
    const dlq = mockDlqQueue();
    await resolveHoldBreach({
      callsQueue: calls as unknown as CallsQueue,
      dlqQueue: dlq as unknown as DlqQueue,
      retellPort: retell,
      retellCallId: 'fake_call_1',
      originalData: baseJobData,
      originalJobId: 'job-1',
      silentMs: 600_001,
    });
    expect(retell.ended).toEqual([{ retellCallId: 'fake_call_1', reason: 'hold_cap_exceeded' }]);
  });

  it('reschedules with attemptNumber+1 when attempts are not exhausted', async () => {
    const retell = mockRetellPort();
    const calls = mockCallsQueue();
    const dlq = mockDlqQueue();
    const result = await resolveHoldBreach({
      callsQueue: calls as unknown as CallsQueue,
      dlqQueue: dlq as unknown as DlqQueue,
      retellPort: retell,
      retellCallId: 'fake_call_1',
      originalData: { ...baseJobData, attemptNumber: 1 },
      originalJobId: 'job-1',
      silentMs: 700_000,
    });
    expect(result.outcome).toBe('rescheduled');
    expect(result.nextAttemptNumber).toBe(2);
    expect(result.nextJobId).toBe('job-test-1-r2');
    expect(calls.add).toHaveBeenCalledTimes(1);
    const [jobName, payload, options] = calls.add.mock.calls[0]!;
    expect(jobName).toBe(CALL_JOB_NAME);
    expect(payload).toMatchObject({
      attemptNumber: 2,
      idempotencyKey: 'job-test-1-r2',
      organizationId: baseJobData.organizationId,
      claimId: baseJobData.claimId,
    });
    expect(options).toMatchObject({ jobId: 'job-test-1-r2' });
    expect(dlq.add).not.toHaveBeenCalled();
  });

  it('routes to DLQ with EXCEEDED_MAX_HOLD when the per-day cap is reached', async () => {
    const retell = mockRetellPort();
    const calls = mockCallsQueue();
    const dlq = mockDlqQueue();
    const result = await resolveHoldBreach({
      callsQueue: calls as unknown as CallsQueue,
      dlqQueue: dlq as unknown as DlqQueue,
      retellPort: retell,
      retellCallId: 'fake_call_1',
      originalData: { ...baseJobData, attemptNumber: 2 },
      originalJobId: 'job-attempt-2',
      silentMs: 800_000,
    });
    expect(result.outcome).toBe('dlq_exhausted');
    expect(result.nextAttemptNumber).toBeUndefined();
    expect(calls.add).not.toHaveBeenCalled();
    expect(dlq.add).toHaveBeenCalledTimes(1);
    const [jobName, payload, options] = dlq.add.mock.calls[0]!;
    expect(jobName).toBe(DLQ_JOB_NAME);
    expect(payload).toMatchObject({
      reason: DLQ_REASONS.EXCEEDED_MAX_HOLD,
      originalQueueName: QUEUE_NAMES.CALLS,
      originalData: { ...baseJobData, attemptNumber: 2 },
      attemptsMade: 2,
    });
    expect(payload).toMatchObject({ failedReason: expect.stringMatching(/800000 ms/) });
    expect(options).toMatchObject({ jobId: 'job-attempt-2' });
  });

  it('uses the breached jobId as the DLQ idempotency key (replay-safe)', async () => {
    const retell = mockRetellPort();
    const calls = mockCallsQueue();
    const dlq = mockDlqQueue();
    await resolveHoldBreach({
      callsQueue: calls as unknown as CallsQueue,
      dlqQueue: dlq as unknown as DlqQueue,
      retellPort: retell,
      retellCallId: 'fake_call_1',
      originalData: { ...baseJobData, attemptNumber: 2 },
      originalJobId: 'idempotent-job-xyz',
      silentMs: 800_000,
    });
    const options = dlq.add.mock.calls[0]?.[2];
    expect(options).toMatchObject({ jobId: 'idempotent-job-xyz' });
  });
});
