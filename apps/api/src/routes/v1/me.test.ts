import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

interface ApiErrorBody {
  error: true;
  message: string;
  code: string;
}

interface MeOrganization {
  id: string;
  name: string;
  npi: string | null;
  plan: string;
}

// Helper-less body extraction — tests cast to the expected wire shape
// at the call site so each assertion documents what it expects.

async function seedOrgAndUser(role: 'OWNER' | 'ADMIN' | 'BILLING_STAFF'): Promise<{
  orgId: string;
  clerkUserId: string;
}> {
  const org = await prisma.organization.create({
    data: {
      name: 'Acme Dental',
      clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}`,
      npi: '1234567890',
    },
  });
  const clerkUserId = `user_${Math.random().toString(36).slice(2)}`;
  await prisma.user.create({
    data: {
      clerkUserId,
      organizationId: org.id,
      role,
      email: `${clerkUserId}@test.local`,
      name: `Test ${role}`,
    },
  });
  return { orgId: org.id, clerkUserId };
}

describe('PATCH /v1/me/organization', () => {
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
      'TRUNCATE TABLE "Organization", "User", "AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  it('rejects unauthenticated callers with 401', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/me/organization',
      payload: { npi: '9999999999' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('OWNER can update NPI; persists value and writes an audit log entry', async () => {
    const { orgId, clerkUserId } = await seedOrgAndUser('OWNER');
    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/me/organization',
      headers: { 'x-test-user-id': clerkUserId },
      payload: { npi: '9876543210' },
    });
    expect(response.statusCode).toBe(200);
    const body: MeOrganization = response.json();
    expect(body.npi).toBe('9876543210');

    const fresh = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(fresh?.npi).toBe('9876543210');

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: orgId, resourceType: 'Organization' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('organization.update');
    const meta = audits[0]!.metadata as { changedFields?: unknown };
    expect(meta.changedFields).toEqual(['npi']);
  });

  it('ADMIN can update; BILLING_STAFF cannot (403 FORBIDDEN)', async () => {
    const admin = await seedOrgAndUser('ADMIN');
    const adminResponse = await server.inject({
      method: 'PATCH',
      url: '/v1/me/organization',
      headers: { 'x-test-user-id': admin.clerkUserId },
      payload: { name: 'Renamed Practice' },
    });
    expect(adminResponse.statusCode).toBe(200);

    const staff = await seedOrgAndUser('BILLING_STAFF');
    const staffResponse = await server.inject({
      method: 'PATCH',
      url: '/v1/me/organization',
      headers: { 'x-test-user-id': staff.clerkUserId },
      payload: { name: 'Should Not Land' },
    });
    expect(staffResponse.statusCode).toBe(403);
    const errBody: ApiErrorBody = staffResponse.json();
    expect(errBody.code).toBe('FORBIDDEN');
  });

  it('rejects malformed NPI with 400 VALIDATION_ERROR', async () => {
    const { clerkUserId } = await seedOrgAndUser('OWNER');
    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/me/organization',
      headers: { 'x-test-user-id': clerkUserId },
      payload: { npi: '12345' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('accepts empty string npi as "clear" — writes null to DB', async () => {
    const { orgId, clerkUserId } = await seedOrgAndUser('OWNER');
    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/me/organization',
      headers: { 'x-test-user-id': clerkUserId },
      payload: { npi: '' },
    });
    expect(response.statusCode).toBe(200);
    const fresh = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(fresh?.npi).toBeNull();
  });

  it('rejects an empty body (must update at least one field)', async () => {
    const { clerkUserId } = await seedOrgAndUser('OWNER');
    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/me/organization',
      headers: { 'x-test-user-id': clerkUserId },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});
