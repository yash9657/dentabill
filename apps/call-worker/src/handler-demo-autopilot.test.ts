import { randomUUID } from 'node:crypto';

import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { DEMO_SCENARIOS, DemoAutopilot, FakeRetell, RetellEventSchema } from '@dentabill/payer-ivr';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadWorkerEnv } from './env.js';
import { createCallJobHandler } from './handler.js';

const organizations: string[] = [];
const cleanups: (() => void)[] = [];

function shortenedScenarioTimers() {
  type Timer = ReturnType<typeof globalThis.setTimeout>;
  interface Pending {
    callback: () => void;
    fired: boolean;
    complete: () => void;
  }
  const pending = new Map<Timer, Pending>();
  const completions: Promise<void>[] = [];
  const delays: number[] = [];
  let released = false;
  const fire = (timer: Timer, entry: Pending): void => {
    pending.delete(timer);
    try {
      entry.callback();
    } finally {
      entry.complete();
    }
  };
  const schedule = (callback: () => void, delay: number): Timer => {
    const scaledDelay = delay / 100;
    delays.push(scaledDelay);
    let complete!: () => void;
    completions.push(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    const timer = globalThis.setTimeout(() => {
      const entry = pending.get(timer);
      if (!entry) return;
      entry.fired = true;
      if (released) fire(timer, entry);
    }, scaledDelay);
    pending.set(timer, { callback, fired: false, complete });
    return timer;
  };
  const cancel: typeof globalThis.clearTimeout = (timer) => {
    globalThis.clearTimeout(timer);
    if (typeof timer === 'object') {
      pending.get(timer)?.complete();
      pending.delete(timer);
    }
  };
  const cleanup = (): void => {
    for (const timer of pending.keys()) cancel(timer);
  };
  cleanups.push(cleanup);
  return {
    // Only DemoAutopilot's two-argument callback API is used; DB/worker timers stay real.
    setTimeout: schedule as unknown as typeof globalThis.setTimeout,
    clearTimeout: cancel,
    delays,
    release(): void {
      released = true;
      for (const [timer, entry] of pending) if (entry.fired) fire(timer, entry);
    },
    async drained(): Promise<void> {
      await Promise.all(completions);
    },
  };
}

async function setup() {
  const organization = await prisma.organization.create({
    data: {
      clerkOrgId: `synthetic_autopilot_${randomUUID()}`,
      name: 'Synthetic Autopilot Practice',
      npi: '1234567890',
    },
  });
  organizations.push(organization.id);
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization.id,
      claimNumber: 'SYNTHETIC-AUTOPILOT-CLAIM',
      subscriberId: 'SYNTHETIC-AUTOPILOT-MEMBER',
      patientDOBHash: 'synthetic-no-patient',
      payerCode: 'DELTA_DENTAL_PPO',
      cdtCodes: ['D1110'],
      claimAmount: '100.00',
      serviceDate: new Date('2026-10-01T00:00:00.000Z'),
      status: 'IN_QUEUE',
      priority: 80,
    },
  });
  const data = {
    organizationId: organization.id,
    claimId: claim.id,
    payerCode: claim.payerCode,
    attemptNumber: 1,
    claimPriority: 80,
    idempotencyKey: `autopilot_${randomUUID()}`,
  };
  const intent = await prisma.callIntent.create({
    data: { ...data, payerCode: claim.payerCode, claimVersion: claim.updatedAt },
  });
  const retellCallId = `fake_autopilot_${randomUUID()}`;
  const fake = new FakeRetell({ retellCallIdFactory: () => retellCallId });
  const timers = shortenedScenarioTimers();
  const autopilot = new DemoAutopilot({ port: fake, enabled: true, ...timers });
  const env = loadWorkerEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: 'redis://localhost:6379/14',
    NODE_ENV: 'test',
    RETELL_API_KEY: '',
    DEMO_AUTOPILOT: 'true',
    WORKER_OUTBOUND_NUMBER: '+15555550100',
  });
  const handler = createCallJobHandler({
    prisma,
    retellPort: autopilot,
    env,
    observationWindowMs: 1_000,
    logger: createLogger({ level: 'fatal', pretty: false }),
    outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
  });
  const job = { id: data.idempotencyKey, data } as Parameters<typeof handler>[0];
  const result = handler(job, 'synthetic-autopilot-handler');
  const call = await vi.waitFor(
    async () => {
      const registered = await prisma.call.findFirst({
        where: { organizationId: organization.id, retellCallId },
      });
      if (!registered) throw new Error('Waiting for synthetic demo registration.');
      return registered;
    },
    { timeout: 2_000, interval: 10 },
  );
  return { organization, intent, call, fake, timers, result };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const organizationId of organizations.splice(0)) {
    await prisma.callIntent.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('bounded handler with the actual DemoAutopilot wrapper', () => {
  it('persists the complete shortened scenario and one summary obligation', async () => {
    const { organization, intent, call, fake, timers, result } = await setup();
    timers.release();
    expect((await result).outcome).toBe('COMPLETED');
    await timers.drained();
    expect(fake.startedCalls).toHaveLength(1);
    expect(fake.endedCalls).toHaveLength(0);
    expect(Math.max(...timers.delays)).toBeLessThan(1_000);
    const events = await prisma.callEvent.findMany({
      where: { callId: call.id, call: { organizationId: organization.id } },
    });
    const ends = events.filter((event) => event.eventType === 'call.ended');
    expect(ends).toHaveLength(1);
    const ended = RetellEventSchema.parse(ends[0]?.data);
    if (ended.type !== 'call.ended') throw new Error('Expected terminal demo source.');
    const selected = DEMO_SCENARIOS.find(
      (scenario) => scenario.id === ended.collectedInfo?.scenarioId,
    );
    expect(selected).toBeDefined();
    expect(events.filter((event) => event.eventType === 'call.transcript')).toHaveLength(
      selected?.turns.length ?? -1,
    );
    expect(ended.durationSeconds).toBe(selected?.durationSeconds);
    expect(
      await prisma.callIntent.findFirstOrThrow({
        where: { id: intent.id, organizationId: organization.id },
      }),
    ).toMatchObject({ state: 'TERMINAL', observationReviewAt: null, observationErrorCode: null });
    expect(
      await prisma.jobOutbox.count({
        where: { organizationId: organization.id, kind: 'SUMMARY_GENERATE' },
      }),
    ).toBe(1);
  });

  it('honors a cancel marker before scenario completion and issues one synthetic Stop', async () => {
    const { organization, intent, call, fake, timers, result } = await setup();
    expect(call.endedAt).toBeNull();
    expect(
      await prisma.callEvent.count({
        where: {
          callId: call.id,
          call: { organizationId: organization.id },
          eventType: 'call.ended',
        },
      }),
    ).toBe(0);
    await prisma.call.updateMany({
      where: { id: call.id, organizationId: organization.id },
      data: { cancelRequestedAt: new Date(), cancelRequestedBy: 'synthetic-autopilot-operator' },
    });
    expect((await result).outcome).toBe('COMPLETED');
    expect(fake.endedCalls).toEqual([
      { retellCallId: call.retellCallId, reason: 'operator_cancel' },
    ]);
    timers.release();
    await timers.drained();
    const events = await prisma.callEvent.findMany({
      where: {
        callId: call.id,
        call: { organizationId: organization.id },
        eventType: 'call.ended',
      },
    });
    expect(events).toHaveLength(1);
    const ended = RetellEventSchema.parse(events[0]?.data);
    expect(ended).toMatchObject({ type: 'call.ended', endReason: 'agent_hangup' });
    expect(ended).not.toHaveProperty('collectedInfo');
    expect(
      await prisma.callIntent.findFirstOrThrow({
        where: { id: intent.id, organizationId: organization.id },
      }),
    ).toMatchObject({
      state: 'TERMINAL',
      stopAttempts: 1,
      stopReason: 'operator_cancel',
      observationReviewAt: null,
      observationErrorCode: null,
      stopAcknowledgedAt: expect.any(Date),
    });
    expect(
      await prisma.jobOutbox.count({
        where: { organizationId: organization.id, kind: 'SUMMARY_GENERATE' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: organization.id, resourceId: call.id, action: 'call.end' },
      }),
    ).toBe(1);
    expect(fake.startedCalls).toHaveLength(1);
  });
});
