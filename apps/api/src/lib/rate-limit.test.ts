import { randomUUID } from 'node:crypto';

import { prisma } from '@dentabill/db';
import { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { buildServer } from '../app.js';

import { initEnv } from './env.js';

beforeAll(() => {
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  initEnv();
});

describe('Rate limiting', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer({ logger: false });

    // Register a test route
    server.get('/test/ping', () => {
      return { ok: true };
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it('allows requests within the limit', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBeDefined();
  });

  it('blocks requests over the limit with 429', async () => {
    // The default limit is 300 requests per minute.
    // We'll send 301 rapid requests from the same IP.
    const responses: number[] = [];

    for (let i = 0; i < 301; i++) {
      const response = await server.inject({
        method: 'GET',
        url: '/test/ping',
      });
      responses.push(response.statusCode);
    }

    // Expect that at least one request hits the rate limit (429)
    const hasRateLimit = responses.some((status) => status === 429);
    expect(hasRateLimit).toBe(true);
  });
});

const tenantLimitedRoutes = [
  {
    method: 'PATCH',
    url: '/v1/me/organization',
    payload: { name: 'Synthetic rate-limit practice' },
    allowedStatus: 200,
  },
  {
    method: 'POST',
    url: '/v1/claims/00000000-0000-4000-8000-000000000001/calls',
    payload: {},
    allowedStatus: 404,
  },
] as const;

async function seedPractice(): Promise<{
  organizationId: string;
  ownerClerkId: string;
  adminClerkId: string;
}> {
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic practice', clerkOrgId: `org_rate_limit_${randomUUID()}` },
  });
  const ownerClerkId = `user_rate_limit_${randomUUID()}`;
  const adminClerkId = `user_rate_limit_${randomUUID()}`;
  await prisma.user.createMany({
    data: [
      {
        organizationId: organization.id,
        clerkUserId: ownerClerkId,
        email: `${ownerClerkId}@example.test`,
        role: 'OWNER',
      },
      {
        organizationId: organization.id,
        clerkUserId: adminClerkId,
        email: `${adminClerkId}@example.test`,
        role: 'ADMIN',
      },
    ],
  });
  return { organizationId: organization.id, ownerClerkId, adminClerkId };
}

describe('Authenticated tenant rate limits', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    // Each case must start with a fresh in-memory rate-limit store.
    server = await buildServer({ logger: false });
  });

  afterEach(async () => {
    await server.close();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(tenantLimitedRoutes)(
    '$method $url rejects anonymous traffic before it can consume authenticated quota',
    async ({ method, url, payload, allowedStatus }) => {
      const practice = await seedPractice();

      // With the limiter onRequest, the eleventh anonymous request gets 429,
      // and a signed-in practice is then denied by the same route-wide "anon" key.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const denied = await server.inject({ method, url, payload });
        expect(denied.statusCode).toBe(401);
      }

      const authenticated = await server.inject({
        method,
        url,
        payload,
        // No organization override: requireAuth resolves this user's practice from Postgres.
        headers: { 'x-test-user-id': practice.ownerClerkId },
      });
      expect(authenticated.statusCode).toBe(allowedStatus);
      expect(authenticated.headers['x-ratelimit-limit']).toBe('10');
      expect(authenticated.headers['x-ratelimit-remaining']).toBe('9');
    },
  );

  it.each(tenantLimitedRoutes)(
    '$method $url shares ten requests across practice users and IPs while isolating other practices',
    async ({ method, url, payload, allowedStatus }) => {
      const a = await seedPractice();
      const b = await seedPractice();

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const allowed = await server.inject({
          method,
          url,
          payload,
          headers: {
            'x-test-user-id': attempt % 2 === 0 ? a.ownerClerkId : a.adminClerkId,
          },
          remoteAddress: attempt % 2 === 0 ? '192.0.2.1' : '192.0.2.2',
        });
        expect(allowed.statusCode).toBe(allowedStatus);
        expect(allowed.headers['x-ratelimit-remaining']).toBe(String(9 - attempt));
      }

      const exhausted = await server.inject({
        method,
        url,
        payload: method === 'PATCH' ? { name: 'This must not persist' } : payload,
        headers: { 'x-test-user-id': a.adminClerkId },
        remoteAddress: '192.0.2.3',
      });
      expect(exhausted.statusCode).toBe(429);
      expect(exhausted.headers['x-ratelimit-remaining']).toBe('0');
      expect(exhausted.headers['retry-after']).toBeDefined();

      // A different practice behind the same IP retains its own full quota.
      const otherPractice = await server.inject({
        method,
        url,
        payload,
        headers: { 'x-test-user-id': b.ownerClerkId },
        remoteAddress: '192.0.2.1',
      });
      expect(otherPractice.statusCode).toBe(allowedStatus);
      expect(otherPractice.headers['x-ratelimit-remaining']).toBe('9');

      if (method === 'PATCH') {
        expect(
          await prisma.organization.findUnique({ where: { id: a.organizationId } }),
        ).toMatchObject({ name: 'Synthetic rate-limit practice' });
        expect(
          await prisma.auditLog.count({
            where: { organizationId: a.organizationId, action: 'organization.update' },
          }),
        ).toBe(10);
      } else {
        // Missing claims exercise the actual authenticated route without placing calls.
        expect(await prisma.callIntent.count()).toBe(0);
        expect(await prisma.jobOutbox.count()).toBe(0);
      }
    },
  );
});
