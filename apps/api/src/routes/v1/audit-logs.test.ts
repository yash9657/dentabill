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

describe('GET /v1/audit-logs (G-D2a)', () => {
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
      url: '/v1/audit-logs',
    });
    expect(response.statusCode).toBe(401);
    expect(bodyAsError(response).code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns empty list for an org with no audit logs', async () => {
    const org = await makeOrg('Empty Audit Org');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      items: unknown[];
      nextCursor: string | null;
      hasMore: boolean;
    }>();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.hasMore).toBe(false);
  });

  it('returns audit logs in desc createdAt order', async () => {
    const org = await makeOrg('Audit Org');
    const log1 = await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.create',
        resourceType: 'Claim',
        resourceId: 'clm_1',
        createdAt: new Date('2026-01-15T10:00:00Z'),
      },
    });
    const log2 = await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.read',
        resourceType: 'Claim',
        resourceId: 'clm_2',
        createdAt: new Date('2026-01-15T11:00:00Z'),
      },
    });
    const log3 = await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'call.enqueue',
        resourceType: 'Call',
        resourceId: 'call_1',
        createdAt: new Date('2026-01-15T12:00:00Z'),
      },
    });

    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      items: { id: string; action: string }[];
      nextCursor: string | null;
      hasMore: boolean;
    }>();
    expect(body.items.length).toBe(3);
    expect(body.items[0]!.id).toBe(log3.id);
    expect(body.items[1]!.id).toBe(log2.id);
    expect(body.items[2]!.id).toBe(log1.id);
    expect(body.nextCursor).toBeNull();
    expect(body.hasMore).toBe(false);
  });

  it('paginates with cursor round-trip', async () => {
    const org = await makeOrg('Pagination Org');
    for (let i = 0; i < 3; i += 1) {
      await prisma.auditLog.create({
        data: {
          organizationId: org.id,
          userId: null,
          action: `action_${String(i)}`,
          resourceType: 'Claim',
          resourceId: `clm_${String(i)}`,
        },
      });
    }

    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const page1 = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs?limit=2',
      headers,
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json<{
      items: { id: string }[];
      nextCursor: string | null;
      hasMore: boolean;
    }>();
    expect(body1.items.length).toBe(2);
    expect(body1.hasMore).toBe(true);
    expect(body1.nextCursor).not.toBeNull();

    const cursor = body1.nextCursor!;
    const page2 = await server.inject({
      method: 'GET',
      url: `/v1/audit-logs?limit=2&cursor=${encodeURIComponent(cursor)}`,
      headers,
    });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json<{
      items: { id: string }[];
      nextCursor: string | null;
      hasMore: boolean;
    }>();
    expect(body2.items.length).toBe(1);
    expect(body2.hasMore).toBe(false);
    expect(body2.nextCursor).toBeNull();

    const firstPageIds = body1.items.map((i) => i.id);
    const secondPageIds = body2.items.map((i) => i.id);
    expect(firstPageIds).not.toEqual(expect.arrayContaining(secondPageIds));
  });

  it('filters by resourceType', async () => {
    const org = await makeOrg('Filter Org');
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.create',
        resourceType: 'Claim',
        resourceId: 'clm_1',
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'call.enqueue',
        resourceType: 'Call',
        resourceId: 'call_1',
      },
    });

    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs?resourceType=Call',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      items: { resourceType: string }[];
    }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.resourceType).toBe('Call');
  });

  it('filters by action', async () => {
    const org = await makeOrg('Action Filter Org');
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.create',
        resourceType: 'Claim',
        resourceId: 'clm_1',
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.read',
        resourceType: 'Claim',
        resourceId: 'clm_2',
      },
    });

    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs?action=claim.create',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      items: { action: string }[];
    }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.action).toBe('claim.create');
  });

  // The dashboard's date filters are `<input type="date">`, which emit a bare
  // `YYYY-MM-DD`. An ISO-datetime-only schema rejected those outright, and a
  // naive `lte: new Date('2026-08-21')` anchors to midnight — so filtering to
  // a single day matched nothing. Both regressions are covered here.
  it('accepts bare calendar dates and treats `to` as end-of-day inclusive', async () => {
    const org = await makeOrg('Date Range Org');
    const sameDayNoon = new Date('2026-08-21T12:00:00.000Z');
    const dayAfter = new Date('2026-08-22T09:00:00.000Z');
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.create',
        resourceType: 'Claim',
        resourceId: 'clm_in_range',
        createdAt: sameDayNoon,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.create',
        resourceType: 'Claim',
        resourceId: 'clm_out_of_range',
        createdAt: dayAfter,
      },
    });

    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs?from=2026-08-21&to=2026-08-21',
      headers,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { resourceId: string }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.resourceId).toBe('clm_in_range');
  });

  it('still accepts full ISO datetimes on the range boundaries', async () => {
    const org = await makeOrg('Iso Range Org');
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.create',
        resourceType: 'Claim',
        resourceId: 'clm_iso',
        createdAt: new Date('2026-08-21T12:00:00.000Z'),
      },
    });

    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs?from=2026-08-21T00:00:00.000Z&to=2026-08-21T23:59:59.999Z',
      headers,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { resourceId: string }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.resourceId).toBe('clm_iso');
  });

  it('filters by date range (from/to)', async () => {
    const org = await makeOrg('Date Range Org');
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.create',
        resourceType: 'Claim',
        resourceId: 'clm_1',
        createdAt: new Date('2026-01-15T10:00:00Z'),
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.read',
        resourceType: 'Claim',
        resourceId: 'clm_2',
        createdAt: new Date('2026-01-15T12:00:00Z'),
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'call.enqueue',
        resourceType: 'Call',
        resourceId: 'call_1',
        createdAt: new Date('2026-01-15T14:00:00Z'),
      },
    });

    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs?from=2026-01-15T11:00:00Z&to=2026-01-15T13:00:00Z',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      items: { action: string }[];
    }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.action).toBe('claim.read');
  });

  it('does not leak data across organizations (cross-org isolation)', async () => {
    const orgA = await makeOrg('OrgA');
    const orgB = await makeOrg('OrgB');

    await prisma.auditLog.create({
      data: {
        organizationId: orgA.id,
        userId: null,
        action: 'claim.create',
        resourceType: 'Claim',
        resourceId: 'clm_a_1',
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: orgB.id,
        userId: null,
        action: 'claim.create',
        resourceType: 'Claim',
        resourceId: 'clm_b_1',
      },
    });

    const responseA = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs',
      headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': orgA.id },
    });

    const responseB = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs',
      headers: { 'x-test-user-id': 'user_b', 'x-test-org-id': orgB.id },
    });

    const bodyA = responseA.json<{
      items: { resourceId: string }[];
    }>();
    const bodyB = responseB.json<{
      items: { resourceId: string }[];
    }>();

    expect(bodyA.items).toHaveLength(1);
    expect(bodyB.items).toHaveLength(1);
    expect(bodyA.items[0]!.resourceId).toBe('clm_a_1');
    expect(bodyB.items[0]!.resourceId).toBe('clm_b_1');
  });

  it('returns metadata as-is in response', async () => {
    const org = await makeOrg('Metadata Org');
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: null,
        action: 'claim.create',
        resourceType: 'Claim',
        resourceId: 'clm_1',
        metadata: { clerkUserId: 'clerk_user_123', count: 5 },
      },
    });

    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const response = await server.inject({
      method: 'GET',
      url: '/v1/audit-logs',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      items: { metadata: Record<string, unknown> }[];
    }>();
    expect(body.items[0]!.metadata).toEqual({
      clerkUserId: 'clerk_user_123',
      count: 5,
    });
  });
});
