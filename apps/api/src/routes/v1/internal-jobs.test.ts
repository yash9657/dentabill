/**
 * `POST /v1/internal/jobs/{calls,summaries}` — auth + trust boundary
 * (ADR-053). The runtime is replaced with a fake so no processor runs.
 */
import { randomUUID } from 'node:crypto';

import { enqueueJobOutbox } from '@dentabill/call-worker';
import { prisma, type CallIntentState } from '@dentabill/db';
import {
  createInlineJobDispatcher,
  type CallJobData,
  type JobDispatcher,
  type SummaryJobData,
} from '@dentabill/queue';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';
import { initEnv } from '../../lib/env.js';
import type {
  CallObservationSweep,
  InlineJobRuntime,
  InlineRunReport,
} from '../../lib/inline-jobs.js';

import { internalSecretMatches } from './internal-jobs.js';

const SECRET = 'test-internal-job-secret-0123456789abcdef';
const HEADER = 'x-internal-job-secret';

const baseCallJob: CallJobData = {
  organizationId: 'org_1',
  claimId: 'claim_1',
  payerCode: 'DELTA_DENTAL_PPO',
  attemptNumber: 1,
  claimPriority: 50,
  idempotencyKey: 'claim_1-a1-k',
};
const summaryJob: SummaryJobData = {
  organizationId: 'org_1',
  callId: 'call_1',
  promptVersion: 'v1',
  idempotencyKey: 'call.call_1',
};

describe('internalSecretMatches', () => {
  it('matches only the exact configured secret', () => {
    expect(internalSecretMatches(SECRET, SECRET)).toBe(true);
    expect(internalSecretMatches(`${SECRET}x`, SECRET)).toBe(false);
    expect(internalSecretMatches('short', SECRET)).toBe(false);
    expect(internalSecretMatches(undefined, SECRET)).toBe(false);
    expect(internalSecretMatches(['a', 'b'], SECRET)).toBe(false);
  });

  it('never matches when no secret is configured', () => {
    expect(internalSecretMatches('', undefined)).toBe(false);
    expect(internalSecretMatches('anything', undefined)).toBe(false);
    expect(internalSecretMatches('', '')).toBe(false);
  });
});

