import { prisma } from '@dentabill/db';
import type { Organization } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

/**
 * `/v1/claims` integration tests against real Postgres.
 *
 * The CI `test` job spins a Postgres service container and exports
 * `DATABASE_URL` pointing at it; locally, run `docker compose up -d`
 * first. The suite truncates the multi-tenant tables between tests
 * so cross-test pollution cannot mask a regression.
 *
 * Auth is provided by the test-header bypass from P2-T37: the
 * server reads `x-test-user-id` and `x-test-org-id` instead of
 * verifying a Clerk JWT. Each test seeds its own `Organization`
 * row, then injects `x-test-org-id: <that org's id>`.
 *
 * Cross-org leak coverage: the third test seeds two organizations,
 * creates a claim under each, and asserts that A's session sees
 * only A's claim and cannot fetch B's by id (404).
 */
async function makeOrg(name: string): Promise<Organization> {
  return prisma.organization.create({
    data: { name, clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
  });
}

const VALID_CLAIM = {
  patientDOBHash: 'hash_abc',
  patientDOBLast4: '1990',
  claimNumber: 'CL-INT-1',
  cdtCodes: ['D2740'],
  claimAmount: '420.00',
  payerCode: 'DELTA_DENTAL_PPO',
  serviceDate: '2026-01-15T00:00:00.000Z',
} as const;

describe('/v1/claims (integration, real Postgres)', () => {
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
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  it('rejects unauthenticated POST with 401', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/claims',
      payload: VALID_CLAIM,
    });
    expect(response.statusCode).toBe(401);
  });

  it('creates and reads a claim under the authenticated org', async () => {
    const org = await makeOrg('Acme Dental');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };

    const created = await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: VALID_CLAIM,
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<{ id: string; organizationId: string; claimAmount: string }>();
    expect(createdBody.organizationId).toBe(org.id);
    expect(createdBody.claimAmount).toBe('420');

    const fetched = await server.inject({
      method: 'GET',
      url: `/v1/claims/${createdBody.id}`,
      headers,
    });
    expect(fetched.statusCode).toBe(200);

    const list = await server.inject({ method: 'GET', url: '/v1/claims', headers });
    expect(list.statusCode).toBe(200);
    const listBody = list.json<{ claims: { id: string }[] }>();
    expect(listBody.claims.map((c) => c.id)).toContain(createdBody.id);
  });

  it('writes an AuditLog row on every read', async () => {
    const org = await makeOrg('Acme');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };

    const created = await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: VALID_CLAIM,
    });
    const { id } = created.json<{ id: string }>();

    await server.inject({ method: 'GET', url: `/v1/claims/${id}`, headers });
    await server.inject({ method: 'GET', url: '/v1/claims', headers });

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'asc' },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('claim.read');
    expect(actions).toContain('claim.list');
  });

  it('isolates claims between organizations (cross-org leak guard)', async () => {
    const orgA = await makeOrg('Alpha');
    const orgB = await makeOrg('Bravo');
    const headersA = { 'x-test-user-id': 'user_a', 'x-test-org-id': orgA.id };
    const headersB = { 'x-test-user-id': 'user_b', 'x-test-org-id': orgB.id };

    const claimA = await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: headersA,
      payload: { ...VALID_CLAIM, claimNumber: 'CL-A' },
    });
    const claimB = await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: headersB,
      payload: { ...VALID_CLAIM, claimNumber: 'CL-B' },
    });
    const idA = claimA.json<{ id: string }>().id;
    const idB = claimB.json<{ id: string }>().id;

    const aListsOnlyA = await server.inject({
      method: 'GET',
      url: '/v1/claims',
      headers: headersA,
    });
    const aIds = aListsOnlyA.json<{ claims: { id: string }[] }>().claims.map((c) => c.id);
    expect(aIds).toContain(idA);
    expect(aIds).not.toContain(idB);

    const aReadingB = await server.inject({
      method: 'GET',
      url: `/v1/claims/${idB}`,
      headers: headersA,
    });
    expect(aReadingB.statusCode).toBe(404);

    const aPatchingB = await server.inject({
      method: 'PATCH',
      url: `/v1/claims/${idB}`,
      headers: headersA,
      payload: { status: 'CALLING' },
    });
    expect(aPatchingB.statusCode).toBe(404);

    const aDeletingB = await server.inject({
      method: 'DELETE',
      url: `/v1/claims/${idB}`,
      headers: headersA,
    });
    expect(aDeletingB.statusCode).toBe(404);
  });

  it('patches and deletes a claim within the same org', async () => {
    const org = await makeOrg('Acme');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };

    const created = await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: VALID_CLAIM,
    });
    const { id } = created.json<{ id: string }>();

    const patched = await server.inject({
      method: 'PATCH',
      url: `/v1/claims/${id}`,
      headers,
      payload: { status: 'IN_QUEUE', priority: 50 },
    });
    expect(patched.statusCode).toBe(200);
    const patchedBody = patched.json<{ status: string; priority: number }>();
    expect(patchedBody.status).toBe('IN_QUEUE');
    expect(patchedBody.priority).toBe(50);

    const deleted = await server.inject({
      method: 'DELETE',
      url: `/v1/claims/${id}`,
      headers,
    });
    expect(deleted.statusCode).toBe(204);

    const refetched = await server.inject({ method: 'GET', url: `/v1/claims/${id}`, headers });
    expect(refetched.statusCode).toBe(404);
  });
});
