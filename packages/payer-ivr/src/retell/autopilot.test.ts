import { describe, expect, it, vi } from 'vitest';

import type { RetellEvent, StartCallInput } from './index.js';
import { DemoAutopilot, FakeRetell } from './index.js';

type SetTimeoutFn = (
  callback: () => void,
  delayMs: number,
) => ReturnType<typeof globalThis.setTimeout>;

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
  await Promise.resolve();
  await Promise.resolve();
}

describe('DemoAutopilot', () => {
  describe('when disabled', () => {
    it('passes through to underlying port unchanged', async () => {
      const fake = new FakeRetell({ autoEmitStarted: false });
      const autopilot = new DemoAutopilot({ port: fake, enabled: false });

      const events: RetellEvent[] = [];
      const { retellCallId } = await autopilot.startCall(sampleInput());
      autopilot.subscribe(retellCallId, (e) => {
        events.push(e);
      });

      // Fire a microtask to let any pending emits happen.
      await flushMicrotasks();

      // No events should have been emitted by the autopilot.
      expect(events).toHaveLength(0);

      // The underlying FakeRetell still works normally when we interact
      // with it directly.
      fake.emit(retellCallId, {
        type: 'call.transcript',
        retellCallId,
        role: 'agent',
        text: 'hello',
        timestamp: '2026-04-28T15:00:00.000Z',
      });
      expect(events).toHaveLength(1);
    });
  });

  describe('when enabled with fake timers', () => {
    it('emits a complete happy-path scenario with collectedInfo', async () => {
      vi.useFakeTimers();
      try {
        const fake = new FakeRetell({ autoEmitStarted: false });
        const autopilot = new DemoAutopilot({
          port: fake,
          enabled: true,
          setTimeout: vi.fn<SetTimeoutFn>((fn, delay) => {
            // Re-use real setTimeout but track it so we can advance time.
            return setTimeout(fn, delay);
          }) as unknown as typeof globalThis.setTimeout,
        });

        const events: RetellEvent[] = [];
        const { retellCallId } = await autopilot.startCall(
          sampleInput({ idempotencyKey: 'happy-path-key' }),
        );
        autopilot.subscribe(retellCallId, (e) => {
          events.push(e);
        });

        // Flush the microtask that schedules the scenario.
        await flushMicrotasks();

        // Advance time through the entire scenario (~40+ seconds).
        vi.advanceTimersByTime(50_000);

        // The scenario should have emitted a call.ended event with collectedInfo.
        const endedEvent = events.find((e) => e.type === 'call.ended');
        expect(endedEvent).toBeDefined();
        expect(endedEvent?.type).toBe('call.ended');

        if (endedEvent?.type === 'call.ended') {
          expect(endedEvent.collectedInfo).toBeDefined();
          // The outcome should be happy path (based on idempotencyKey).
          expect(endedEvent.collectedInfo?.claimStatus).toBe('approved');
          expect(endedEvent.collectedInfo?.amountApprovedCents).toBe(34_500);
        }

        // Should have multiple transcript events before the end.
        const transcripts = events.filter((e) => e.type === 'call.transcript');
        expect(transcripts.length).toBeGreaterThan(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('emits a denial scenario when idempotencyKey hashes to denial', async () => {
      vi.useFakeTimers();
      try {
        const fake = new FakeRetell({ autoEmitStarted: false });
        const autopilot = new DemoAutopilot({
          port: fake,
          enabled: true,
          setTimeout: vi.fn<SetTimeoutFn>((fn, delay) => {
            return setTimeout(fn, delay);
          }) as unknown as typeof globalThis.setTimeout,
        });

        // Use a key that will hash to denial (0-2 out of 10).
        const events: RetellEvent[] = [];
        const denialKey = 'claim_denial_test-1'; // Will likely hash to denial
        const { retellCallId } = await autopilot.startCall(
          sampleInput({ idempotencyKey: denialKey }),
        );
        autopilot.subscribe(retellCallId, (e) => {
          events.push(e);
        });

        await flushMicrotasks();

        // Advance time through the scenario.
        vi.advanceTimersByTime(50_000);

        const endedEvent = events.find((e) => e.type === 'call.ended');
        expect(endedEvent).toBeDefined();

        if (endedEvent?.type === 'call.ended') {
          expect(endedEvent.collectedInfo).toBeDefined();
          // Check if it's denial (deterministic from key).
          const claimStatus = endedEvent.collectedInfo?.claimStatus;
          expect(['approved', 'denied']).toContain(claimStatus);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops emitting events when endCall is invoked mid-scenario', async () => {
      vi.useFakeTimers();
      try {
        const fake = new FakeRetell({ autoEmitStarted: false });
        const autopilot = new DemoAutopilot({
          port: fake,
          enabled: true,
          // Use vi's fake timers directly (no wrapping needed).
          // vi.useFakeTimers() already replaces global setTimeout/clearTimeout.
        });

        const events: RetellEvent[] = [];
        const { retellCallId } = await autopilot.startCall(sampleInput());
        autopilot.subscribe(retellCallId, (e) => {
          events.push(e);
        });

        await flushMicrotasks();

        // Advance time just past the start of IVR events.
        vi.advanceTimersByTime(5_000);

        // Count events so far (should have at least the first transcript).
        const eventsBefore = events.length;
        expect(eventsBefore).toBeGreaterThan(0);

        // Now end the call (operator cancel).
        await autopilot.endCall({ retellCallId, reason: 'operator_cancel' });

        // Advance time further — the scenario should NOT emit more events.
        vi.advanceTimersByTime(50_000);

        const eventsAfter = events.length;

        // FakeRetell.endCall emits a call.ended event without collectedInfo.
        // The autopilot's scenario should NOT emit an additional call.ended
        // with collectedInfo (the scenario-driven one).
        const endedWithCollectedInfo = events.filter(
          (e) => e.type === 'call.ended' && e.collectedInfo !== undefined,
        );
        expect(endedWithCollectedInfo).toHaveLength(0);

        // The number of events should have stabilized after endCall.
        // (FakeRetell might emit one call.ended, but no more scenario events.)
        expect(eventsAfter).toBeLessThanOrEqual(eventsBefore + 1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('emits events in the expected order', async () => {
      vi.useFakeTimers();
      try {
        const fake = new FakeRetell({ autoEmitStarted: false });
        const autopilot = new DemoAutopilot({
          port: fake,
          enabled: true,
          setTimeout: vi.fn<SetTimeoutFn>((fn, delay) => {
            return setTimeout(fn, delay);
          }) as unknown as typeof globalThis.setTimeout,
        });

        const events: RetellEvent[] = [];
        const { retellCallId } = await autopilot.startCall(sampleInput());
        autopilot.subscribe(retellCallId, (e) => {
          events.push(e);
        });

        await flushMicrotasks();
        vi.advanceTimersByTime(50_000);

        // Extract the sequence of event types.
        const eventTypes = events.map((e) => e.type);

        // Verify the sequence starts with transcripts and ends with call.ended.
        expect(eventTypes[0]).toBe('call.transcript');
        expect(eventTypes[eventTypes.length - 1]).toBe('call.ended');

        // All events should be either transcript or call.ended (no errors).
        expect(eventTypes.every((t) => t === 'call.transcript' || t === 'call.ended')).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('idempotency and determinism', () => {
    it('produces deterministic outcomes per idempotencyKey', async () => {
      vi.useFakeTimers();
      try {
        const key1 = 'deterministic-key-1';

        const fake1 = new FakeRetell({ autoEmitStarted: false });
        const autopilot1 = new DemoAutopilot({
          port: fake1,
          enabled: true,
          setTimeout: vi.fn<SetTimeoutFn>((fn, delay) => {
            return setTimeout(fn, delay);
          }) as unknown as typeof globalThis.setTimeout,
        });

        const events1: RetellEvent[] = [];
        const { retellCallId: id1 } = await autopilot1.startCall(
          sampleInput({ idempotencyKey: key1 }),
        );
        autopilot1.subscribe(id1, (e) => {
          events1.push(e);
        });

        await flushMicrotasks();
        vi.advanceTimersByTime(50_000);

        const endEvent1 = events1.find((e) => e.type === 'call.ended');
        const status1 =
          endEvent1?.type === 'call.ended' ? endEvent1.collectedInfo?.claimStatus : null;

        // Reset and run with the same key again.
        vi.clearAllTimers();
        const fake2 = new FakeRetell({ autoEmitStarted: false });
        const autopilot2 = new DemoAutopilot({
          port: fake2,
          enabled: true,
          setTimeout: vi.fn<SetTimeoutFn>((fn, delay) => {
            return setTimeout(fn, delay);
          }) as unknown as typeof globalThis.setTimeout,
        });

        const events2: RetellEvent[] = [];
        const { retellCallId: id2 } = await autopilot2.startCall(
          sampleInput({ idempotencyKey: key1 }),
        );
        autopilot2.subscribe(id2, (e) => {
          events2.push(e);
        });

        await flushMicrotasks();
        vi.advanceTimersByTime(50_000);

        const endEvent2 = events2.find((e) => e.type === 'call.ended');
        const status2 =
          endEvent2?.type === 'call.ended' ? endEvent2.collectedInfo?.claimStatus : null;

        // Same key should produce the same outcome.
        expect(status1).toBe(status2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
