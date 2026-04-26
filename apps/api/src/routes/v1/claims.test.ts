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
    const listBody = list.json<{
      items: { id: string }[];
      nextCursor: string | null;
      hasMore: boolean;
    }>();
    expect(listBody.items.map((c) => c.id)).toContain(createdBody.id);
    expect(listBody.hasMore).toBe(false);
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
    const aIds = aListsOnlyA.json<{ items: { id: string }[] }>().items.map((c) => c.id);
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

  it('paginates the list with cursor + limit and walks every page', async () => {
    const org = await makeOrg('Paged');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };

    // Seed 7 claims; we'll page in chunks of 3.
    for (let i = 0; i < 7; i++) {
      const res = await server.inject({
        method: 'POST',
        url: '/v1/claims',
        headers,
        payload: { ...VALID_CLAIM, claimNumber: `CL-PAGE-${String(i)}` },
      });
      expect(res.statusCode).toBe(201);
    }

    interface Page {
      items: { id: string }[];
      nextCursor: string | null;
    }
    const seen: string[] = [];
    const fetchPage = async (cursor: string | null): Promise<Page> => {
      const url = `/v1/claims?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = await server.inject({ method: 'GET', url, headers });
      expect(response.statusCode).toBe(200);
      return response.json<Page>();
    };

    let next: string | null = null;
    for (let safety = 0; safety < 5; safety++) {
      const body: Page = await fetchPage(next);
      seen.push(...body.items.map((c) => c.id));
      next = body.nextCursor;
      if (next === null) break;
    }
    expect(seen.length).toBe(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('filters by status and payer', async () => {
    const org = await makeOrg('Filtered');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };

    await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: { ...VALID_CLAIM, claimNumber: 'CL-DELTA', payerCode: 'DELTA_DENTAL_PPO' },
    });
    await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: { ...VALID_CLAIM, claimNumber: 'CL-CIGNA', payerCode: 'CIGNA_DENTAL' },
    });

    const cignaOnly = await server.inject({
      method: 'GET',
      url: '/v1/claims?payer=CIGNA_DENTAL',
      headers,
    });
    expect(cignaOnly.statusCode).toBe(200);
    const cignaBody = cignaOnly.json<{ items: { claimNumber: string }[] }>();
    expect(cignaBody.items.map((c) => c.claimNumber)).toEqual(['CL-CIGNA']);

    const deltaOnly = await server.inject({
      method: 'GET',
      url: '/v1/claims?payer=DELTA_DENTAL_PPO&status=PENDING',
      headers,
    });
    const deltaBody = deltaOnly.json<{ items: { claimNumber: string }[] }>();
    expect(deltaBody.items.map((c) => c.claimNumber)).toEqual(['CL-DELTA']);
  });

  it('searches by claimNumber substring (case-insensitive)', async () => {
    const org = await makeOrg('Searched');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };

    await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: { ...VALID_CLAIM, claimNumber: 'CL-FOO-001' },
    });
    await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: { ...VALID_CLAIM, claimNumber: 'CL-BAR-002' },
    });

    const hits = await server.inject({
      method: 'GET',
      url: '/v1/claims?search=foo',
      headers,
    });
    expect(hits.statusCode).toBe(200);
    const body = hits.json<{ items: { claimNumber: string }[] }>();
    expect(body.items.map((c) => c.claimNumber)).toEqual(['CL-FOO-001']);
  });

  it('sorts by priority asc / desc', async () => {
    const org = await makeOrg('Sorted');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };

    for (const [i, prio] of [10, 30, 20].entries()) {
      const created = await server.inject({
        method: 'POST',
        url: '/v1/claims',
        headers,
        payload: { ...VALID_CLAIM, claimNumber: `CL-SORT-${String(i)}` },
      });
      const { id } = created.json<{ id: string }>();
      await server.inject({
        method: 'PATCH',
        url: `/v1/claims/${id}`,
        headers,
        payload: { priority: prio },
      });
    }

    const desc = await server.inject({
      method: 'GET',
      url: '/v1/claims?sort=priority&dir=desc',
      headers,
    });
    const descBody = desc.json<{ items: { priority: number }[] }>();
    expect(descBody.items.map((c) => c.priority)).toEqual([30, 20, 10]);

    const asc = await server.inject({
      method: 'GET',
      url: '/v1/claims?sort=priority&dir=asc',
      headers,
    });
    const ascBody = asc.json<{ items: { priority: number }[] }>();
    expect(ascBody.items.map((c) => c.priority)).toEqual([10, 20, 30]);
  });

  it('rejects malformed cursors with a 400 VALIDATION_ERROR', async () => {
    const org = await makeOrg('CursorBroken');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/claims?cursor=not-base64-encoded-properly%21',
      headers,
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code?: string }>();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects illegal state-machine jumps with 409 INVALID_STATE_TRANSITION', async () => {
    const org = await makeOrg('StateJump');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };

    const created = await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: VALID_CLAIM,
    });
    const { id } = created.json<{ id: string }>();

    // PENDING -> CALLING is not allowed (must go through IN_QUEUE).
    const skipped = await server.inject({
      method: 'PATCH',
      url: `/v1/claims/${id}`,
      headers,
      payload: { status: 'CALLING' },
    });
    expect(skipped.statusCode).toBe(409);
    const skipBody = skipped.json<{ code?: string; message?: string }>();
    expect(skipBody.code).toBe('INVALID_STATE_TRANSITION');
    expect(skipBody.message).toContain('PENDING');
    expect(skipBody.message).toContain('CALLING');
  });

  it('blocks transitions out of terminal states (RESOLVED, WRITTEN_OFF)', async () => {
    const org = await makeOrg('Terminal');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };

    const created = await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: VALID_CLAIM,
    });
    const { id } = created.json<{ id: string }>();

    // Walk PENDING -> IN_QUEUE -> CALLING -> COMPLETED -> RESOLVED.
    for (const next of ['IN_QUEUE', 'CALLING', 'COMPLETED', 'RESOLVED'] as const) {
      const step = await server.inject({
        method: 'PATCH',
        url: `/v1/claims/${id}`,
        headers,
        payload: { status: next },
      });
      expect(step.statusCode, `transition to ${next}`).toBe(200);
    }

    const reopen = await server.inject({
      method: 'PATCH',
      url: `/v1/claims/${id}`,
      headers,
      payload: { status: 'IN_QUEUE' },
    });
    expect(reopen.statusCode).toBe(409);
    expect(reopen.json<{ code?: string }>().code).toBe('INVALID_STATE_TRANSITION');
  });

  it('allows self-transitions when other fields change', async () => {
    const org = await makeOrg('SelfTransition');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };

    const created = await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: VALID_CLAIM,
    });
    const { id } = created.json<{ id: string }>();

    // Echoing the current status (PENDING) alongside a priority bump
    // should not trip state-machine validation.
    const echo = await server.inject({
      method: 'PATCH',
      url: `/v1/claims/${id}`,
      headers,
      payload: { status: 'PENDING', priority: 75 },
    });
    expect(echo.statusCode).toBe(200);
    expect(echo.json<{ status: string; priority: number }>()).toMatchObject({
      status: 'PENDING',
      priority: 75,
    });
  });
});
