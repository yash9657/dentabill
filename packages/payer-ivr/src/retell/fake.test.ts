import { describe, expect, it } from 'vitest';

import { FakeRetell, RetellCallEndReason, type RetellEvent, type StartCallInput } from './index.js';

const sampleInput = (overrides: Partial<StartCallInput> = {}): StartCallInput => ({
  payerCode: 'DELTA_DENTAL_PPO',
  agentId: 'agent_delta_dental_ppo',
  fromNumberE164: '+15551234567',
  toNumberE164: '+18007656003',
  agentMetadata: {
    practiceName: 'Sunrise Family Dental',
    providerNpi: '1234567890',
    subscriberId: 'SUB-001',
    dateOfService: '2026-03-15',
  },
  idempotencyKey: 'claim_test_001-1',
  ...overrides,
});

async function flushMicrotasks(): Promise<void> {
  // Two microtask flushes — `startCall`'s queueMicrotask schedules the
  // emit; the emit itself fires listeners that may also be async.
  await Promise.resolve();
  await Promise.resolve();
}

describe('FakeRetell — RetellPort surface', () => {
  it('returns a deterministic retellCallId from startCall', async () => {
    const fake = new FakeRetell();
    const a = await fake.startCall(sampleInput());
    const b = await fake.startCall(sampleInput({ idempotencyKey: 'claim_other-1' }));
    expect(a.retellCallId).toBe('fake_call_1');
    expect(b.retellCallId).toBe('fake_call_2');
  });

  it('startCall is idempotent on idempotencyKey within a fake instance', async () => {
    const fake = new FakeRetell();
    const a = await fake.startCall(sampleInput());
    const b = await fake.startCall(sampleInput());
    expect(a.retellCallId).toBe(b.retellCallId);
    expect(fake.startedCalls).toHaveLength(2); // both invocations are recorded
  });

  it('rejects malformed StartCallInput at the trust boundary', async () => {
    const fake = new FakeRetell();
    await expect(fake.startCall(sampleInput({ toNumberE164: 'not-e164' }))).rejects.toThrow();
  });

  it('auto-emits call.started after a microtask so subscribers can register first', async () => {
    const fake = new FakeRetell();
    const events: RetellEvent[] = [];
    const { retellCallId } = await fake.startCall(sampleInput());
    fake.subscribe(retellCallId, (event) => {
      events.push(event);
    });
    await flushMicrotasks();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('call.started');
  });

  it('skips auto-emit when configured', async () => {
    const fake = new FakeRetell({ autoEmitStarted: false });
    const events: RetellEvent[] = [];
    const { retellCallId } = await fake.startCall(sampleInput());
    fake.subscribe(retellCallId, (event) => {
      events.push(event);
    });
    await flushMicrotasks();
    expect(events).toHaveLength(0);
  });

  it('subscribe + unsubscribe wires event delivery correctly', async () => {
    const fake = new FakeRetell({ autoEmitStarted: false });
    const seen: RetellEvent[] = [];
    const { retellCallId } = await fake.startCall(sampleInput());
    const unsubscribe = fake.subscribe(retellCallId, (event) => {
      seen.push(event);
    });

    fake.emit(retellCallId, {
      type: 'call.transcript',
      retellCallId,
      role: 'agent',
      text: 'hello',
      timestamp: '2026-04-28T15:00:00.000Z',
    });
    expect(seen).toHaveLength(1);

    unsubscribe();
    fake.emit(retellCallId, {
      type: 'call.transcript',
      retellCallId,
      role: 'agent',
      text: 'should not arrive',
      timestamp: '2026-04-28T15:00:01.000Z',
    });
    expect(seen).toHaveLength(1);
  });

  it('emit is scoped per retellCallId — never crosses calls', async () => {
    const fake = new FakeRetell({ autoEmitStarted: false });
    const seenA: RetellEvent[] = [];
    const seenB: RetellEvent[] = [];
    const { retellCallId: idA } = await fake.startCall(sampleInput());
    const { retellCallId: idB } = await fake.startCall(
      sampleInput({ idempotencyKey: 'claim_b-1' }),
    );
    fake.subscribe(idA, (e) => {
      seenA.push(e);
    });
    fake.subscribe(idB, (e) => {
      seenB.push(e);
    });

    fake.emit(idA, {
      type: 'call.transcript',
      retellCallId: idA,
      role: 'agent',
      text: 'A only',
      timestamp: '2026-04-28T15:00:00.000Z',
    });
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(0);
  });

  it('endCall maps operator-cause reasons onto agent_hangup', async () => {
    const fake = new FakeRetell();
    const events: RetellEvent[] = [];
    const { retellCallId } = await fake.startCall(sampleInput());
    fake.subscribe(retellCallId, (event) => {
      events.push(event);
    });
    await flushMicrotasks();
    await fake.endCall({ retellCallId, reason: 'duration_cap_exceeded' });
    await flushMicrotasks();
    const ended = events.find((e) => e.type === 'call.ended');
    expect(ended).toBeDefined();
    if (ended?.type === 'call.ended') {
      expect(ended.endReason).toBe(RetellCallEndReason.AGENT_HANGUP);
    }
    expect(fake.endedCalls).toEqual([{ retellCallId, reason: 'duration_cap_exceeded' }]);
  });

  it('endCall is idempotent on a call that already ended', async () => {
    const fake = new FakeRetell();
    const { retellCallId } = await fake.startCall(sampleInput());
    await flushMicrotasks();
    await fake.endCall({ retellCallId, reason: 'operator_cancel' });
    await flushMicrotasks();
    await expect(
      fake.endCall({ retellCallId, reason: 'operator_cancel' }),
    ).resolves.toBeUndefined();
  });

  it('endCall on an unknown retellCallId is a no-op', async () => {
    const fake = new FakeRetell();
    await expect(
      fake.endCall({ retellCallId: 'never_existed', reason: 'operator_cancel' }),
    ).resolves.toBeUndefined();
  });
});

