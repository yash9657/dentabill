import { createHash, randomUUID } from 'node:crypto';

import { prisma, type Prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import {
  FakeRetell,
  StartCallInputSchema,
  type RetellCallCandidate,
  type RetellCallEndedEvent,
  type RetellReconciliationClient,
} from '@dentabill/payer-ivr';
import {
  asBullMqJob,
  CALL_JOB_NAME,
  CallJobDataSchema,
  type CallJobData,
  type CallJobResult,
} from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  getCallIntentReconciliationEligibility,
  reconcileCallIntent,
} from './call-reconciliation.js';
import { loadWorkerEnv } from './env.js';
import { createCallJobHandler } from './handler.js';

const NOW = new Date('2030-01-01T00:00:00.000Z');
const clock = (): Date => new Date(NOW);
const organizations: string[] = [];
beforeAll(async () => prisma.$connect());
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await prisma.organization.deleteMany({ where: { id: { in: organizations.splice(0) } } });
});
afterAll(async () => prisma.$disconnect());

async function seed(state: 'UNKNOWN' | 'SUBMITTING' | 'READY' = 'UNKNOWN') {
  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `recovery_${randomUUID()}`,
      name: 'Synthetic Recovery Practice',
      npi: '1234567890',
    },
  });
  organizations.push(org.id);
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
      status: 'MANUAL_REVIEW',
      priority: 80,
    },
  });
  const intent = await prisma.callIntent.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      idempotencyKey: `call_${randomUUID()}`,
      payerCode: claim.payerCode,
      attemptNumber: 1,
      claimPriority: 80,
      claimVersion: claim.updatedAt,
      state,
      submittedAt: new Date(NOW.getTime() - 120_000),
      lastErrorCode: 'PROVIDER_ACCEPTANCE_UNKNOWN',
    },
  });
  const snapshot = StartCallInputSchema.parse({
    payerCode: claim.payerCode,
    agentId: 'agent_synthetic',
    fromNumberE164: '+15555550100',
    toNumberE164: '+15555550200',
    agentMetadata: {
      practiceName: 'Synthetic Recovery Practice',
      providerNpi: '1234567890',
      subscriberId: 'SYNTHETIC-MEMBER',
      dateOfService: '2026-10-01',
    },
    idempotencyKey: intent.id,
  });
  await prisma.callIntent.updateMany({
    where: { id: intent.id, organizationId: org.id },
    data: {
      requestPayload: snapshot,
      requestHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    },
  });
  const candidate: RetellCallCandidate = {
    providerCallId: `provider_${randomUUID()}`,
    agentId: snapshot.agentId,
    fromNumberE164: snapshot.fromNumberE164,
    toNumberE164: snapshot.toNumberE164,
    intentId: intent.id,
    callType: 'phone_call',
    direction: 'outbound',
    startedAt: null,
  };
  const terminalEvent: RetellCallEndedEvent = {
    type: 'call.ended',
    retellCallId: candidate.providerCallId,
    endReason: 'agent_hangup',
    endedAt: null,
    durationSeconds: null,
    transcript: { text: 'Synthetic payer status, no payment evidence.', turns: null },
  };
  const provider = {
    findCallsByIntent: vi
      .fn<RetellReconciliationClient['findCallsByIntent']>()
      .mockResolvedValue([candidate]),
    getCall: vi
      .fn<RetellReconciliationClient['getCall']>()
      .mockResolvedValue({ candidate, terminalEvent }),
  };
  const options = {
    prisma,
    organizationId: org.id,
    intentId: intent.id,
    clerkUserId: 'user_synthetic_reviewer',
    provider,
    clock,
  };
  const read = () =>
    prisma.callIntent.findFirstOrThrow({ where: { id: intent.id, organizationId: org.id } });
  return { org, claim, intent, snapshot, candidate, terminalEvent, provider, options, read };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function processor() {
  const fake = new FakeRetell();
  const env = loadWorkerEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: 'redis://localhost:6379/14',
    RETELL_API_KEY: '',
    WORKER_OUTBOUND_NUMBER: '+15555550100',
  });
  return {
    fake,
    handler: createCallJobHandler({
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
      logger: createLogger({ level: 'fatal', pretty: false }),
      clock,
    }),
  };
}

function job(data: CallJobData) {
  return asBullMqJob<CallJobData, CallJobResult, typeof CALL_JOB_NAME>({
    id: data.idempotencyKey,
    name: CALL_JOB_NAME,
    data,
    attemptsMade: 0,
  });
}

