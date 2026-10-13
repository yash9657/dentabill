import { relayJobOutbox } from '@dentabill/call-worker';
import { prisma } from '@dentabill/db';
import type { Organization } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import { buildServer } from '../../app.js';

interface ApiErrorBody {
  error: true;
  message: string;
  code: string;
}

function bodyAsError(response: { json: () => unknown }): ApiErrorBody {
  return response.json() as ApiErrorBody;
}

async function rejectProducerInsert(table: 'AuditLog' | 'JobOutbox'): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION reject_api_producer_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic producer persistence outage'; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER reject_api_producer_write BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION reject_api_producer_write()`,
  );
}

afterEach(async () => {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_api_producer_write ON "AuditLog"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_api_producer_write ON "JobOutbox"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_api_producer_write()');
});

/**
 * `/v1/claims/:id/calls` integration tests against real Postgres.
 *
 * Auth via the test-header bypass (P2-T37). The BullMQ queue is the
 * one piece we don't bring up — `fastify.callsQueue.add` is replaced
 * with a `vi.fn()` so the tests assert the call shape we'd send to
 * Redis without booting a real connection. The lazy-connect Redis
 * never opens a socket on injected requests.
 */

async function makeOrg(name: string): Promise<Organization> {
  return prisma.organization.create({
    data: { name, clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}`, npi: '1234567890' },
  });
}

interface SeededClaim {
  readonly id: string;
}

async function makeClaim(
  orgId: string,
  overrides?: Partial<{
    status: 'PENDING' | 'COMPLETED' | 'WRITTEN_OFF';
    subscriberId: string | null;
    payerCode: 'DELTA_DENTAL_PPO' | 'CIGNA_DENTAL' | 'METLIFE_DENTAL' | 'AETNA_DENTAL' | 'UNKNOWN';
  }>,
): Promise<SeededClaim> {
  const claim = await prisma.claim.create({
    data: {
      organizationId: orgId,
      patientDOBHash: 'hash_abc',
      patientDOBLast4: '1990',
      subscriberId:
        overrides?.subscriberId === undefined ? 'SYNTHETIC-MEMBER' : overrides.subscriberId,
      claimNumber: `CL-${Math.random().toString(36).slice(2, 8)}`,
      cdtCodes: ['D2740'],
      claimAmount: '420.00',
      payerCode: overrides?.payerCode ?? 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-01-15T00:00:00.000Z'),
      status: overrides?.status ?? 'PENDING',
      priority: 80,
    },
  });
  return { id: claim.id };
}

describe('POST /v1/claims/:id/calls (P3-T16)', () => {
  let server: FastifyInstance;
  let queueAddSpy: Mock<(name: string, data: unknown, opts: unknown) => Promise<{ id: string }>>;

  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Each case gets fresh in-memory rate-limit state, independent of earlier requests.
    server = await buildServer({ logger: false });
    queueAddSpy = vi.fn(async () => ({ id: 'mocked' }));
    server.callsQueue.add = queueAddSpy as unknown as typeof server.callsQueue.add;
  });

  afterEach(async () => {
    await server.close();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
    );
  });

  it('rejects unauthenticated requests with 401', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/claims/clm_x/calls',
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(queueAddSpy).not.toHaveBeenCalled();
  });

  it('returns 404 for a claim that does not exist in the org', async () => {
    const org = await makeOrg('Acme Dental');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'POST',
      url: '/v1/claims/clm_does_not_exist/calls',
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(bodyAsError(response).code).toBe('NOT_FOUND');
    expect(queueAddSpy).not.toHaveBeenCalled();
  });

  it('returns 404 for a claim that belongs to a different org (cross-org isolation)', async () => {
    const orgA = await makeOrg('A');
    const orgB = await makeOrg('B');
    const claimA = await makeClaim(orgA.id);
    const headers = { 'x-test-user-id': 'user_b', 'x-test-org-id': orgB.id };
    const response = await server.inject({
      method: 'POST',
      url: `/v1/claims/${claimA.id}/calls`,
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(queueAddSpy).not.toHaveBeenCalled();
  });

  it('rejects 409 when the claim is in a non-enqueueable status', async () => {
    const org = await makeOrg('A');
    const claim = await makeClaim(org.id, { status: 'WRITTEN_OFF' });
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'POST',
      url: `/v1/claims/${claim.id}/calls`,
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(bodyAsError(response).code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rejects 422 MISSING_PROVIDER_NPI when the org has no NPI and no per-payer override', async () => {
    const org = await prisma.organization.create({
      data: {
        name: 'No-NPI Practice',
        clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}`,
        npi: null,
      },
    });
    const claim = await makeClaim(org.id);
    const headers = { 'x-test-user-id': 'user_no_npi', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'POST',
      url: `/v1/claims/${claim.id}/calls`,
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    expect(bodyAsError(response).code).toBe('MISSING_PROVIDER_NPI');
    expect(bodyAsError(response).message).toMatch(/NPI/i);
    expect(queueAddSpy).not.toHaveBeenCalled();
  });

  it.each([null, '', '   '])(
    'rejects missing subscriber ID (%j) before any enqueue side effect',
    async (subscriberId) => {
      const org = await makeOrg('Missing identity');
      const claim = await makeClaim(org.id, { subscriberId });
      const before = await prisma.claim.findFirstOrThrow({
        where: { id: claim.id, organizationId: org.id },
      });
      const response = await server.inject({
        method: 'POST',
        url: `/v1/claims/${claim.id}/calls`,
        headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id },
        payload: {},
      });
      expect(response.statusCode).toBe(422);
      expect(bodyAsError(response).code).toBe('MISSING_CALL_IDENTITY');
      expect(queueAddSpy).not.toHaveBeenCalled();
      const after = await prisma.claim.findFirstOrThrow({
        where: { id: claim.id, organizationId: org.id },
      });
      expect(after.status).toBe(before.status);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(await prisma.call.count({ where: { organizationId: org.id } })).toBe(0);
      expect(
        await prisma.auditLog.count({ where: { organizationId: org.id, action: 'call.enqueue' } }),
      ).toBe(0);
    },
  );

  it('rejects whitespace-only NPI before enqueue', async () => {
    const org = await makeOrg('Blank NPI');
    await prisma.organization.update({ where: { id: org.id }, data: { npi: '   ' } });
    const claim = await makeClaim(org.id);
    const response = await server.inject({
      method: 'POST',
      url: `/v1/claims/${claim.id}/calls`,
      headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id },
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    expect(bodyAsError(response).code).toBe('MISSING_PROVIDER_NPI');
    expect(queueAddSpy).not.toHaveBeenCalled();
    expect(
      await prisma.claim.findFirstOrThrow({ where: { id: claim.id, organizationId: org.id } }),
    ).toMatchObject({ status: 'PENDING' });
  });

  it('rejects 422 UNSUPPORTED_PAYER for a Phase-3-unsupported payer', async () => {
    const org = await makeOrg('A');
    const claim = await makeClaim(org.id, { payerCode: 'AETNA_DENTAL' });
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'POST',
      url: `/v1/claims/${claim.id}/calls`,
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    expect(bodyAsError(response).code).toBe('UNSUPPORTED_PAYER');
  });

  it('rejects 422 PAYER_HOURS_CLOSED outside the payer-local business window', async () => {
    // Mock the system clock to a Saturday 02:00 UTC — guaranteed
    // outside both Delta (Mon–Fri CT 8–17) and the rest of the
    // Phase 3 payers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-17T02:00:00.000Z')); // Sat 02:00 UTC
    try {
      const org = await makeOrg('A');
      const claim = await makeClaim(org.id);
      const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
      const response = await server.inject({
        method: 'POST',
        url: `/v1/claims/${claim.id}/calls`,
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(422);
      expect(bodyAsError(response).code).toBe('PAYER_HOURS_CLOSED');
      expect(queueAddSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('enqueues a job, transitions Claim → IN_QUEUE, returns 202 with jobId', async () => {
    // Mid-day Tuesday CT — well within Delta hours.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-13T18:00:00.000Z')); // Tue 12:00 CT
    try {
      const org = await makeOrg('A');
      const claim = await makeClaim(org.id);
      const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
      queueAddSpy.mockImplementationOnce(async () => {
        expect(
          await prisma.callIntent.count({ where: { organizationId: org.id, state: 'READY' } }),
        ).toBe(1);
        expect(
          await prisma.auditLog.count({
            where: { organizationId: org.id, action: 'call.enqueue' },
          }),
        ).toBe(1);
        expect(
          await prisma.jobOutbox.findFirst({ where: { organizationId: org.id } }),
        ).toMatchObject({
          state: 'PENDING',
          kind: 'CALL_PLACE',
          deliveryAttempts: 1,
        });
        return { id: 'mocked' };
      });
      const response = await server.inject({
        method: 'POST',
        url: `/v1/claims/${claim.id}/calls`,
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(202);
      const body = response.json<{
        jobId: string;
        claimId: string;
        queuedAt: string;
        attemptNumber: number;
      }>();
      expect(body.claimId).toBe(claim.id);
      expect(body.attemptNumber).toBe(1);
      expect(body.jobId.startsWith('call_')).toBe(true);

      // BullMQ add() called with the right shape.
      expect(queueAddSpy).toHaveBeenCalledTimes(1);
      const firstCall = queueAddSpy.mock.calls[0];
      if (firstCall === undefined) throw new Error('queue.add was not called');
      const [name, data, opts] = firstCall;
      expect(name).toBe('call.place');
      expect(data).toMatchObject({
        organizationId: org.id,
        claimId: claim.id,
        payerCode: 'DELTA_DENTAL_PPO',
        attemptNumber: 1,
        idempotencyKey: body.jobId,
      });
      expect(opts).toMatchObject({
        jobId: body.jobId,
        priority: 21, // 101 - 80
      });

      // Claim flipped to IN_QUEUE.
      const after = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } });
      expect(after.status).toBe('IN_QUEUE');

      // Audit log row written.
      const audits = await prisma.auditLog.findMany({
        where: { organizationId: org.id, action: 'call.enqueue' },
      });
      expect(audits).toHaveLength(1);
      const audit = audits[0];
      if (audit === undefined) throw new Error('expected one audit row');
      expect(audit.metadata).toMatchObject({
        attemptNumber: 1,
        jobId: body.jobId,
        payerCode: 'DELTA_DENTAL_PPO',
      });
      const outbox = await prisma.jobOutbox.findFirstOrThrow({ where: { organizationId: org.id } });
      expect(outbox).toMatchObject({
        kind: 'CALL_PLACE',
        state: 'DELIVERED',
        idempotencyKey: body.jobId,
        deliveryAttempts: 1,
        payload: data,
      });
      expect(outbox.deliveredAt).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects 429 RATE_LIMITED once the per-claim 2/day cap is reached', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-13T18:00:00.000Z'));
    try {
      const org = await makeOrg('A');
      const claim = await makeClaim(org.id);
      // Pre-seed two Call rows for today.
      for (let i = 0; i < 2; i += 1) {
        await prisma.call.create({
          data: {
            organizationId: org.id,
            claimId: claim.id,
            retellCallId: `pre_${String(i)}_${Math.random().toString(36).slice(2)}`,
            status: 'COMPLETED',
            attemptNumber: i + 1,
            startedAt: new Date(),
          },
        });
      }
      const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
      const response = await server.inject({
        method: 'POST',
        url: `/v1/claims/${claim.id}/calls`,
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(429);
      expect(bodyAsError(response).code).toBe('RATE_LIMITED');
      expect(queueAddSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('concurrent requests reserve one intent and one atomic enqueue audit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T18:00:00.000Z'));
    try {
      const org = await makeOrg('Synthetic concurrency');
      const claim = await makeClaim(org.id);
      const request = {
        method: 'POST' as const,
        url: `/v1/claims/${claim.id}/calls`,
        headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id },
        payload: {},
      };
      const responses = await Promise.all([server.inject(request), server.inject(request)]);
      expect(responses.map((r) => r.statusCode)).toEqual([202, 202]);
      expect(responses[0].json<{ jobId: string }>().jobId).toBe(
        responses[1].json<{ jobId: string }>().jobId,
      );
      expect(await prisma.callIntent.count({ where: { organizationId: org.id } })).toBe(1);
      expect(await prisma.jobOutbox.count({ where: { organizationId: org.id } })).toBe(1);
      expect(queueAddSpy).toHaveBeenCalledTimes(1);
      expect(
        await prisma.auditLog.count({ where: { organizationId: org.id, action: 'call.enqueue' } }),
      ).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks another call while a previous submission is uncertain even after manual review', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T18:00:00.000Z'));
    try {
      const org = await makeOrg('Synthetic uncertain');
      const claim = await makeClaim(org.id);
      const request = {
        method: 'POST' as const,
        url: `/v1/claims/${claim.id}/calls`,
        headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id },
        payload: {},
      };
      expect((await server.inject(request)).statusCode).toBe(202);
      await prisma.callIntent.updateMany({
        where: { organizationId: org.id, claimId: claim.id },
        data: { state: 'UNKNOWN' },
      });
      await prisma.claim.updateMany({
        where: { organizationId: org.id, id: claim.id },
        data: { status: 'MANUAL_REVIEW' },
      });
      const blocked = await server.inject(request);
      expect(blocked.statusCode).toBe(409);
      expect(bodyAsError(blocked).message).toContain('reconciliation');
      expect(queueAddSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts yesterday reservations submitted today toward the daily attempt cap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T18:00:00.000Z'));
    try {
      const org = await makeOrg('Synthetic attempt date');
      const claim = await makeClaim(org.id);
      const row = await prisma.claim.findFirstOrThrow({
        where: { id: claim.id, organizationId: org.id },
      });
      for (const attemptNumber of [1, 2]) {
        await prisma.callIntent.create({
          data: {
            organizationId: org.id,
            claimId: claim.id,
            payerCode: row.payerCode,
            claimPriority: row.priority,
            claimVersion: row.updatedAt,
            idempotencyKey: `prior-reservation-${String(attemptNumber)}`,
            attemptNumber,
            state: 'TERMINAL',
            createdAt: new Date('2026-10-12T18:00:00Z'),
            submittedAt: new Date(),
          },
        });
      }
      const response = await server.inject({
        method: 'POST',
        url: `/v1/claims/${claim.id}/calls`,
        headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id },
        payload: {},
      });
      expect(response.statusCode).toBe(429);
      expect(queueAddSpy).not.toHaveBeenCalled();
      expect(
        await prisma.claim.findFirst({ where: { id: claim.id, organizationId: org.id } }),
      ).toMatchObject({ status: 'PENDING' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains the same durable intent when BullMQ delivery is ambiguous', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-13T18:00:00.000Z'));
    queueAddSpy.mockImplementationOnce(async () => {
      throw new Error('redis is angry');
    });
    try {
      const org = await makeOrg('A');
      const claim = await makeClaim(org.id);
      const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
      const response = await server.inject({
        method: 'POST',
        url: `/v1/claims/${claim.id}/calls`,
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(202);
      const after = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } });
      expect(after.status).toBe('IN_QUEUE');
      const intent = await prisma.callIntent.findFirstOrThrow({
        where: { organizationId: org.id, claimId: claim.id },
      });
      expect(intent.state).toBe('READY');
      expect(response.json<{ jobId: string }>().jobId).toBe(intent.idempotencyKey);
      const pending = await prisma.jobOutbox.findFirstOrThrow({
        where: { organizationId: org.id },
      });
      expect(pending).toMatchObject({
        state: 'PENDING',
        deliveryAttempts: 1,
        lastErrorCode: 'DISPATCH_FAILED',
        idempotencyKey: intent.idempotencyKey,
        deliveredAt: null,
      });
      expect(pending.availableAt.getTime()).toBeGreaterThan(Date.now());
      const retry = await server.inject({
        method: 'POST',
        url: `/v1/claims/${claim.id}/calls`,
        headers,
        payload: {},
      });
      expect(retry.statusCode).toBe(202);
      expect(retry.json<{ jobId: string }>().jobId).toBe(intent.idempotencyKey);
      expect(queueAddSpy).toHaveBeenCalledTimes(1);
      expect(await prisma.callIntent.count({ where: { organizationId: org.id } })).toBe(1);
      expect(await prisma.jobOutbox.count({ where: { organizationId: org.id } })).toBe(1);
      vi.setSystemTime(pending.availableAt);
      const delivered = await server.inject({
        method: 'POST',
        url: `/v1/claims/${claim.id}/calls`,
        headers,
        payload: {},
      });
      expect(delivered.statusCode).toBe(202);
      expect(queueAddSpy).toHaveBeenCalledTimes(2);
      expect(queueAddSpy.mock.calls[0]?.[1]).toEqual(queueAddSpy.mock.calls[1]?.[1]);
      expect(await prisma.jobOutbox.findFirst({ where: { organizationId: org.id } })).toMatchObject(
        {
          state: 'DELIVERED',
          deliveryAttempts: 2,
          idempotencyKey: intent.idempotencyKey,
        },
      );
      expect(
        await prisma.auditLog.count({ where: { organizationId: org.id, action: 'call.enqueue' } }),
      ).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['AuditLog', 'JobOutbox'] as const)(
    'rolls back the claim, intent, audit, and outbox when %s insertion fails',
    async (table) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-13T18:00:00.000Z'));
      try {
        const org = await makeOrg('Synthetic rollback');
        const claim = await makeClaim(org.id);
        const before = await prisma.claim.findFirstOrThrow({
          where: { id: claim.id, organizationId: org.id },
        });
        await rejectProducerInsert(table);
        const response = await server.inject({
          method: 'POST',
          url: `/v1/claims/${claim.id}/calls`,
          headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id },
          payload: {},
        });
        expect(response.statusCode).toBe(500);
        expect(queueAddSpy).not.toHaveBeenCalled();
        expect(
          await prisma.claim.findFirst({ where: { id: claim.id, organizationId: org.id } }),
        ).toEqual(before);
        expect(await prisma.callIntent.count({ where: { organizationId: org.id } })).toBe(0);
        expect(await prisma.jobOutbox.count({ where: { organizationId: org.id } })).toBe(0);
        expect(
          await prisma.auditLog.count({
            where: { organizationId: org.id, action: 'call.enqueue' },
          }),
        ).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('retains the command when queue acceptance succeeds but marking delivery fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T18:00:00.000Z'));
    try {
      const org = await makeOrg('Synthetic receipt failure');
      const claim = await makeClaim(org.id);
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION reject_api_producer_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'DELIVERED' THEN RAISE EXCEPTION 'synthetic delivery receipt outage'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER reject_api_producer_write BEFORE UPDATE ON "JobOutbox" FOR EACH ROW EXECUTE FUNCTION reject_api_producer_write()',
      );
      const request = {
        method: 'POST' as const,
        url: `/v1/claims/${claim.id}/calls`,
        headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id },
        payload: {},
      };
      expect((await server.inject(request)).statusCode).toBe(202);
      const pending = await prisma.jobOutbox.findFirstOrThrow({
        where: { organizationId: org.id },
      });
      expect(pending).toMatchObject({ state: 'PENDING', deliveredAt: null, deliveryAttempts: 1 });
      expect(pending.leaseExpiresAt).not.toBeNull();
      expect((await server.inject(request)).statusCode).toBe(202);
      expect(queueAddSpy).toHaveBeenCalledTimes(1);
      await prisma.$executeRawUnsafe('DROP TRIGGER reject_api_producer_write ON "JobOutbox"');
      if (!pending.leaseExpiresAt) throw new Error('Missing pending delivery lease');
      vi.setSystemTime(pending.leaseExpiresAt);
      expect((await server.inject(request)).statusCode).toBe(202);
      expect(queueAddSpy).toHaveBeenCalledTimes(2);
      expect(queueAddSpy.mock.calls[0]?.[1]).toEqual(queueAddSpy.mock.calls[1]?.[1]);
      expect(await prisma.callIntent.count({ where: { organizationId: org.id } })).toBe(1);
      expect(await prisma.jobOutbox.findFirst({ where: { organizationId: org.id } })).toMatchObject(
        { state: 'DELIVERED', deliveryAttempts: 2 },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('acknowledges a durable reservation if a redundant postcommit outbox write fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T18:00:00.000Z'));
    try {
      const org = await makeOrg('Synthetic postcommit outage');
      const claim = await makeClaim(org.id);
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION reject_api_producer_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM "JobOutbox" WHERE "organizationId" = NEW."organizationId" AND "kind" = NEW."kind" AND "idempotencyKey" = NEW."idempotencyKey") THEN RAISE EXCEPTION 'synthetic redundant outbox write outage'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER reject_api_producer_write BEFORE INSERT ON "JobOutbox" FOR EACH ROW EXECUTE FUNCTION reject_api_producer_write()',
      );
      const response = await server.inject({
        method: 'POST',
        url: `/v1/claims/${claim.id}/calls`,
        headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id },
        payload: {},
      });
      expect(response.statusCode).toBe(202);
      const intent = await prisma.callIntent.findFirstOrThrow({
        where: { organizationId: org.id },
      });
      expect(response.json<{ jobId: string }>().jobId).toBe(intent.idempotencyKey);
      expect(
        await prisma.jobOutbox.count({
          where: { organizationId: org.id, idempotencyKey: intent.idempotencyKey },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({ where: { organizationId: org.id, action: 'call.enqueue' } }),
      ).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

interface SeedCallResult {
  readonly orgId: string;
  readonly claimId: string;
  readonly callId: string;
}

async function seedOrgClaimAndCall(opts?: {
  status?:
    | 'INITIATED'
    | 'NAVIGATING_IVR'
    | 'ON_HOLD'
    | 'HUMAN_REACHED'
    | 'COMPLETED'
    | 'FAILED'
    | 'VOICEMAIL';
  startedAt?: Date;
  payerCode?: 'DELTA_DENTAL_PPO' | 'CIGNA_DENTAL' | 'METLIFE_DENTAL';
}): Promise<SeedCallResult> {
  const org = await makeOrg('CallList');
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      patientDOBHash: 'hash_abc',
      claimNumber: `CL-LIST-${Math.random().toString(36).slice(2, 7)}`,
      cdtCodes: ['D2740'],
      claimAmount: '420.00',
      payerCode: opts?.payerCode ?? 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-01-15T00:00:00.000Z'),
      status: 'CALLING',
      priority: 80,
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: `rcid_${Math.random().toString(36).slice(2)}`,
      status: opts?.status ?? 'NAVIGATING_IVR',
      attemptNumber: 1,
      startedAt: opts?.startedAt ?? new Date('2026-01-15T18:00:00.000Z'),
    },
  });
  return { orgId: org.id, claimId: claim.id, callId: call.id };
}

describe('GET /v1/calls (P3-T18 — list)', () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
    );
  });

  it('rejects unauthenticated requests with 401', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/calls' });
    expect(response.statusCode).toBe(401);
  });

  it('returns only the calls belonging to the requesting org (cross-org isolation)', async () => {
    const seedA = await seedOrgClaimAndCall();
    const seedB = await seedOrgClaimAndCall();
    const response = await server.inject({
      method: 'GET',
      url: '/v1/calls',
      headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': seedA.orgId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { id: string }[] }>();
    expect(body.items.map((c) => c.id)).toEqual([seedA.callId]);
    // Negative: org A did not leak org B's call.
    expect(body.items.map((c) => c.id)).not.toContain(seedB.callId);
  });

  it('paginates with cursor + hasMore + nextCursor', async () => {
    const org = await makeOrg('Page');
    const headers = { 'x-test-user-id': 'user_p', 'x-test-org-id': org.id };
    // Seed three calls staggered so the desc sort order is deterministic.
    const claim = await prisma.claim.create({
      data: {
        organizationId: org.id,
        patientDOBHash: 'hash_abc',
        claimNumber: 'CL-PAGE-1',
        cdtCodes: ['D2740'],
        claimAmount: '420.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-01-15T00:00:00.000Z'),
        status: 'CALLING',
        priority: 80,
      },
    });
    const callIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const c = await prisma.call.create({
        data: {
          organizationId: org.id,
          claimId: claim.id,
          retellCallId: `rcid_p_${String(i)}_${Math.random().toString(36).slice(2)}`,
          status: 'COMPLETED',
          attemptNumber: i === 1 ? 2 : 1,
          startedAt: new Date(`2026-01-15T18:0${String(i)}:00.000Z`),
        },
      });
      callIds.push(c.id);
    }

    const first = await server.inject({
      method: 'GET',
      url: '/v1/calls?limit=2',
      headers,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{
      items: { id: string }[];
      hasMore: boolean;
      nextCursor: string | null;
    }>();
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextCursor).not.toBeNull();
    // Desc — newest startedAt first.
    expect(firstBody.items[0]?.id).toBe(callIds[2]);
    expect(firstBody.items[1]?.id).toBe(callIds[1]);

    const second = await server.inject({
      method: 'GET',
      url: `/v1/calls?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
      headers,
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<{ items: { id: string }[]; hasMore: boolean }>();
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0]?.id).toBe(callIds[0]);
    expect(secondBody.hasMore).toBe(false);
  });

  it('filters by status', async () => {
    const seed = await seedOrgClaimAndCall({ status: 'COMPLETED' });
    await seedOrgClaimAndCall({ status: 'FAILED' });
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': seed.orgId };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/calls?status=COMPLETED',
      headers,
    });
    const body = response.json<{ items: { id: string; status: string }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.status).toBe('COMPLETED');
  });

  it('filters by payer via the joined Claim relation', async () => {
    const seed = await seedOrgClaimAndCall({ payerCode: 'CIGNA_DENTAL' });
    // Add a Delta call under the SAME org so the filter actually narrows.
    const otherClaim = await prisma.claim.create({
      data: {
        organizationId: seed.orgId,
        patientDOBHash: 'hash_abc',
        claimNumber: 'CL-OTHER-1',
        cdtCodes: ['D2740'],
        claimAmount: '420.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-01-15T00:00:00.000Z'),
        status: 'CALLING',
        priority: 80,
      },
    });
    await prisma.call.create({
      data: {
        organizationId: seed.orgId,
        claimId: otherClaim.id,
        retellCallId: `rcid_${Math.random().toString(36).slice(2)}`,
        status: 'COMPLETED',
        attemptNumber: 1,
        startedAt: new Date('2026-01-15T18:30:00.000Z'),
      },
    });
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': seed.orgId };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/calls?payer=CIGNA_DENTAL',
      headers,
    });
    const body = response.json<{ items: { id: string }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe(seed.callId);
  });

  it('rejects 400 on a malformed cursor', async () => {
    const seed = await seedOrgClaimAndCall();
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': seed.orgId };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/calls?cursor=this-is-not-valid',
      headers,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /v1/calls/:id (P3-T19 — detail)', () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
    );
  });

  it('returns detail with embedded events and claim summary', async () => {
    const seed = await seedOrgClaimAndCall();
    await prisma.callEvent.create({
      data: {
        callId: seed.callId,
        eventType: 'call.started',
        data: { retellCallId: 'rcid_xx' },
      },
    });
    await prisma.callEvent.create({
      data: {
        callId: seed.callId,
        eventType: 'call.transcript',
        data: { role: 'agent', text: 'hello' },
      },
    });
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': seed.orgId };
    const response = await server.inject({
      method: 'GET',
      url: `/v1/calls/${seed.callId}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id: string;
      events: { eventType: string }[];
      claim: { id: string; payerCode: string };
    }>();
    expect(body.id).toBe(seed.callId);
    expect(body.events.map((e) => e.eventType)).toEqual(['call.started', 'call.transcript']);
    expect(body.claim.id).toBe(seed.claimId);
    expect(body.claim.payerCode).toBe('DELTA_DENTAL_PPO');
    // Audit row written.
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: seed.orgId, action: 'call.read' },
    });
    expect(audits).toHaveLength(1);
  });

  it('returns 404 when the call belongs to a different org (cross-org leak)', async () => {
    const seedA = await seedOrgClaimAndCall();
    const orgB = await makeOrg('B');
    const headers = { 'x-test-user-id': 'user_b', 'x-test-org-id': orgB.id };
    const response = await server.inject({
      method: 'GET',
      url: `/v1/calls/${seedA.callId}`,
      headers,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /v1/calls/:id/cancel (P3-T20 — idempotent cancel)', () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
    );
  });

  it('requests cancellation while preserving provider status and terminal evidence', async () => {
    const seed = await seedOrgClaimAndCall({ status: 'NAVIGATING_IVR' });
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': seed.orgId };
    const response = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seed.callId}/cancel`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      dlqReason: string | null;
      cancelRequestedAt: string | null;
      endedAt: string | null;
      durationSeconds: number | null;
    }>();
    expect(body).toMatchObject({
      status: 'NAVIGATING_IVR',
      dlqReason: null,
      endedAt: null,
      durationSeconds: null,
    });
    expect(body.cancelRequestedAt).toEqual(expect.any(String));

    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: seed.callId } });
    expect(callAfter.endedAt).toBeNull();
    expect(callAfter.durationSeconds).toBeNull();
    expect(callAfter.cancelRequestedAt?.toISOString()).toBe(body.cancelRequestedAt);
    expect(callAfter.cancelRequestedBy).toBe('user_a');
    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: seed.claimId } });
    expect(claimAfter.status).toBe('MANUAL_REVIEW');
    const events = await prisma.callEvent.findMany({
      where: { callId: seed.callId, eventType: 'call.cancel.requested' },
    });
    expect(events).toHaveLength(1);
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: seed.orgId, action: 'call.cancel.requested' },
    });
    expect(audits).toHaveLength(1);
    for (const url of [`/v1/calls/${seed.callId}`, '/v1/calls']) {
      const read = await server.inject({ method: 'GET', url, headers });
      expect(read.statusCode).toBe(200);
      const data = read.json<{
        cancelRequestedAt?: string;
        items?: { id: string; cancelRequestedAt: string }[];
      }>();
      expect(
        data.items?.find((item) => item.id === seed.callId)?.cancelRequestedAt ??
          data.cancelRequestedAt,
      ).toBe(body.cancelRequestedAt);
    }
  });

  it('is idempotent: a terminal call returns 200 without re-writing', async () => {
    const seed = await seedOrgClaimAndCall({ status: 'COMPLETED' });
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': seed.orgId };
    const response = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seed.callId}/cancel`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: seed.callId } });
    expect(callAfter.status).toBe('COMPLETED');
    expect(callAfter.dlqReason).toBeNull();
    const events = await prisma.callEvent.findMany({
      where: { callId: seed.callId, eventType: 'call.cancel.requested' },
    });
    expect(events).toHaveLength(0);
    expect(callAfter.cancelRequestedAt).toBeNull();
    expect(response.json<{ cancelRequestedAt: string | null }>().cancelRequestedAt).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { organizationId: seed.orgId, action: 'call.cancel.requested' },
      }),
    ).toBe(0);
  });

  it('concurrent cancellation requests write one request event and audit', async () => {
    const seed = await seedOrgClaimAndCall({ status: 'ON_HOLD' });
    const request = {
      method: 'POST' as const,
      url: `/v1/calls/${seed.callId}/cancel`,
      headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': seed.orgId },
    };
    const responses = await Promise.all([server.inject(request), server.inject(request)]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses[0].json()).toEqual(responses[1].json());
    expect(responses[0].json()).toMatchObject({
      status: 'ON_HOLD',
      endedAt: null,
      durationSeconds: null,
    });
    expect(
      await prisma.callEvent.count({
        where: { callId: seed.callId, eventType: 'call.cancel.requested' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: seed.orgId, action: 'call.cancel.requested' },
      }),
    ).toBe(1);
  });

  it('preserves a reviewed claim when requesting cancellation', async () => {
    const seed = await seedOrgClaimAndCall({ status: 'ON_HOLD' });
    const reviewed = await prisma.claim.update({
      where: { id: seed.claimId, organizationId: seed.orgId },
      data: { status: 'WRITTEN_OFF' },
    });
    const response = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seed.callId}/cancel`,
      headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': seed.orgId },
    });
    expect(response.statusCode).toBe(200);
    expect(
      await prisma.claim.findFirst({ where: { id: seed.claimId, organizationId: seed.orgId } }),
    ).toEqual(reviewed);
  });

  it('records the originating Clerk actor for a DB-resolved authenticated user', async () => {
    const seed = await seedOrgClaimAndCall({ status: 'ON_HOLD' });
    const actor = await prisma.user.create({
      data: {
        organizationId: seed.orgId,
        clerkUserId: 'clerk_cancel_real_identity',
        email: 'synthetic-actor@cancel.test',
        role: 'OWNER',
      },
    });
    const response = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seed.callId}/cancel`,
      headers: { 'x-test-user-id': actor.clerkUserId },
    });
    expect(response.statusCode).toBe(200);
    expect(
      await prisma.call.findFirst({ where: { id: seed.callId, organizationId: seed.orgId } }),
    ).toMatchObject({ cancelRequestedBy: actor.clerkUserId });
    expect(
      await prisma.auditLog.findFirst({
        where: { organizationId: seed.orgId, action: 'call.cancel.requested' },
      }),
    ).toMatchObject({ metadata: { clerkUserId: actor.clerkUserId } });
  });

  it('returns 404 when the call belongs to a different org (cross-org leak)', async () => {
    const seedA = await seedOrgClaimAndCall();
    const orgB = await makeOrg('B');
    const headers = { 'x-test-user-id': 'user_b', 'x-test-org-id': orgB.id };
    const response = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seedA.callId}/cancel`,
      headers,
    });
    expect(response.statusCode).toBe(404);
    // Org A's call must remain unchanged.
    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: seedA.callId } });
    expect(callAfter.dlqReason).toBeNull();
    expect(callAfter.cancelRequestedAt).toBeNull();
    expect(await prisma.callEvent.count({ where: { callId: seedA.callId } })).toBe(0);
  });
});

describe('GET /v1/calls/stats (P3-T25 — overview aggregates)', () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
    );
  });

  it('rejects unauthenticated requests with 401', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/calls/stats' });
    expect(response.statusCode).toBe(401);
  });

  it('returns zeroed metrics for an org with no calls or resolved claims', async () => {
    const org = await makeOrg('StatsEmpty');
    const response = await server.inject({
      method: 'GET',
      url: '/v1/calls/stats',
      headers: { 'x-test-user-id': 'user_x', 'x-test-org-id': org.id },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      callsToday: number;
      queueDepth: number;
      avgCallSeconds: number | null;
      verifiedPayments: {
        status: 'unavailable';
        reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED';
        amountCents: null;
      };
    }>();
    expect(body).toEqual({
      callsToday: 0,
      queueDepth: 0,
      avgCallSeconds: null,
      verifiedPayments: {
        status: 'unavailable',
        reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
        amountCents: null,
      },
    });
  });

  it('aggregates operational metrics without inferring payments from resolved claims', async () => {
    const org = await makeOrg('StatsAgg');
    // Seed claim referenced by the calls.
    const baseClaim = await prisma.claim.create({
      data: {
        organizationId: org.id,
        patientDOBHash: 'h',
        claimNumber: 'CL-S-1',
        cdtCodes: ['D2740'],
        claimAmount: '500.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-04-15T00:00:00.000Z'),
        status: 'CALLING',
        priority: 80,
      },
    });
    // Two calls today (UTC), one earlier this week (counts in avg only),
    // one >7d ago (not in avg).
    const now = new Date();
    const startOfTodayUTC = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
    const today1 = new Date(startOfTodayUTC.getTime() + 60 * 60 * 1000);
    const today2 = new Date(startOfTodayUTC.getTime() + 4 * 60 * 60 * 1000);
    const threeDaysAgoStart = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const threeDaysAgoEnd = new Date(threeDaysAgoStart.getTime() + 90 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    await prisma.call.createMany({
      data: [
        {
          organizationId: org.id,
          claimId: baseClaim.id,
          retellCallId: 'rcid_today1',
          status: 'COMPLETED',
          attemptNumber: 1,
          startedAt: today1,
          endedAt: new Date(today1.getTime() + 60 * 1000),
          durationSeconds: 60,
        },
        {
          organizationId: org.id,
          claimId: baseClaim.id,
          retellCallId: 'rcid_today2',
          status: 'COMPLETED',
          attemptNumber: 1,
          startedAt: today2,
          endedAt: new Date(today2.getTime() + 120 * 1000),
          durationSeconds: 120,
        },
        {
          organizationId: org.id,
          claimId: baseClaim.id,
          retellCallId: 'rcid_3d',
          status: 'COMPLETED',
          attemptNumber: 1,
          startedAt: threeDaysAgoStart,
          endedAt: threeDaysAgoEnd,
          durationSeconds: 90,
        },
        {
          organizationId: org.id,
          claimId: baseClaim.id,
          retellCallId: 'rcid_10d',
          status: 'COMPLETED',
          attemptNumber: 1,
          startedAt: tenDaysAgo,
          endedAt: new Date(tenDaysAgo.getTime() + 999 * 1000),
          durationSeconds: 999, // outside 7-day window — excluded from avg
        },
      ],
    });

    // Queue depth — three claims in queueable statuses.
    await prisma.claim.createMany({
      data: [
        {
          organizationId: org.id,
          patientDOBHash: 'h',
          claimNumber: 'CL-Q-1',
          cdtCodes: ['D2740'],
          claimAmount: '100.00',
          payerCode: 'CIGNA_DENTAL',
          serviceDate: new Date('2026-04-15T00:00:00.000Z'),
          status: 'PENDING',
          priority: 80,
        },
        {
          organizationId: org.id,
          patientDOBHash: 'h',
          claimNumber: 'CL-Q-2',
          cdtCodes: ['D2740'],
          claimAmount: '200.00',
          payerCode: 'CIGNA_DENTAL',
          serviceDate: new Date('2026-04-15T00:00:00.000Z'),
          status: 'IN_QUEUE',
          priority: 80,
        },
      ],
    });

    // Recently modified RESOLVED claims do not establish payment evidence.
    await prisma.claim.create({
      data: {
        organizationId: org.id,
        patientDOBHash: 'h',
        claimNumber: 'CL-R-1',
        cdtCodes: ['D2740'],
        claimAmount: '350.50',
        payerCode: 'METLIFE_DENTAL',
        serviceDate: new Date('2026-04-15T00:00:00.000Z'),
        status: 'RESOLVED',
        priority: 80,
      },
    });
    await prisma.claim.create({
      data: {
        organizationId: org.id,
        patientDOBHash: 'h',
        claimNumber: 'CL-R-2',
        cdtCodes: ['D2740'],
        claimAmount: '149.50',
        payerCode: 'METLIFE_DENTAL',
        serviceDate: new Date('2026-04-15T00:00:00.000Z'),
        status: 'RESOLVED',
        priority: 80,
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/v1/calls/stats',
      headers: { 'x-test-user-id': 'user_x', 'x-test-org-id': org.id },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      callsToday: number;
      queueDepth: number;
      avgCallSeconds: number | null;
      verifiedPayments: {
        status: 'unavailable';
        reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED';
        amountCents: null;
      };
    }>();
    expect(body.callsToday).toBe(2);
    // 2 fresh PENDING/IN_QUEUE rows + the seedClaim's CALLING row (also queueable).
    expect(body.queueDepth).toBe(3);
    // Avg over 60, 120, 90 (the 999s call is outside the 7-day window).
    expect(body.avgCallSeconds).toBe(90);
    expect(body.verifiedPayments).toEqual({
      status: 'unavailable',
      reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
      amountCents: null,
    });
    expect(body).not.toHaveProperty('recoveredThisWeekCents');
  });

  it('does not leak rows from another organization', async () => {
    const orgA = await makeOrg('StatsA');
    const orgB = await makeOrg('StatsB');
    // Seed orgB with a stats-eligible call+claim — orgA's stats must remain zero.
    const claim = await prisma.claim.create({
      data: {
        organizationId: orgB.id,
        patientDOBHash: 'h',
        claimNumber: 'CL-X',
        cdtCodes: ['D2740'],
        claimAmount: '999.99',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-04-15T00:00:00.000Z'),
        status: 'RESOLVED',
        priority: 80,
      },
    });
    await prisma.call.create({
      data: {
        organizationId: orgB.id,
        claimId: claim.id,
        retellCallId: 'rcid_b',
        status: 'COMPLETED',
        attemptNumber: 1,
        startedAt: new Date(),
        endedAt: new Date(),
        durationSeconds: 200,
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/v1/calls/stats',
      headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': orgA.id },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      callsToday: 0,
      queueDepth: 0,
      avgCallSeconds: null,
      verifiedPayments: {
        status: 'unavailable',
        reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
        amountCents: null,
      },
    });
  });
});

// ─── /v1/calls/:id/summary + /summary/retry (P4-T2H) ───────────────────────

describe('GET /v1/calls/:id/summary + POST /v1/calls/:id/summary/retry', () => {
  let server: FastifyInstance;
  let summariesAddSpy: Mock<
    (name: string, data: unknown, opts: unknown) => Promise<{ id: string }>
  >;

  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
    await prisma.$connect();
    summariesAddSpy = vi.fn(async (_name, _data, opts) => ({
      id: (opts as { jobId?: string } | undefined)?.jobId ?? 'mocked',
    }));
    server.summariesQueue.add = summariesAddSpy as unknown as typeof server.summariesQueue.add;
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    summariesAddSpy.mockClear();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
    );
  });

  async function seedSummaryFixture(role: 'OWNER' | 'ADMIN' | 'BILLING_STAFF' = 'OWNER'): Promise<{
    readonly orgId: string;
    readonly callId: string;
    readonly summaryId: string;
    readonly clerkUserId: string;
  }> {
    const org = await prisma.organization.create({
      data: { name: 'Summary Co', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
    });
    const clerkUserId = `clerk_user_${Math.random().toString(36).slice(2)}`;
    await prisma.user.create({
      data: {
        organizationId: org.id,
        clerkUserId,
        email: 'owner@summary.test',
        role,
      },
    });
    const claim = await prisma.claim.create({
      data: {
        organizationId: org.id,
        patientDOBHash: 'h',
        claimNumber: 'CL-SUM-1',
        cdtCodes: ['D2740'],
        claimAmount: '420.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-01-15T00:00:00.000Z'),
        status: 'COMPLETED',
        priority: 80,
      },
    });
    const call = await prisma.call.create({
      data: {
        organizationId: org.id,
        claimId: claim.id,
        retellCallId: `rc_${Math.random().toString(36).slice(2)}`,
        status: 'COMPLETED',
        attemptNumber: 1,
      },
    });
    const summary = await prisma.callSummary.create({
      data: {
        organizationId: org.id,
        callId: call.id,
        claimStatus: 'paid',
        nextAction: 'RESOLVED',
        confidence: 0.97,
        repName: 'Lisa M.',
        referenceNumber: 'REF-1',
        amountApproved: '240.00',
        rawTranscript: 'transcript text',
        claudeSummary: 'summary text',
      },
    });
    return { orgId: org.id, callId: call.id, summaryId: summary.id, clerkUserId };
  }

  it('GET returns 404 when no summary exists yet', async () => {
    const org = await makeOrg('Empty');
    const claim = await prisma.claim.create({
      data: {
        organizationId: org.id,
        patientDOBHash: 'h',
        claimNumber: 'CL-NOSUM',
        cdtCodes: ['D2740'],
        claimAmount: '100.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date(),
        priority: 50,
      },
    });
    const call = await prisma.call.create({
      data: {
        organizationId: org.id,
        claimId: claim.id,
        retellCallId: 'rc_nosum',
        status: 'COMPLETED',
        attemptNumber: 1,
      },
    });
    const response = await server.inject({
      method: 'GET',
      url: `/v1/calls/${call.id}/summary`,
      headers: { 'x-test-user-id': 'user_x', 'x-test-org-id': org.id },
    });
    expect(response.statusCode).toBe(404);
  });

  it('GET returns the summary with cents-mapped amount and ISO dates', async () => {
    const seed = await seedSummaryFixture();
    const response = await server.inject({
      method: 'GET',
      url: `/v1/calls/${seed.callId}/summary`,
      headers: { 'x-test-user-id': 'user_g', 'x-test-org-id': seed.orgId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id: string;
      callId: string;
      organizationId: string;
      amountApprovedCents: number | null;
      nextAction: string;
    }>();
    expect(body.id).toBe(seed.summaryId);
    expect(body.callId).toBe(seed.callId);
    expect(body.organizationId).toBe(seed.orgId);
    expect(body.amountApprovedCents).toBe(24000);
    expect(body.nextAction).toBe('RESOLVED');
  });

  it('GET returns 404 across orgs (cross-tenant)', async () => {
    const seedA = await seedSummaryFixture();
    const orgB = await makeOrg('OtherOrg');
    const response = await server.inject({
      method: 'GET',
      url: `/v1/calls/${seedA.callId}/summary`,
      headers: { 'x-test-user-id': 'user_b', 'x-test-org-id': orgB.id },
    });
    expect(response.statusCode).toBe(404);
  });

  it('POST retry: BILLING_STAFF gets 403', async () => {
    const seed = await seedSummaryFixture('BILLING_STAFF');
    const response = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seed.callId}/summary/retry`,
      headers: { 'x-test-user-id': seed.clerkUserId },
    });
    expect(response.statusCode).toBe(403);
    expect(summariesAddSpy).not.toHaveBeenCalled();
  });

  it.each(['INITIATED', 'NAVIGATING_IVR', 'ON_HOLD', 'HUMAN_REACHED', 'COLLECTING'] as const)(
    'POST retry: refuses an active %s call before dispatch or audit',
    async (status) => {
      const seed = await seedSummaryFixture('OWNER');
      await prisma.call.updateMany({
        where: { id: seed.callId, organizationId: seed.orgId },
        data: { status },
      });
      await prisma.callSummary.deleteMany({
        where: { callId: seed.callId, organizationId: seed.orgId },
      });
      const response = await server.inject({
        method: 'POST',
        url: `/v1/calls/${seed.callId}/summary/retry`,
        headers: { 'x-test-user-id': seed.clerkUserId },
      });
      expect(response.statusCode).toBe(400);
      expect(bodyAsError(response).code).toBe('VALIDATION_ERROR');
      expect(summariesAddSpy).not.toHaveBeenCalled();
      expect(
        await prisma.call.findFirstOrThrow({
          where: { id: seed.callId, organizationId: seed.orgId },
        }),
      ).toMatchObject({ status });
      expect(
        await prisma.callSummary.count({
          where: { callId: seed.callId, organizationId: seed.orgId },
        }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: {
            resourceId: seed.callId,
            organizationId: seed.orgId,
            action: 'callSummary.retry',
          },
        }),
      ).toBe(0);
    },
  );

  it('POST retry: OWNER enqueues summary.generate with deterministic retryNumber', async () => {
    const seed = await seedSummaryFixture('OWNER');
    summariesAddSpy.mockImplementationOnce(async (_name, _data, opts) => {
      expect(
        await prisma.auditLog.count({
          where: { organizationId: seed.orgId, action: 'callSummary.retry' },
        }),
      ).toBe(1);
      expect(
        await prisma.jobOutbox.findFirst({ where: { organizationId: seed.orgId } }),
      ).toMatchObject({ kind: 'SUMMARY_GENERATE', state: 'PENDING', deliveryAttempts: 1 });
      return { id: (opts as { jobId: string }).jobId };
    });
    const first = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seed.callId}/summary/retry`,
      headers: { 'x-test-user-id': seed.clerkUserId },
    });
    expect(first.statusCode).toBe(202);
    const firstBody = first.json<{ retryNumber: number; jobId: string }>();
    expect(firstBody.retryNumber).toBe(1);
    expect(firstBody.jobId).toBe(`call.${seed.callId}.retry.1`);
    expect(summariesAddSpy).toHaveBeenCalledTimes(1);

    const second = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seed.callId}/summary/retry`,
      headers: { 'x-test-user-id': seed.clerkUserId },
    });
    expect(second.statusCode).toBe(202);
    expect(second.json<{ retryNumber: number }>().retryNumber).toBe(2);
    const outboxes = await prisma.jobOutbox.findMany({
      where: { organizationId: seed.orgId },
      orderBy: { idempotencyKey: 'asc' },
    });
    expect(outboxes).toHaveLength(2);
    expect(outboxes.map((row) => row.idempotencyKey)).toEqual([
      `call.${seed.callId}.retry.1`,
      `call.${seed.callId}.retry.2`,
    ]);
    expect(
      outboxes.every((row) => row.state === 'DELIVERED' && row.kind === 'SUMMARY_GENERATE'),
    ).toBe(true);
  });

  it('POST retry: concurrent requests reserve distinct retry numbers with matching audits and outbox commands', async () => {
    const seed = await seedSummaryFixture('OWNER');
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        server.inject({
          method: 'POST',
          url: `/v1/calls/${seed.callId}/summary/retry`,
          headers: { 'x-test-user-id': seed.clerkUserId },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([202, 202, 202]);
    const bodies = responses.map((response) =>
      response.json<{ retryNumber: number; jobId: string }>(),
    );
    expect(bodies.map((body) => body.retryNumber).sort()).toEqual([1, 2, 3]);
    expect(new Set(bodies.map((body) => body.jobId)).size).toBe(3);
    expect(summariesAddSpy).toHaveBeenCalledTimes(3);
    const outboxes = await prisma.jobOutbox.findMany({ where: { organizationId: seed.orgId } });
    expect(outboxes).toHaveLength(3);
    for (const body of bodies) {
      expect(outboxes.find((row) => row.idempotencyKey === body.jobId)).toMatchObject({
        state: 'DELIVERED',
        kind: 'SUMMARY_GENERATE',
        payload: {
          organizationId: seed.orgId,
          callId: seed.callId,
          idempotencyKey: body.jobId,
          promptVersion: 'v1',
        },
      });
    }
    expect(
      await prisma.auditLog.count({
        where: { organizationId: seed.orgId, action: 'callSummary.retry' },
      }),
    ).toBe(3);
  });

  it.each(['AuditLog', 'JobOutbox'] as const)(
    'POST retry: %s failure rolls back the retry reservation and preserves evidence',
    async (table) => {
      const seed = await seedSummaryFixture('OWNER');
      const before = await prisma.call.findFirstOrThrow({
        where: { id: seed.callId, organizationId: seed.orgId },
      });
      const summaryBefore = await prisma.callSummary.findFirstOrThrow({
        where: { callId: seed.callId, organizationId: seed.orgId },
      });
      await rejectProducerInsert(table);
      const response = await server.inject({
        method: 'POST',
        url: `/v1/calls/${seed.callId}/summary/retry`,
        headers: { 'x-test-user-id': seed.clerkUserId },
      });
      expect(response.statusCode).toBe(500);
      expect(summariesAddSpy).not.toHaveBeenCalled();
      expect(
        await prisma.call.findFirst({ where: { id: seed.callId, organizationId: seed.orgId } }),
      ).toEqual(before);
      expect(
        await prisma.callSummary.findFirst({
          where: { callId: seed.callId, organizationId: seed.orgId },
        }),
      ).toEqual(summaryBefore);
      expect(await prisma.jobOutbox.count({ where: { organizationId: seed.orgId } })).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { organizationId: seed.orgId, action: 'callSummary.retry' },
        }),
      ).toBe(0);
    },
  );

  it('POST retry: transport failure remains durably accepted and relay respects backoff', async () => {
    const seed = await seedSummaryFixture('OWNER');
    summariesAddSpy.mockRejectedValueOnce(new Error('synthetic queue unavailable'));
    const response = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seed.callId}/summary/retry`,
      headers: { 'x-test-user-id': seed.clerkUserId },
    });
    expect(response.statusCode).toBe(202);
    const body = response.json<{ jobId: string; retryNumber: number }>();
    expect(body.retryNumber).toBe(1);
    const pending = await prisma.jobOutbox.findFirstOrThrow({
      where: { organizationId: seed.orgId },
    });
    expect(pending).toMatchObject({
      state: 'PENDING',
      deliveredAt: null,
      deliveryAttempts: 1,
      lastErrorCode: 'DISPATCH_FAILED',
      idempotencyKey: body.jobId,
    });
    expect(pending.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(
      await relayJobOutbox({
        prisma,
        jobDispatcher: server.jobDispatcher,
        organizationId: seed.orgId,
      }),
    ).toMatchObject({ selected: 0 });
    expect(summariesAddSpy).toHaveBeenCalledTimes(1);
    expect(
      await relayJobOutbox({
        prisma,
        jobDispatcher: server.jobDispatcher,
        organizationId: seed.orgId,
        clock: () => pending.availableAt,
      }),
    ).toMatchObject({ sent: 1 });
    expect(summariesAddSpy).toHaveBeenCalledTimes(2);
    expect(summariesAddSpy.mock.calls[0]?.[1]).toEqual(summariesAddSpy.mock.calls[1]?.[1]);
    expect(
      await prisma.jobOutbox.findFirst({ where: { organizationId: seed.orgId } }),
    ).toMatchObject({ state: 'DELIVERED', idempotencyKey: body.jobId, deliveryAttempts: 2 });
    expect(
      await prisma.auditLog.count({
        where: { organizationId: seed.orgId, action: 'callSummary.retry' },
      }),
    ).toBe(1);
  });

  it('POST retry: 404 when call does not belong to the caller’s org', async () => {
    const seedA = await seedSummaryFixture('OWNER');
    const orgB = await prisma.organization.create({
      data: { name: 'OtherOrg', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
    });
    const userB = await prisma.user.create({
      data: {
        organizationId: orgB.id,
        clerkUserId: `clerk_user_b_${Math.random().toString(36).slice(2)}`,
        email: 'b@b.test',
        role: 'OWNER',
      },
    });
    const response = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seedA.callId}/summary/retry`,
      headers: { 'x-test-user-id': userB.clerkUserId },
    });
    expect(response.statusCode).toBe(404);
    expect(summariesAddSpy).not.toHaveBeenCalled();
  });
});