describe('FakeRetell — pre-baked scenarios', () => {
  it('simulateHappyPath emits transcript turns then call.ended completed', async () => {
    const fake = new FakeRetell({ autoEmitStarted: false });
    const events: RetellEvent[] = [];
    const { retellCallId } = await fake.startCall(sampleInput());
    fake.subscribe(retellCallId, (event) => {
      events.push(event);
    });

    await fake.simulateHappyPath(retellCallId);

    const transcripts = events.filter((e) => e.type === 'call.transcript');
    expect(transcripts.length).toBeGreaterThanOrEqual(2);
    const ended = events.find((e) => e.type === 'call.ended');
    expect(ended).toBeDefined();
    if (ended?.type === 'call.ended') {
      expect(ended.endReason).toBe(RetellCallEndReason.COMPLETED);
      expect(ended.collectedInfo?.claimStatus).toBe('approved');
    }
  });

  it('simulateDenial ends `completed` but flags claimStatus=denied with denialCode', async () => {
    const fake = new FakeRetell({ autoEmitStarted: false });
    const events: RetellEvent[] = [];
    const { retellCallId } = await fake.startCall(sampleInput());
    fake.subscribe(retellCallId, (event) => {
      events.push(event);
    });

    await fake.simulateDenial(retellCallId, 'CO-50');

    const ended = events.find((e) => e.type === 'call.ended');
    expect(ended).toBeDefined();
    if (ended?.type === 'call.ended') {
      expect(ended.collectedInfo?.claimStatus).toBe('denied');
      expect(ended.collectedInfo?.denialCode).toBe('CO-50');
    }
  });

  it('simulateHoldTimeout leaves the call dangling for the worker hold detector to end', async () => {
    const fake = new FakeRetell({ autoEmitStarted: false });
    const events: RetellEvent[] = [];
    const { retellCallId } = await fake.startCall(sampleInput());
    fake.subscribe(retellCallId, (event) => {
      events.push(event);
    });

    await fake.simulateHoldTimeout(retellCallId);

    // Exactly one system transcript event ("hold music"); no call.ended yet.
    const ends = events.filter((e) => e.type === 'call.ended');
    expect(ends).toHaveLength(0);
    const sys = events.filter((e) => e.type === 'call.transcript' && e.role === 'system');
    expect(sys).toHaveLength(1);

    // The worker would invoke endCall after MAX_HOLD_MS. Emulate that.
    await fake.endCall({ retellCallId, reason: 'hold_cap_exceeded' });
    await flushMicrotasks();
    const endsAfter = events.filter((e) => e.type === 'call.ended');
    expect(endsAfter).toHaveLength(1);
  });
});

describe('FakeRetell — observability', () => {
  it('records every startCall input verbatim', async () => {
    const fake = new FakeRetell();
    const a = sampleInput();
    const b = sampleInput({ idempotencyKey: 'claim_other-1' });
    await fake.startCall(a);
    await fake.startCall(b);
    expect(fake.startedCalls).toEqual([a, b]);
  });

  it('reset() clears state between tests', async () => {
    const fake = new FakeRetell();
    await fake.startCall(sampleInput());
    fake.reset();
    expect(fake.startedCalls).toEqual([]);
    // Counter resets too, so the next call gets fake_call_1 again.
    const next = await fake.startCall(sampleInput());
    expect(next.retellCallId).toBe('fake_call_1');
  });
});
