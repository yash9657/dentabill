import { randomUUID } from 'node:crypto';

import { getOrgScopedDb, prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { FakeRetell } from '@dentabill/payer-ivr';
import { asBullMqJob, CALL_JOB_NAME, type CallJobData, type CallJobResult } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadWorkerEnv } from './env.js';
import { createCallJobHandler } from './handler.js';

const logger = createLogger({ level: 'fatal', pretty: false });
const env = loadWorkerEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: 'redis://localhost:6379/14',
  RETELL_API_KEY: '',
  WORKER_OUTBOUND_NUMBER: '+15555550100',
});

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
});

async function seed() {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic Intent Practice', clerkOrgId: randomUUID(), npi: '1234567890' },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'SYNTHETIC',
      subscriberId: 'SYNTHETIC-MEMBER',
      patientDOBHash: 'synthetic',
      cdtCodes: ['D1110'],
      claimAmount: '100',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-10-01'),
      status: 'IN_QUEUE',
      priority: 80,
    },
  });
  const data: CallJobData = {
    organizationId: org.id,
    claimId: claim.id,
    payerCode: claim.payerCode,
    attemptNumber: 1,
    claimPriority: 80,
    idempotencyKey: `call_${randomUUID()}`,
  };
  const intent = await prisma.callIntent.create({
    data: { ...data, payerCode: claim.payerCode, claimVersion: claim.updatedAt },
  });
  const fake = new FakeRetell({ retellCallIdFactory: () => `fake_${intent.id}` });
  const handler = createCallJobHandler({
    prisma,
    logger,
    env,
    retellPort: fake,
    outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
  });
  const job = asBullMqJob<CallJobData, CallJobResult, typeof CALL_JOB_NAME>({
    id: data.idempotencyKey,
    name: CALL_JOB_NAME,
    data,
    attemptsMade: 0,
  });
  return { org, claim, intent, data, fake, handler, job };
}

async function waitStarted(fake: FakeRetell): Promise<void> {
  await vi.waitFor(() => {
    expect(fake.startedCalls).toHaveLength(1);
  });
}

