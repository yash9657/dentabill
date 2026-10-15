import type { EndCallInput, RetellPort, StartCallResult } from '@dentabill/payer-ivr';
import { type CallJobData, createBullMqJobDispatcher, type DlqQueue } from '@dentabill/queue';
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
  startCall: ReturnType<typeof vi.fn<RetellPort['startCall']>>;
  endCall: ReturnType<typeof vi.fn<RetellPort['endCall']>>;
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
      jobDispatcher: createBullMqJobDispatcher({ callsQueue: calls }),
      dlqQueue: dlq as unknown as DlqQueue,
      retellPort: retell,
      retellCallId: 'fake_call_1',
      originalData: baseJobData,
      originalJobId: 'job-1',
      silentMs: 600_001,
    });
    expect(retell.ended).toEqual([{ retellCallId: 'fake_call_1', reason: 'hold_cap_exceeded' }]);
  });

  it.each([1, 2] as const)(
    'defers after stop acknowledgement without a replacement or DLQ at attempt %s',
    async (attemptNumber) => {
      const retell = mockRetellPort();
      const calls = mockCallsQueue();
      const dlq = mockDlqQueue();
      const result = await resolveHoldBreach({
        jobDispatcher: createBullMqJobDispatcher({ callsQueue: calls }),
        dlqQueue: dlq as unknown as DlqQueue,
        retellPort: retell,
        retellCallId: 'fake_call_1',
        originalData: { ...baseJobData, attemptNumber },
        originalJobId: 'job-1',
        silentMs: 700_000,
      });
      expect(result).toEqual({ outcome: 'termination_pending' });
      expect(calls.add).not.toHaveBeenCalled();
      expect(dlq.add).not.toHaveBeenCalled();
      expect(retell.startCall).not.toHaveBeenCalled();
    },
  );

  it('propagates ambiguous stop failure without redialling or escalating', async () => {
    const retell = mockRetellPort();
    vi.mocked(retell.endCall).mockRejectedValue(new Error('synthetic stop timeout'));
    const calls = mockCallsQueue();
    const dlq = mockDlqQueue();
    await expect(
      resolveHoldBreach({
        jobDispatcher: createBullMqJobDispatcher({ callsQueue: calls }),
        dlqQueue: dlq as unknown as DlqQueue,
        retellPort: retell,
        retellCallId: 'fake_call_1',
        originalData: baseJobData,
        originalJobId: 'job-1',
        silentMs: 700_000,
      }),
    ).rejects.toThrow('synthetic stop timeout');
    expect(calls.add).not.toHaveBeenCalled();
    expect(dlq.add).not.toHaveBeenCalled();
    expect(retell.startCall).not.toHaveBeenCalled();
  });
});
