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
    payerCode: 'DELTA_DENTAL_PPO' | 'CIGNA_DENTAL' | 'METLIFE_DENTAL' | 'AETNA_DENTAL' | 'UNKNOWN';
  }>,
): Promise<SeededClaim> {
  const claim = await prisma.claim.create({
    data: {
      organizationId: orgId,
      patientDOBHash: 'hash_abc',
      patientDOBLast4: '1990',
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
    server = await buildServer({ logger: false });
    await prisma.$connect();
    // Replace the queue's `add` with a spy so injected tests don't
    // open a real Redis connection. The lazy-connect setting in
    // queue.ts means no socket is opened until first call anyway.
    queueAddSpy = vi.fn(async () => ({ id: 'mocked' }));
    server.callsQueue.add = queueAddSpy as unknown as typeof server.callsQueue.add;
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    queueAddSpy.mockClear();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog" RESTART IDENTITY CASCADE',
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
      expect(body.jobId.startsWith(`${claim.id}-a1-`)).toBe(true);

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

  it('rolls Claim back to its original status if BullMQ add() throws', async () => {
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
      expect(response.statusCode).toBe(500); // unhandled — sanitised by global handler
      const after = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } });
      expect(after.status).toBe('PENDING');
    } finally {
      vi.useRealTimers();
    }
  });
});