describe('durable outbound call ownership', () => {
  it('racing handlers submit once, finalize once, and reject terminal replay', async () => {
    const s = await seed();
    const runs = [s.handler(s.job, 'one'), s.handler(s.job, 'two')];
    await waitStarted(s.fake);
    expect(s.fake.startedCalls[0]?.idempotencyKey).toBe(s.intent.id);
    await s.fake.simulateHappyPath(`fake_${s.intent.id}`);
    const results = await Promise.all(runs);
    expect(results.filter((r) => r.outcome === 'COMPLETED')).toHaveLength(1);
    expect(s.fake.startedCalls).toHaveLength(1);
    expect(await s.handler(s.job, 'replay')).toMatchObject({ outcome: 'ALREADY_PROCESSED' });
    expect(
      await prisma.auditLog.count({ where: { organizationId: s.org.id, action: 'call.end' } }),
    ).toBe(1);
    const intent = await prisma.callIntent.findFirstOrThrow({
      where: { id: s.intent.id, organizationId: s.org.id },
    });
    expect(intent).toMatchObject({
      state: 'TERMINAL',
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('persists uncertainty after response loss and never submits on later deliveries', async () => {
    const s = await seed();
    const create = vi
      .spyOn(s.fake, 'startCall')
      .mockRejectedValue(new Error('synthetic response lost'));
    expect(await s.handler(s.job, 'first')).toMatchObject({
      outcome: 'RECONCILIATION_REQUIRED',
      callId: null,
    });
    const restarted = createCallJobHandler({
      prisma,
      logger,
      env,
      retellPort: s.fake,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    expect(await restarted(s.job, 'retry')).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(
      await prisma.callIntent.findFirst({ where: { id: s.intent.id, organizationId: s.org.id } }),
    ).toMatchObject({ state: 'UNKNOWN', lastErrorCode: 'PROVIDER_ACCEPTANCE_UNKNOWN' });
    expect(
      await prisma.claim.findFirst({ where: { id: s.claim.id, organizationId: s.org.id } }),
    ).toMatchObject({ status: 'MANUAL_REVIEW' });
    await expect(
      prisma.callIntent.create({
        data: {
          ...s.data,
          payerCode: s.claim.payerCode,
          idempotencyKey: 'different-queue-key',
          claimVersion: s.claim.updatedAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps submission fenced when post-acceptance registration rolls back', async () => {
    const s = await seed();
    const faultDb = prisma.$extends({
      query: {
        auditLog: {
          create({ args, query }) {
            if (args.data.action === 'call.start') throw new Error('synthetic registration fault');
            return query(args);
          },
        },
      },
    });
    const handler = createCallJobHandler({
      prisma: faultDb,
      logger,
      env,
      retellPort: s.fake,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    await expect(handler(s.job, 'first')).rejects.toThrow('synthetic registration fault');
    expect(await s.handler(s.job, 'restart')).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED' });
    expect(s.fake.startedCalls).toHaveLength(1);
    expect(await prisma.call.count({ where: { organizationId: s.org.id } })).toBe(0);
    expect(
      await prisma.callIntent.findFirst({ where: { id: s.intent.id, organizationId: s.org.id } }),
    ).toMatchObject({ state: 'SUBMITTING', callId: null });
  });

  it('rolls back submission ownership if its audit cannot commit, before any provider request', async () => {
    const s = await seed();
    const faultDb = prisma.$extends({
      query: {
        auditLog: {
          create({ args, query }) {
            if (args.data.action === 'call.intent.submitting')
              throw new Error('synthetic audit fault');
            return query(args);
          },
        },
      },
    });
    const handler = createCallJobHandler({
      prisma: faultDb,
      logger,
      env,
      retellPort: s.fake,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    await expect(handler(s.job, 'first')).rejects.toThrow('synthetic audit fault');
    expect(s.fake.startedCalls).toHaveLength(0);
    expect(
      await prisma.callIntent.findFirst({ where: { id: s.intent.id, organizationId: s.org.id } }),
    ).toMatchObject({ state: 'READY', submittedAt: null });
    expect(
      await prisma.claim.findFirst({ where: { id: s.claim.id, organizationId: s.org.id } }),
    ).toMatchObject({ status: 'IN_QUEUE', lastCallAt: null });
  });

  it('resumes a persisted same-process terminal event after finalization rolls back', async () => {
    const s = await seed();
    const faultDb = prisma.$extends({
      query: {
        auditLog: {
          create({ args, query }) {
            if (args.data.action === 'call.end') throw new Error('synthetic finalization fault');
            return query(args);
          },
        },
      },
    });
    const handler = createCallJobHandler({
      prisma: faultDb,
      logger,
      env,
      retellPort: s.fake,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    const pending = handler(s.job, 'first');
    const rejection = expect(pending).rejects.toThrow('synthetic finalization fault');
    await waitStarted(s.fake);
    await s.fake.simulateHappyPath(`fake_${s.intent.id}`);
    await rejection;
    const resumed = await s.handler(s.job, 'resume');
    expect(resumed.outcome).toBe('COMPLETED');
    expect(s.fake.startedCalls).toHaveLength(1);
    expect(
      await prisma.auditLog.count({ where: { organizationId: s.org.id, action: 'call.end' } }),
    ).toBe(1);
  });

  it('database constraints reject intent claims and accepted calls from another tenant', async () => {
    const first = await seed();
    const second = await seed();
    await expect(
      prisma.callIntent.create({
        data: {
          ...first.data,
          organizationId: second.org.id,
          idempotencyKey: 'forged-tenant',
          payerCode: first.claim.payerCode,
          claimVersion: first.claim.updatedAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const foreignCall = await prisma.call.create({
      data: {
        organizationId: second.org.id,
        claimId: second.claim.id,
        retellCallId: 'synthetic_foreign_call',
      },
    });
    await expect(
      prisma.callIntent.updateMany({
        where: { id: first.intent.id, organizationId: first.org.id },
        data: { callId: foreignCall.id, state: 'ACCEPTED' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('invalidates the exact reserved claim version before dialing', async () => {
    const s = await seed();
    await prisma.claim.updateMany({
      where: { id: s.claim.id, organizationId: s.org.id },
      data: {
        subscriberId: 'SYNTHETIC-CORRECTION',
        updatedAt: new Date(s.claim.updatedAt.getTime() + 1000),
      },
    });
    expect(await s.handler(s.job, 'stale')).toMatchObject({ outcome: 'BLOCKED' });
    expect(s.fake.startedCalls).toHaveLength(0);
    expect(
      await prisma.callIntent.findFirst({ where: { id: s.intent.id, organizationId: s.org.id } }),
    ).toMatchObject({ state: 'CANCELLED', lastErrorCode: 'STALE_CLAIM' });
  });

  it('refuses unreserved keys, forged payloads and cross-tenant reads without touching the claim', async () => {
    const s = await seed();
    for (const patch of [
      { idempotencyKey: 'legacy-r2' },
      { claimPriority: 1 },
      { attemptNumber: 2 },
      { organizationId: 'foreign' },
    ]) {
      const job = asBullMqJob<CallJobData, CallJobResult, typeof CALL_JOB_NAME>({
        id: 'forged',
        name: CALL_JOB_NAME,
        data: { ...s.data, ...patch },
        attemptsMade: 0,
      });
      expect(await s.handler(job, 'blocked')).toMatchObject({ outcome: 'BLOCKED' });
    }
    expect(s.fake.startedCalls).toHaveLength(0);
    expect(await getOrgScopedDb('foreign').callIntent.findMany({})).toEqual([]);
    expect(
      await prisma.claim.findFirst({ where: { id: s.claim.id, organizationId: s.org.id } }),
    ).toMatchObject({ status: 'IN_QUEUE' });
  });
});
