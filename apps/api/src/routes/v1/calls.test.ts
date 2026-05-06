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

  it('flips an in-flight call to FAILED + CANCELLED_BY_OPERATOR + escalates Claim', async () => {
    const seed = await seedOrgClaimAndCall({ status: 'NAVIGATING_IVR' });
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': seed.orgId };
    const response = await server.inject({
      method: 'POST',
      url: `/v1/calls/${seed.callId}/cancel`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; dlqReason: string }>();
    expect(body.status).toBe('FAILED');
    expect(body.dlqReason).toBe('CANCELLED_BY_OPERATOR');

    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: seed.callId } });
    expect(callAfter.endedAt).not.toBeNull();
    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: seed.claimId } });
    expect(claimAfter.status).toBe('MANUAL_REVIEW');
    const events = await prisma.callEvent.findMany({
      where: { callId: seed.callId, eventType: 'call.cancelled' },
    });
    expect(events).toHaveLength(1);
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: seed.orgId, action: 'call.cancel' },
    });
    expect(audits).toHaveLength(1);
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
      where: { callId: seed.callId, eventType: 'call.cancelled' },
    });
    expect(events).toHaveLength(0);
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
      recoveredThisWeekCents: number;
    }>();
    expect(body).toEqual({
      callsToday: 0,
      queueDepth: 0,
      avgCallSeconds: null,
      recoveredThisWeekCents: 0,
    });
  });

  it('aggregates callsToday + queueDepth + avgCallSeconds + recovered$ correctly', async () => {
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

    // Recovered: two RESOLVED claims updated within last 7 days.
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
      recoveredThisWeekCents: number;
    }>();
    expect(body.callsToday).toBe(2);
    // 2 fresh PENDING/IN_QUEUE rows + the seedClaim's CALLING row (also queueable).
    expect(body.queueDepth).toBe(3);
    // Avg over 60, 120, 90 (the 999s call is outside the 7-day window).
    expect(body.avgCallSeconds).toBe(90);
    // 350.50 + 149.50 = 500.00 → 50000¢
    expect(body.recoveredThisWeekCents).toBe(50000);
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
      recoveredThisWeekCents: 0,
    });
  });
});