describe('POST /v1/internal/jobs/*', () => {
  let server: FastifyInstance;
  let callJob: CallJobData;
  let defaultDispatcher: JobDispatcher;
  const organizations: string[] = [];
  const observeCalls = vi.fn<CallObservationSweep>();
  const idleObservation = {
    selected: 0,
    observed: 0,
    terminal: 0,
    rescheduled: 0,
    stopRequested: 0,
    failed: 0,
  };
  const runCall = vi.fn<InlineJobRuntime['runCall']>();
  const runSummary = vi.fn<InlineJobRuntime['runSummary']>();

  beforeAll(async () => {
    process.env.INTERNAL_JOB_SECRET = SECRET;
    initEnv();
    server = await buildServer({ logger: false });
    defaultDispatcher = server.jobDispatcher;
    server.callObservationSweep = observeCalls;
    server.inlineJobRuntime = {
      runCall,
      runSummary,
      runCallAttempt: vi.fn<InlineJobRuntime['runCallAttempt']>(),
      runSummaryAttempt: vi.fn<InlineJobRuntime['runSummaryAttempt']>(),
    };
  });

  it('passes authenticated recovery provenance and rejects malformed transport identity', async () => {
    const transportJobId = 'outbox.synthetic_recovery.recovery.1';
    const response = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/calls',
      headers: { [HEADER]: SECRET, 'x-dentabill-transport-job-id': transportJobId },
      payload: callJob,
    });
    expect(response.statusCode).toBe(200);
    expect(runCall).toHaveBeenCalledWith(callJob, { transportJobId });
    expect(response.json()).toEqual({ accepted: true, jobId: callJob.idempotencyKey });
    runCall.mockClear();
    const invalid = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/calls',
      headers: { [HEADER]: SECRET, 'x-dentabill-transport-job-id': 'untrusted-arbitrary-identity' },
      payload: callJob,
    });
    expect(invalid.statusCode).toBe(400);
    expect(runCall).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
    delete process.env.INTERNAL_JOB_SECRET;
    initEnv();
  });

  beforeEach(async () => {
    server.jobDispatcher = defaultDispatcher;
    observeCalls.mockReset().mockResolvedValue(idleObservation);
    runCall.mockReset().mockResolvedValue({ status: 'completed', attemptsMade: 1 });
    runSummary.mockReset().mockResolvedValue({ status: 'completed', attemptsMade: 1 });
    callJob = await seedIntent('TERMINAL');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of organizations.splice(0)) {
      await prisma.organization.delete({ where: { id } });
    }
  });

  async function seedIntent(state: CallIntentState): Promise<CallJobData> {
    const org = await prisma.organization.create({
      data: { name: 'Synthetic receipt test', clerkOrgId: `receipt_${randomUUID()}` },
    });
    organizations.push(org.id);
    const claim = await prisma.claim.create({
      data: {
        organizationId: org.id,
        patientDOBHash: 'synthetic-hash',
        patientDOBLast4: '1990',
        subscriberId: 'SYNTHETIC-MEMBER',
        claimNumber: `synthetic-${randomUUID()}`,
        cdtCodes: ['D2740'],
        claimAmount: '420.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-01-01T00:00:00Z'),
        priority: 50,
        status: 'IN_QUEUE',
      },
    });
    const data = {
      ...baseCallJob,
      organizationId: org.id,
      claimId: claim.id,
      idempotencyKey: `${claim.id}.receipt`,
    };
    await prisma.callIntent.create({
      data: { ...data, payerCode: claim.payerCode, claimVersion: claim.updatedAt, state },
    });
    return data;
  }

  it.each(['exact', 'wrong key', 'wrong call', 'wrong tenant', 'still accepted'] as const)(
    'acknowledges a recovery receipt only for its exact terminal binding: %s',
    async (variant) => {
      const intent = await prisma.callIntent.findFirstOrThrow({
        where: { organizationId: callJob.organizationId, idempotencyKey: callJob.idempotencyKey },
      });
      const call = await prisma.call.create({
        data: {
          organizationId: callJob.organizationId,
          claimId: callJob.claimId,
          retellCallId: `synthetic_resume_${randomUUID()}`,
        },
      });
      await prisma.callIntent.updateMany({
        where: { id: intent.id, organizationId: callJob.organizationId },
        data: { callId: call.id, state: variant === 'still accepted' ? 'ACCEPTED' : 'TERMINAL' },
      });
      const data: CallJobData = {
        ...callJob,
        organizationId: variant === 'wrong tenant' ? 'different_org' : callJob.organizationId,
        idempotencyKey:
          variant === 'wrong key' ? callJob.idempotencyKey : `call.resume.${intent.id}`,
        resume: {
          intentId: intent.id,
          callId: variant === 'wrong call' ? 'different_call' : call.id,
        },
      };
      const response = await server.inject({
        method: 'POST',
        url: '/v1/internal/jobs/calls',
        headers: { [HEADER]: SECRET },
        payload: data,
      });
      expect(response.statusCode).toBe(variant === 'exact' ? 200 : 503);
      expect(runCall).toHaveBeenCalledWith(data);
      if (variant === 'exact')
        expect(response.json()).toEqual({ accepted: true, jobId: data.idempotencyKey });
    },
  );

  it.each([
    ['original', 'saved'],
    ['resume', 'saved'],
    ['original', 'missing deadline'],
    ['resume', 'missing deadline'],
    ['original', 'missing next observation'],
    ['resume', 'missing next observation'],
    ['original', 'missing call'],
    ['resume', 'missing call'],
    ['original', 'submitting'],
    ['resume', 'submitting'],
  ] as const)(
    'acknowledges %s accepted handoff only with durable monitor fields: %s',
    async (command, variant) => {
      const intent = await prisma.callIntent.findFirstOrThrow({
        where: { organizationId: callJob.organizationId, idempotencyKey: callJob.idempotencyKey },
      });
      const call = await prisma.call.create({
        data: {
          organizationId: callJob.organizationId,
          claimId: callJob.claimId,
          retellCallId: `synthetic_observer_${randomUUID()}`,
        },
      });
      await prisma.callIntent.updateMany({
        where: { id: intent.id, organizationId: callJob.organizationId },
        data: {
          state: variant === 'submitting' ? 'SUBMITTING' : 'ACCEPTED',
          callId: variant === 'missing call' ? null : call.id,
          callDeadlineAt: variant === 'missing deadline' ? null : new Date(Date.now() + 900_000),
          nextObservationAt: variant === 'missing next observation' ? null : new Date(),
        },
      });
      const data: CallJobData =
        command === 'original'
          ? callJob
          : {
              ...callJob,
              idempotencyKey: `call.resume.${intent.id}`,
              resume: { intentId: intent.id, callId: call.id },
            };
      runCall.mockResolvedValueOnce({ status: 'rescheduled', attemptsMade: 1 });
      const response = await server.inject({
        method: 'POST',
        url: '/v1/internal/jobs/calls',
        headers: { [HEADER]: SECRET },
        payload: data,
      });
      expect(response.statusCode).toBe(variant === 'saved' ? 200 : 503);
      expect(runCall).toHaveBeenCalledWith(data);
    },
  );

  it('still delivers pending jobs when observation fails', async () => {
    const [data] = await seedOutbox();
    if (!data) throw new Error('Expected seeded job');
    const dispatchCall = vi.fn(async () => data.idempotencyKey);
    server.jobDispatcher = { mode: 'inline', dispatchCall, dispatchSummary: vi.fn() };
    observeCalls.mockRejectedValueOnce(new Error('synthetic private provider failure'));
    const response = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/outbox/relay',
      headers: { [HEADER]: SECRET },
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(dispatchCall).toHaveBeenCalledTimes(1);
    expect(response.body).not.toContain('private');
    expect(
      await prisma.jobOutbox.findFirst({
        where: { organizationId: data.organizationId, idempotencyKey: data.idempotencyKey },
      }),
    ).toMatchObject({ state: 'DELIVERED' });
  });

  async function seedOutbox(count = 1): Promise<CallJobData[]> {
    const seed = await seedIntent('TERMINAL');
    const data = Array.from({ length: count }, (_, index) => ({
      ...seed,
      idempotencyKey: index === 0 ? seed.idempotencyKey : `${seed.idempotencyKey}.${String(index)}`,
    }));
    await prisma.$transaction(async (tx) => {
      for (const job of data) {
        await enqueueJobOutbox(tx, {
          organizationId: seed.organizationId,
          kind: 'CALL_PLACE',
          data: job,
        });
      }
    });
    return data;
  }

  function inlineDispatcher(fetchOverride?: typeof fetch): JobDispatcher {
    const injectFetch: typeof fetch = async (input, init) => {
      if (typeof input !== 'string' || typeof init?.body !== 'string') {
        throw new Error('Expected dispatcher URL and serialized payload.');
      }
      const response = await server.inject({
        method: 'POST',
        url: new URL(input).pathname,
        headers: init.headers as Record<string, string>,
        payload: init.body,
      });
      return new Response(response.body, { status: response.statusCode });
    };
    return createInlineJobDispatcher({
      baseUrl: 'http://localhost:3001',
      secret: SECRET,
      waitUntil: () => undefined,
      fetch: fetchOverride ?? injectFetch,
      triggerAttempts: 1,
    });
  }

  it.each([
    '/v1/internal/jobs/calls',
    '/v1/internal/jobs/summaries',
    '/v1/internal/jobs/outbox/relay',
  ])('%s returns 401 without the secret header', async (url) => {
    const response = await server.inject({ method: 'POST', url, payload: callJob });
    expect(response.statusCode).toBe(401);
    expect(runCall).not.toHaveBeenCalled();
    expect(runSummary).not.toHaveBeenCalled();
  });

  it('returns 401 with a wrong secret', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/calls',
      headers: { [HEADER]: `${SECRET.slice(0, -1)}X` },
      payload: callJob,
    });
    expect(response.statusCode).toBe(401);
    expect(runCall).not.toHaveBeenCalled();
  });

  it('returns 400 for a payload that fails the job schema', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/calls',
      headers: { [HEADER]: SECRET },
      payload: { ...callJob, attemptNumber: 9 },
    });
    expect(response.statusCode).toBe(400);
    expect(runCall).not.toHaveBeenCalled();
  });

  it('acknowledges a call only after the runtime finishes', async () => {
    let finish: ((report: InlineRunReport) => void) | undefined;
    runCall.mockReturnValueOnce(
      new Promise<InlineRunReport>((resolve) => {
        finish = resolve;
      }),
    );
    let settled = false;
    const request = server
      .inject({
        method: 'POST',
        url: '/v1/internal/jobs/calls',
        headers: { [HEADER]: SECRET },
        payload: callJob,
      })
      .then((response) => {
        settled = true;
        return response;
      });
    await vi.waitFor(() => {
      expect(runCall).toHaveBeenCalledWith(callJob);
    });
    expect(settled).toBe(false);
    if (!finish) throw new Error('Expected runtime barrier.');
    finish({ status: 'completed', attemptsMade: 1 });
    const response = await request;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, jobId: callJob.idempotencyKey });
  });

  it('acknowledges a completed summary with a matching receipt', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/summaries',
      headers: { [HEADER]: SECRET },
      payload: summaryJob,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, jobId: summaryJob.idempotencyKey });
    expect(runSummary).toHaveBeenCalledWith(summaryJob);
  });

  it.each<{ report: InlineRunReport; state: CallIntentState }>([
    {
      report: { status: 'skipped', reason: 'ALREADY_PROCESSED' },
      state: 'TERMINAL',
    },
    {
      report: { status: 'reconciliation_required', attemptsMade: 1 },
      state: 'UNKNOWN',
    },
    {
      report: {
        status: 'blocked',
        reason: 'MISSING_CALL_IDENTITY',
        missingFields: ['subscriberId'],
        attemptsMade: 1,
      },
      state: 'CANCELLED',
    },
    {
      report: { status: 'failed', attemptsMade: 3, budgetExhausted: false, dlq: true },
      state: 'CANCELLED',
    },
  ])(
    'acknowledges a durable $state intent with a $report.status disposition',
    async ({ report, state }) => {
      await prisma.callIntent.updateMany({
        where: { organizationId: callJob.organizationId, idempotencyKey: callJob.idempotencyKey },
        data: { state },
      });
      runCall.mockResolvedValueOnce(report);
      const response = await server.inject({
        method: 'POST',
        url: '/v1/internal/jobs/calls',
        headers: { [HEADER]: SECRET },
        payload: callJob,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: true, jobId: callJob.idempotencyKey });
    },
  );

  it.each(['READY', 'SUBMITTING', 'ACCEPTED'] as const)(
    'leaves duplicate delivery unconfirmed while the saved intent is %s',
    async (state) => {
      await prisma.callIntent.updateMany({
        where: { organizationId: callJob.organizationId, idempotencyKey: callJob.idempotencyKey },
        data: { state },
      });
      for (const report of [
        { status: 'skipped', reason: 'call_intent_blocked' },
        { status: 'reconciliation_required', attemptsMade: 1 },
        { status: 'completed', attemptsMade: 1 },
      ] satisfies InlineRunReport[]) {
        runCall.mockResolvedValueOnce(report);
        const response = await server.inject({
          method: 'POST',
          url: '/v1/internal/jobs/calls',
          headers: { [HEADER]: SECRET },
          payload: callJob,
        });
        expect(response.statusCode).toBe(503);
        expect(response.json()).not.toHaveProperty('accepted');
      }
      expect(
        await prisma.callIntent.findFirst({
          where: { organizationId: callJob.organizationId, idempotencyKey: callJob.idempotencyKey },
        }),
      ).toMatchObject({ state });
    },
  );

  it('does not acknowledge a missing, cross-tenant, or mismatched saved command', async () => {
    const foreign = await seedIntent('TERMINAL');
    for (const payload of [
      { ...callJob, idempotencyKey: 'missing-key' },
      { ...callJob, organizationId: foreign.organizationId },
      { ...callJob, claimId: foreign.claimId },
      { ...callJob, attemptNumber: 2 },
      { ...callJob, claimPriority: 51 },
      { ...callJob, payerCode: 'METLIFE_DENTAL' },
    ]) {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/internal/jobs/calls',
        headers: { [HEADER]: SECRET },
        payload,
      });
      expect(response.statusCode).toBe(503);
    }
  });

  it.each(['calls', 'summaries'] as const)(
    'leaves an unresolved %s failure unconfirmed and accepts a later completed retry',
    async (kind) => {
      const run = kind === 'calls' ? runCall : runSummary;
      const data = kind === 'calls' ? callJob : summaryJob;
      run.mockResolvedValueOnce({
        status: 'failed',
        attemptsMade: 3,
        budgetExhausted: true,
        dlq: false,
      });
      const request = {
        method: 'POST' as const,
        url: `/v1/internal/jobs/${kind}`,
        headers: { [HEADER]: SECRET },
        payload: data,
      };
      const failure = await server.inject(request);
      expect(failure.statusCode).toBe(503);
      expect(failure.json()).toMatchObject({ error: true });
      expect(failure.json()).not.toHaveProperty('accepted');
      const retry = await server.inject(request);
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual({ accepted: true, jobId: data.idempotencyKey });
    },
  );

  it.each(['calls', 'summaries'] as const)(
    'returns 503 and omits raw %s crash details from both response and logs',
    async (kind) => {
      const privateText = 'synthetic-sensitive-error-do-not-log';
      const errorLog = vi.spyOn(server.log, 'error');
      (kind === 'calls' ? runCall : runSummary).mockRejectedValueOnce(new Error(privateText));
      const response = await server.inject({
        method: 'POST',
        url: `/v1/internal/jobs/${kind}`,
        headers: { [HEADER]: SECRET },
        payload: kind === 'calls' ? callJob : summaryJob,
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain(privateText);
      expect(errorLog).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INLINE_JOB_CRASH' }),
        'inline job unconfirmed',
      );
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(privateText);
      expect(errorLog.mock.calls[0]?.[0]).not.toHaveProperty('err');
    },
  );

  it('keeps the real outbox pending until the inline consumer supplies its receipt', async () => {
    const [data] = await seedOutbox();
    if (!data) throw new Error('Expected seeded job.');
    server.jobDispatcher = inlineDispatcher();
    let finish: ((report: InlineRunReport) => void) | undefined;
    runCall.mockReturnValueOnce(
      new Promise<InlineRunReport>((resolve) => {
        finish = resolve;
      }),
    );
    await prisma.callIntent.updateMany({
      where: { organizationId: data.organizationId, idempotencyKey: data.idempotencyKey },
      data: { state: 'READY' },
    });
    let settled = false;
    const request = server
      .inject({
        method: 'POST',
        url: '/v1/internal/jobs/outbox/relay',
        headers: { [HEADER]: SECRET },
      })
      .then((response) => {
        settled = true;
        return response;
      });
    await vi.waitFor(() => {
      expect(runCall).toHaveBeenCalledWith(data);
    });
    expect(settled).toBe(false);
    const pending = await prisma.jobOutbox.findFirstOrThrow({
      where: { organizationId: data.organizationId, idempotencyKey: data.idempotencyKey },
    });
    expect(pending).toMatchObject({ state: 'PENDING', deliveryAttempts: 1, deliveredAt: null });
    expect(pending.leaseToken).not.toBeNull();
    await prisma.callIntent.updateMany({
      where: { organizationId: data.organizationId, idempotencyKey: data.idempotencyKey },
      data: { state: 'TERMINAL' },
    });
    if (!finish) throw new Error('Expected runtime barrier.');
    finish({ status: 'completed', attemptsMade: 1 });
    const response = await request;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      selected: 1,
      sent: 1,
      failed: 0,
      quarantined: 0,
      observation: idleObservation,
    });
    const delivered = await prisma.jobOutbox.findFirstOrThrow({
      where: { organizationId: data.organizationId, id: pending.id },
    });
    expect(delivered.state).toBe('DELIVERED');
    expect(delivered.deliveredAt).not.toBeNull();
  });

  it.each(['early 202', 'lost response', 'unresolved failure', 'in-flight duplicate'] as const)(
    'preserves the outbox job for retry after %s',
    async (failure) => {
      const [data] = await seedOutbox();
      if (!data) throw new Error('Expected seeded job.');
      server.jobDispatcher = inlineDispatcher(
        failure === 'early 202'
          ? async () =>
              Response.json({ accepted: true, jobId: data.idempotencyKey }, { status: 202 })
          : failure === 'lost response'
            ? async () => {
                throw new Error('synthetic response lost');
              }
            : undefined,
      );
      runCall.mockResolvedValueOnce({
        status: 'failed',
        attemptsMade: 3,
        budgetExhausted: false,
        dlq: false,
      });
      if (failure === 'in-flight duplicate') {
        await prisma.callIntent.updateMany({
          where: { organizationId: data.organizationId, idempotencyKey: data.idempotencyKey },
          data: { state: 'SUBMITTING' },
        });
        runCall.mockReset().mockResolvedValue({ status: 'skipped', reason: 'call_intent_blocked' });
      }
      const response = await server.inject({
        method: 'POST',
        url: '/v1/internal/jobs/outbox/relay',
        headers: { [HEADER]: SECRET },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        selected: 1,
        sent: 0,
        failed: 1,
        quarantined: 0,
        observation: idleObservation,
      });
      const pending = await prisma.jobOutbox.findFirstOrThrow({
        where: { organizationId: data.organizationId, idempotencyKey: data.idempotencyKey },
      });
      expect(pending).toMatchObject({
        state: 'PENDING',
        deliveredAt: null,
        leaseToken: null,
        deliveryAttempts: 1,
      });
      expect(pending.payload).toEqual(data);
      expect(pending.availableAt.getTime()).toBeGreaterThan(pending.createdAt.getTime());
    },
  );

  it('does not allow an unauthenticated relay or caller overrides of relay scope and bounds', async () => {
    const [data] = await seedOutbox();
    if (!data) throw new Error('Expected seeded job.');
    const dispatchCall = vi.fn(async () => data.idempotencyKey);
    server.jobDispatcher = { mode: 'inline', dispatchCall, dispatchSummary: vi.fn() };
    for (const secret of [undefined, 'incorrect-secret', SECRET]) {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/internal/jobs/outbox/relay',
        ...(secret && { headers: { [HEADER]: secret } }),
        payload: { organizationId: data.organizationId, limit: 100, leaseMs: 1 },
      });
      expect(response.statusCode).toBe(secret === SECRET ? 400 : 401);
    }
    expect(dispatchCall).not.toHaveBeenCalled();
    expect(
      await prisma.jobOutbox.findFirst({
        where: { organizationId: data.organizationId, idempotencyKey: data.idempotencyKey },
      }),
    ).toMatchObject({ state: 'PENDING', deliveryAttempts: 0 });
  });

  it('limits an authenticated recovery sweep to 25 pending jobs', async () => {
    const data = await seedOutbox(26);
    const organizationId = data[0]?.organizationId;
    if (!organizationId) throw new Error('Expected seeded jobs.');
    const dispatchCall = vi.fn<JobDispatcher['dispatchCall']>(async (job) => job.idempotencyKey);
    server.jobDispatcher = { mode: 'inline', dispatchCall, dispatchSummary: vi.fn() };
    const response = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/outbox/relay',
      headers: { [HEADER]: SECRET },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      selected: 25,
      sent: 25,
      failed: 0,
      quarantined: 0,
      observation: idleObservation,
    });
    expect(observeCalls).toHaveBeenCalledWith({ limit: 5, budgetMs: 25_000 });
    expect(dispatchCall).toHaveBeenCalledTimes(25);
    expect(
      await prisma.jobOutbox.count({
        where: { organizationId, state: 'PENDING' },
      }),
    ).toBe(1);
  });

  it('is hidden from the OpenAPI document', async () => {
    const response = await server.inject({ method: 'GET', url: '/docs/json' });
    const doc = response.json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(doc.paths).some((p) => p.includes('/internal/'))).toBe(false);
  });
});