describe('positive-only recovery against PostgreSQL', () => {
  it('binds final provider source and a distinct resume obligation atomically, then finalizes without dialing or changing reviewed claim state', async () => {
    const s = await seed();
    const result = await reconcileCallIntent(s.options);
    expect(result).toMatchObject({ outcome: 'RECOVERED', callId: expect.any(String) });
    expect(await s.read()).toMatchObject({
      state: 'ACCEPTED',
      callId: result.callId,
      reconcileAttempts: 1,
      reconcileOutcome: 'RECOVERED',
      reconcileLeaseToken: null,
    });
    const call = await prisma.call.findFirstOrThrow({
      where: { id: result.callId!, organizationId: s.org.id },
    });
    expect(call).toMatchObject({
      startedAt: null,
      endedAt: null,
      status: 'INITIATED',
      attemptNumber: 1,
    });
    const event = await prisma.callEvent.findFirstOrThrow({
      where: { callId: call.id, call: { organizationId: s.org.id } },
    });
    expect(event.data).toMatchObject({
      ...s.terminalEvent,
      source: 'retell_get_call',
      retrievedAt: NOW.toISOString(),
    });
    expect(await prisma.retellWebhookEvent.count({ where: { organizationId: s.org.id } })).toBe(0);
    const outbox = await prisma.jobOutbox.findFirstOrThrow({
      where: { organizationId: s.org.id, kind: 'CALL_PLACE' },
    });
    const data = CallJobDataSchema.parse(outbox.payload);
    expect(data).toMatchObject({
      idempotencyKey: `call.resume.${s.intent.id}`,
      resume: { intentId: s.intent.id, callId: call.id },
    });
    expect(data.idempotencyKey).not.toBe(s.intent.idempotencyKey);
    const { fake, handler } = processor();
    const results = await Promise.all([handler(job(data), 'one'), handler(job(data), 'two')]);
    expect(results.filter((r) => r.outcome === 'COMPLETED')).toHaveLength(1);
    expect(fake.startedCalls).toHaveLength(0);
    expect(await handler(job(data), 'again')).toMatchObject({ outcome: 'ALREADY_PROCESSED' });
    expect(
      await prisma.claim.findFirst({ where: { id: s.claim.id, organizationId: s.org.id } }),
    ).toEqual(s.claim);
    expect(
      await prisma.jobOutbox.count({
        where: { organizationId: s.org.id, kind: 'SUMMARY_GENERATE' },
      }),
    ).toBe(1);
    expect(await reconcileCallIntent(s.options)).toEqual({
      outcome: 'ALREADY_BOUND',
      callId: call.id,
    });
    expect(s.provider.findCallsByIntent).toHaveBeenCalledTimes(1);
    const audits = await prisma.auditLog.findMany({ where: { organizationId: s.org.id } });
    expect(JSON.stringify(audits)).not.toContain('Synthetic payer');
    expect(JSON.stringify(audits)).not.toContain('SYNTHETIC-MEMBER');
  });

  it('records no match without changing submission state and enforces persisted cooldown', async () => {
    const s = await seed('SUBMITTING');
    s.provider.findCallsByIntent.mockResolvedValue([]);
    expect(await reconcileCallIntent(s.options)).toEqual({ outcome: 'NO_MATCH', callId: null });
    expect(await s.read()).toMatchObject({
      state: 'SUBMITTING',
      callId: null,
      reconcileAttempts: 1,
      reconcileAvailableAt: new Date(NOW.getTime() + 60_000),
    });
    expect(await reconcileCallIntent(s.options)).toEqual({ outcome: 'NOT_READY', callId: null });
    expect(s.provider.findCallsByIntent).toHaveBeenCalledTimes(1);
    expect(s.provider.getCall).not.toHaveBeenCalled();
    const { fake, handler } = processor();
    const data: CallJobData = {
      organizationId: s.org.id,
      claimId: s.claim.id,
      payerCode: s.intent.payerCode,
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: s.intent.idempotencyKey,
    };
    expect(await handler(job(data), 'original')).toMatchObject({
      outcome: 'RECONCILIATION_REQUIRED',
    });
    expect(fake.startedCalls).toHaveLength(0);
  });

  it.each([
    'agentId',
    'fromNumberE164',
    'toNumberE164',
    'intentId',
    'direction',
    'callType',
  ] as const)('rejects a conflicting discovery %s without retrieving or binding', async (field) => {
    const s = await seed();
    const patch: Partial<RetellCallCandidate> = {
      agentId: 'wrong',
      fromNumberE164: '+15555550999',
      toNumberE164: '+15555550999',
      intentId: 'other_intent',
      direction: 'inbound',
      callType: 'web_call',
    };
    s.provider.findCallsByIntent.mockResolvedValue([{ ...s.candidate, [field]: patch[field] }]);
    expect(await reconcileCallIntent(s.options)).toEqual({
      outcome: 'REVIEW_REQUIRED',
      callId: null,
    });
    expect(s.provider.getCall).not.toHaveBeenCalled();
    expect(await s.read()).toMatchObject({ state: 'UNKNOWN', callId: null });
  });

  it('rejects multiple matches even when one is exact', async () => {
    const s = await seed();
    s.provider.findCallsByIntent.mockResolvedValue([
      s.candidate,
      { ...s.candidate, providerCallId: 'other_provider_call' },
    ]);
    expect((await reconcileCallIntent(s.options)).outcome).toBe('REVIEW_REQUIRED');
    expect(s.provider.getCall).not.toHaveBeenCalled();
  });

  it.each(['detail', 'event'] as const)(
    'rechecks the retrieved %s identity before committing',
    async (which) => {
      const s = await seed();
      s.provider.getCall.mockResolvedValue({
        candidate:
          which === 'detail' ? { ...s.candidate, toNumberE164: '+15555550999' } : s.candidate,
        terminalEvent:
          which === 'event'
            ? { ...s.terminalEvent, retellCallId: 'different_call' }
            : s.terminalEvent,
      });
      expect((await reconcileCallIntent(s.options)).outcome).toBe('REVIEW_REQUIRED');
      expect(await prisma.call.count({ where: { organizationId: s.org.id } })).toBe(0);
    },
  );

  it('preserves incomplete/failed lookup uncertainty and does not persist raw errors', async () => {
    const s = await seed();
    s.provider.getCall.mockRejectedValue(new Error('SECRET and synthetic transcript'));
    expect((await reconcileCallIntent(s.options)).outcome).toBe('LOOKUP_FAILED');
    expect(await s.read()).toMatchObject({ state: 'UNKNOWN', reconcileOutcome: 'LOOKUP_FAILED' });
    expect(
      JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId: s.org.id } })),
    ).not.toContain('SECRET');
  });

  it('bounds a provider implementation that never settles and ignores abort', async () => {
    const s = await seed();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    s.provider.findCallsByIntent.mockImplementation(() => new Promise(() => undefined));
    const running = reconcileCallIntent(s.options);
    await vi.waitFor(() => {
      expect(s.provider.findCallsByIntent).toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(25_001);
    expect((await running).outcome).toBe('LOOKUP_FAILED');
    expect(await s.read()).toMatchObject({ state: 'UNKNOWN', reconcileLeaseToken: null });
  });

  it.each(['missing', 'hash', 'intent', 'payer'] as const)(
    'rejects %s snapshot evidence before any remote lookup',
    async (kind) => {
      const s = await seed();
      let payload: Prisma.InputJsonValue = s.snapshot;
      if (kind === 'missing') payload = {};
      if (kind === 'intent') payload = { ...s.snapshot, idempotencyKey: 'other' };
      if (kind === 'payer') payload = { ...s.snapshot, payerCode: 'CIGNA_DENTAL' };
      await prisma.callIntent.updateMany({
        where: { id: s.intent.id, organizationId: s.org.id },
        data: {
          requestPayload: payload,
          requestHash:
            kind === 'hash'
              ? 'invalid'
              : createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
        },
      });
      expect((await reconcileCallIntent(s.options)).outcome).toBe('REVIEW_REQUIRED');
      expect(s.provider.findCallsByIntent).not.toHaveBeenCalled();
    },
  );

  it('reserves one lookup when reviewers race and resumes an expired lease without stale writes', async () => {
    const s = await seed();
    const blocked = deferred<readonly RetellCallCandidate[]>();
    s.provider.findCallsByIntent.mockReturnValueOnce(blocked.promise);
    const first = reconcileCallIntent(s.options);
    await vi.waitFor(() => {
      expect(s.provider.findCallsByIntent).toHaveBeenCalledTimes(1);
    });
    expect((await reconcileCallIntent(s.options)).outcome).toBe('IN_PROGRESS');
    const newer = await reconcileCallIntent({
      ...s.options,
      clock: () => new Date(NOW.getTime() + 61_000),
    });
    expect(newer.outcome).toBe('RECOVERED');
    blocked.resolve([s.candidate]);
    expect(await first).toEqual({ outcome: 'ALREADY_BOUND', callId: newer.callId });
    expect(await s.read()).toMatchObject({ reconcileAttempts: 2 });
    expect(await prisma.call.count({ where: { organizationId: s.org.id } })).toBe(1);
    expect(await prisma.jobOutbox.count({ where: { organizationId: s.org.id } })).toBe(1);
  });

  it('fences an expired owner even before another reviewer acquires the lease', async () => {
    const s = await seed();
    let current = NOW;
    s.provider.getCall.mockImplementation(async () => {
      current = new Date(NOW.getTime() + 61_000);
      return { candidate: s.candidate, terminalEvent: s.terminalEvent };
    });
    expect((await reconcileCallIntent({ ...s.options, clock: () => current })).outcome).toBe(
      'NOT_READY',
    );
    expect(await prisma.call.count({ where: { organizationId: s.org.id } })).toBe(0);
  });

  it('rejects cross-tenant intent access before remote lookup', async () => {
    const s = await seed();
    const other = await seed();
    expect(await reconcileCallIntent({ ...s.options, organizationId: other.org.id })).toEqual({
      outcome: 'NOT_FOUND',
      callId: null,
    });
    expect(s.provider.findCallsByIntent).not.toHaveBeenCalled();
  });

  it('keeps a provider ID bound to another tenant untouched', async () => {
    const s = await seed();
    const other = await seed();
    const existing = await prisma.call.create({
      data: {
        organizationId: other.org.id,
        claimId: other.claim.id,
        retellCallId: s.candidate.providerCallId,
      },
    });
    expect((await reconcileCallIntent(s.options)).outcome).toBe('REVIEW_REQUIRED');
    expect(await s.read()).toMatchObject({ state: 'UNKNOWN', callId: null });
    expect(
      await prisma.call.findFirst({ where: { id: existing.id, organizationId: other.org.id } }),
    ).toEqual(existing);
    expect(await prisma.jobOutbox.count({ where: { organizationId: s.org.id } })).toBe(0);
  });

  it('rolls back binding, evidence and resume if audit fails; retry after lease expiry recovers safely', async () => {
    const s = await seed();
    const faultDb = prisma.$extends({
      query: {
        auditLog: {
          create({ args, query }) {
            if (args.data.action === 'call.intent.reconciled')
              throw new Error('PHI synthetic database diagnostic');
            return query(args);
          },
        },
      },
    });
    await expect(reconcileCallIntent({ ...s.options, prisma: faultDb })).rejects.toThrow(
      'Call reconciliation could not be saved.',
    );
    expect(await s.read()).toMatchObject({ state: 'UNKNOWN', callId: null });
    expect(await prisma.call.count({ where: { organizationId: s.org.id } })).toBe(0);
    expect(await prisma.jobOutbox.count({ where: { organizationId: s.org.id } })).toBe(0);
    expect(
      (await reconcileCallIntent({ ...s.options, clock: () => new Date(NOW.getTime() + 61_000) }))
        .outcome,
    ).toBe('RECOVERED');
  });

  it('honors submission grace and rejects READY intents', async () => {
    const s = await seed('SUBMITTING');
    await prisma.callIntent.updateMany({
      where: { id: s.intent.id, organizationId: s.org.id },
      data: { submittedAt: NOW },
    });
    expect(getCallIntentReconciliationEligibility(await s.read(), NOW)).toEqual({
      canCheck: false,
      nextCheckAt: new Date(NOW.getTime() + 60_000),
    });
    expect((await reconcileCallIntent(s.options)).outcome).toBe('NOT_READY');
    expect(s.provider.findCallsByIntent).not.toHaveBeenCalled();
    const ready = await seed('READY');
    expect((await reconcileCallIntent(ready.options)).outcome).toBe('NOT_READY');
    const data: CallJobData = {
      organizationId: ready.org.id,
      claimId: ready.claim.id,
      payerCode: ready.intent.payerCode,
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: `call.resume.${ready.intent.id}`,
      resume: { intentId: ready.intent.id, callId: 'forged' },
    };
    const { fake, handler } = processor();
    expect((await handler(job(data), 'forged')).outcome).toBe('BLOCKED');
    expect(fake.startedCalls).toHaveLength(0);
  });

  it.each(['key', 'call', 'tenant', 'claim', 'priority', 'attempt'] as const)(
    'rejects a forged resume %s without dialing or finalizing',
    async (field) => {
      const s = await seed();
      await reconcileCallIntent(s.options);
      const row = await prisma.jobOutbox.findFirstOrThrow({ where: { organizationId: s.org.id } });
      const valid = CallJobDataSchema.parse(row.payload);
      const data: CallJobData = {
        ...valid,
        ...(field === 'key' ? { idempotencyKey: s.intent.idempotencyKey } : {}),
        ...(field === 'call' ? { resume: { intentId: s.intent.id, callId: 'foreign_call' } } : {}),
        ...(field === 'tenant' ? { organizationId: 'foreign_org' } : {}),
        ...(field === 'claim' ? { claimId: 'foreign_claim' } : {}),
        ...(field === 'priority' ? { claimPriority: 1 } : {}),
        ...(field === 'attempt' ? { attemptNumber: 2 } : {}),
      };
      const { fake, handler } = processor();
      expect((await handler(job(data), 'forged')).outcome).toBe('BLOCKED');
      expect(fake.startedCalls).toHaveLength(0);
      expect((await s.read()).state).toBe('ACCEPTED');
    },
  );
});
