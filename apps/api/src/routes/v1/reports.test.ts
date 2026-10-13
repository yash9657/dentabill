import { prisma } from '@dentabill/db';
import type { Organization } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

interface ApiErrorBody {
  error: true;
  message: string;
  code: string;
}

function bodyAsError(response: { json: () => unknown }): ApiErrorBody {
  return response.json() as ApiErrorBody;
}

async function makeOrg(name: string): Promise<Organization> {
  return prisma.organization.create({
    data: { name, clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}`, npi: '1234567890' },
  });
}

describe('GET /v1/reports/summary (G-D1a)', () => {
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
    const response = await server.inject({
      method: 'GET',
      url: '/v1/reports/summary',
    });
    expect(response.statusCode).toBe(401);
    expect(bodyAsError(response).code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns aggregates for an empty org', async () => {
    const org = await makeOrg('Empty Org');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/reports/summary',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      recoveredByWeek: unknown[];
      denialReasons: unknown[];
      claimAging: { bucket: string; count: number }[];
      payerOutcomes: unknown[];
      callVolume: unknown[];
    }>();
    expect(body.recoveredByWeek).toEqual([]);
    expect(body.denialReasons).toEqual([]);
    expect(body.claimAging).toHaveLength(5);
    expect(body.claimAging.every((b) => b.count === 0)).toBe(true);
    expect(body.payerOutcomes).toEqual([]);
    expect(body.callVolume).toEqual([]);
  });

  it('aggregates resolved claims by week', async () => {
    const org = await makeOrg('ResolvedOrg');
    const _claim1 = await prisma.claim.create({
      data: {
        organizationId: org.id,
        patientDOBHash: 'hash_a',
        claimNumber: 'CL-RESOLVED-1',
        cdtCodes: ['D2740'],
        claimAmount: '100.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-01-15T00:00:00Z'),
        status: 'RESOLVED',
        priority: 80,
      },
    });

    const _claim2 = await prisma.claim.create({
      data: {
        organizationId: org.id,
        patientDOBHash: 'hash_b',
        claimNumber: 'CL-RESOLVED-2',
        cdtCodes: ['D2740'],
        claimAmount: '200.00',
        payerCode: 'CIGNA_DENTAL',
        serviceDate: new Date('2026-01-15T00:00:00Z'),
        status: 'RESOLVED',
        priority: 80,
      },
    });

    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/reports/summary',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      recoveredByWeek: { weekStart: string; recoveredCents: number; claimCount: number }[];
    }>();
    expect(body.recoveredByWeek.length).toBeGreaterThan(0);
    const totalRecovered = body.recoveredByWeek.reduce((sum, w) => sum + w.recoveredCents, 0);
    const totalClaims = body.recoveredByWeek.reduce((sum, w) => sum + w.claimCount, 0);
    expect(totalRecovered).toBe(30000); // 100 + 200 dollars = 30000 cents
    expect(totalClaims).toBe(2);
  });

  it('breaks down denial reasons', async () => {
    const org = await makeOrg('DenialOrg');
    const call1 = await prisma.call.create({
      data: {
        organizationId: org.id,
        claimId: (
          await prisma.claim.create({
            data: {
              organizationId: org.id,
              patientDOBHash: 'h1',
              claimNumber: 'CL-DENIAL-1',
              cdtCodes: ['D2740'],
              claimAmount: '100.00',
              payerCode: 'DELTA_DENTAL_PPO',
              serviceDate: new Date(),
              status: 'DENIED',
              priority: 80,
            },
          })
        ).id,
        retellCallId: 'rcid_denial_1',
        status: 'COMPLETED',
        attemptNumber: 1,
      },
    });

    await prisma.callSummary.create({
      data: {
        organizationId: org.id,
        callId: call1.id,
        claimStatus: 'DENIED',
        denialCode: 'CODE_100',
        denialReason: 'Not a covered service',
        nextAction: 'APPEAL',
        rawTranscript: 'test',
        claudeSummary: 'test',
      },
    });

    const call2 = await prisma.call.create({
      data: {
        organizationId: org.id,
        claimId: (
          await prisma.claim.create({
            data: {
              organizationId: org.id,
              patientDOBHash: 'h2',
              claimNumber: 'CL-DENIAL-2',
              cdtCodes: ['D2740'],
              claimAmount: '100.00',
              payerCode: 'DELTA_DENTAL_PPO',
              serviceDate: new Date(),
              status: 'DENIED',
              priority: 80,
            },
          })
        ).id,
        retellCallId: 'rcid_denial_2',
        status: 'COMPLETED',
        attemptNumber: 1,
      },
    });

    await prisma.callSummary.create({
      data: {
        organizationId: org.id,
        callId: call2.id,
        claimStatus: 'DENIED',
        denialCode: 'CODE_100',
        denialReason: 'Not a covered service',
        nextAction: 'APPEAL',
        rawTranscript: 'test',
        claudeSummary: 'test',
      },
    });

    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/reports/summary',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      denialReasons: { code: string; label: string; count: number }[];
    }>();
    expect(body.denialReasons).toHaveLength(1);
    expect(body.denialReasons[0]).toMatchObject({
      code: 'CODE_100',
      label: 'Not a covered service',
      count: 2,
    });
  });

  it('does not leak data across organizations (cross-org isolation)', async () => {
    const orgA = await makeOrg('OrgA');
    const orgB = await makeOrg('OrgB');

    await prisma.claim.create({
      data: {
        organizationId: orgA.id,
        patientDOBHash: 'h_a',
        claimNumber: 'CL-A-1',
        cdtCodes: ['D2740'],
        claimAmount: '500.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date(),
        status: 'RESOLVED',
        priority: 80,
      },
    });

    await prisma.claim.create({
      data: {
        organizationId: orgB.id,
        patientDOBHash: 'h_b',
        claimNumber: 'CL-B-1',
        cdtCodes: ['D2740'],
        claimAmount: '100.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date(),
        status: 'RESOLVED',
        priority: 80,
      },
    });

    const responseA = await server.inject({
      method: 'GET',
      url: '/v1/reports/summary',
      headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': orgA.id },
    });

    const responseB = await server.inject({
      method: 'GET',
      url: '/v1/reports/summary',
      headers: { 'x-test-user-id': 'user_b', 'x-test-org-id': orgB.id },
    });

    const bodyA = responseA.json<{
      recoveredByWeek: { recoveredCents: number }[];
    }>();
    const bodyB = responseB.json<{
      recoveredByWeek: { recoveredCents: number }[];
    }>();

    const totalA = bodyA.recoveredByWeek.reduce((sum, w) => sum + w.recoveredCents, 0);
    const totalB = bodyB.recoveredByWeek.reduce((sum, w) => sum + w.recoveredCents, 0);

    expect(totalA).toBe(50000); // orgA only
    expect(totalB).toBe(10000); // orgB only
    expect(totalA).not.toBe(totalB);
  });
});
