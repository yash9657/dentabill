import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { selectDemoScenario } from './demo-scenarios.js';

import type { RetellEvent, StartCallInput } from './index.js';
import { DemoAutopilot, FakeRetell, RetellEventSchema } from './index.js';

const sampleInput = (overrides: Partial<StartCallInput> = {}): StartCallInput => ({
  payerCode: 'DELTA_DENTAL_PPO',
  agentId: 'agent_delta_dental_ppo',
  fromNumberE164: '+15551234567',
  toNumberE164: '+18007656003',
  agentMetadata: {
    practiceName: 'Synthetic demo practice',
    providerNpi: '9999999999',
    subscriberId: 'SYNTHETIC-DEMO-SUBSCRIBER-A',
    dateOfService: '2026-10-01',
  },
  idempotencyKey: 'synthetic-call-intent-a',
  ...overrides,
});

function setup(enabled = true) {
  const fake = new FakeRetell({ autoEmitStarted: false });
  const autopilot = new DemoAutopilot({ port: fake, enabled });
  const events: RetellEvent[] = [];
  return {
    fake,
    autopilot,
    events,
    start: async (input = sampleInput()): Promise<string> => {
      const { retellCallId } = await autopilot.startCall(input);
      autopilot.subscribe(retellCallId, (event) => {
        events.push(RetellEventSchema.parse(event));
      });
      return retellCallId;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T15:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('DemoAutopilot', () => {
  it('passes through without scripts when disabled', async () => {
    const { start, fake, events } = setup(false);
    const retellCallId = await start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toEqual([]);
    fake.emit(retellCallId, {
      type: 'call.transcript',
      retellCallId,
      role: 'agent',
      text: 'Provider event',
      timestamp: new Date().toISOString(),
    });
    expect(events).toHaveLength(1);
    expect(fake.startedCalls[0]).toEqual(sampleInput());
  });

  it.each([
    ['DELTA_DENTAL_PPO', 'Delta Dental PPO'],
    ['CIGNA_DENTAL', 'Cigna Dental'],
    ['METLIFE_DENTAL', 'MetLife Dental'],
  ] as const)(
    'keeps %s dialogue and collected facts payer-correct',
    async (payerCode, payerName) => {
      const { start, events } = setup();
      await start(sampleInput({ payerCode }));
      await vi.advanceTimersByTimeAsync(50_000);
      const transcript = events
        .filter((event) => event.type === 'call.transcript')
        .map((event) => event.text)
        .join('\n');
      expect(transcript).toContain(`simulated ${payerName}`);
      expect(transcript).toContain('Synthetic demo practice');
      expect(transcript).toContain('SYNTHETIC-DEMO-SUBSCRIBER-A');
      expect(transcript).toContain('2026-10-01');
      expect(transcript).toContain('No payer has been contacted.');
      expect(transcript).toContain('No audio is playing.');
      expect(transcript).not.toMatch(/Bright Smile|\$|approved|paid|denial|denied|\{\{/i);
      const ends = events.filter((event) => event.type === 'call.ended');
      expect(ends).toHaveLength(1);
      expect(ends[0]?.collectedInfo).toEqual({
        ...selectDemoScenario(payerCode).outcome,
        simulation: true,
        payerCode,
        scenarioId: selectDemoScenario(payerCode).id,
      });
      expect(events.at(-1)?.type).toBe('call.ended');
      expect(events.every((event) => ['call.transcript', 'call.ended'].includes(event.type))).toBe(
        true,
      );
    },
  );

  it('reports the elapsed scheduled duration and waits until after the last turn', async () => {
    const { start, events } = setup();
    const startedAt = Date.now();
    await start();
    await vi.advanceTimersByTimeAsync(37_000);
    expect(events.at(-1)).toMatchObject({
      type: 'call.transcript',
      text: 'Thank you. The practice will review this simulated result.',
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(events.some((event) => event.type === 'call.ended')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const ended = events.find((event) => event.type === 'call.ended');
    expect(ended?.durationSeconds).toBe((Date.now() - startedAt) / 1_000);
    expect(ended?.endedAt).toBe(new Date().toISOString());
  });

  it('keeps the neutral outcome when a fresh call intent has a different key', async () => {
    const { autopilot, start, events } = setup();
    await start(sampleInput({ idempotencyKey: 'different-key-a' }));
    const { retellCallId } = await autopilot.startCall(
      sampleInput({ idempotencyKey: 'different-key-b' }),
    );
    autopilot.subscribe(retellCallId, (event) => {
      events.push(event);
    });
    await vi.advanceTimersByTimeAsync(50_000);
    const ends = events.filter((event) => event.type === 'call.ended');
    expect(ends).toHaveLength(2);
    expect(ends[0]?.collectedInfo).toEqual(ends[1]?.collectedInfo);
  });

  it('does not schedule a second script for an in-flight fake-call replay', async () => {
    const { autopilot, start, events } = setup();
    const retellCallId = await start();
    expect(await autopilot.startCall(sampleInput())).toMatchObject({ retellCallId });
    await vi.advanceTimersByTimeAsync(50_000);
    expect(events.filter((event) => event.type === 'call.ended')).toHaveLength(1);
  });

  it('stops the script after operator cancellation', async () => {
    const { autopilot, start, events } = setup();
    const retellCallId = await start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events.length).toBeGreaterThan(0);
    await autopilot.endCall({ retellCallId, reason: 'operator_cancel' });
    const count = events.length;
    await vi.advanceTimersByTimeAsync(50_000);
    expect(events).toHaveLength(count);
    const ends = events.filter((event) => event.type === 'call.ended');
    expect(ends).toHaveLength(1);
    expect(ends[0]).not.toHaveProperty('collectedInfo');
  });
});
