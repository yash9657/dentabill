import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../app.js';

/**
 * Auth plugin gate tests, no Clerk keys path.
 *
 * Two contracts are exercised:
 *
 *   - `requireAuth` (used by `/v1/me` and every org-scoped route)
 *     resolves the DentaBill `User` row from `clerkUserId`. A missing
 *     session returns 401; a session that does not yet have a
 *     matching `User` row returns 403 (FORBIDDEN — onboarding gap).
 *   - The `x-test-org-id` header is the integration-test bypass for
 *     routes whose handlers don't themselves touch the DB. When both
 *     headers are present and a real `User` row exists, the request
 *     succeeds.
 */
describe('auth plugin (no Clerk keys path)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
  });

  afterEach(async () => {
    await server.close();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  it('reports hasClerkKeys=false when no keys are configured', () => {
    expect(server.auth.hasClerkKeys).toBe(false);
  });

  it('returns 401 with AUTHENTICATION_REQUIRED on a protected route without test headers', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/me' });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ code?: string }>();
    expect(body.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns 403 FORBIDDEN when the Clerk session has no matching DentaBill user row', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-test-user-id': 'user_test_auth_no_record' },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ code?: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('returns the seeded user + organization when a real DentaBill row exists', async () => {
    const org = await prisma.organization.create({
      data: { clerkOrgId: 'org_test_auth_seed', name: 'Auth Test Practice' },
    });
    await prisma.user.create({
      data: {
        clerkUserId: 'user_test_auth_seeded',
        organizationId: org.id,
        email: 'auth-test@dentabill.example',
        role: 'ADMIN',
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-test-user-id': 'user_test_auth_seeded' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ user: { email: string }; organization: { name: string } }>();
    expect(body.organization.name).toBe('Auth Test Practice');
    expect(body.user.email).toBe('auth-test@dentabill.example');
  });

  it('rejects when an empty test header value is supplied', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-test-user-id': '' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('leaves /healthz public and unprotected', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/healthz' });
    expect(response.statusCode).toBe(200);
  });
});
