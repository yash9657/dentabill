/**
 * Billing API integration tests (P4-T3D).
 *
 * Covers /v1/billing/usage (read-side), /v1/billing/portal
 * (control-plane), and /v1/webhooks/stripe (signature verification
 * stub). Cross-tenant isolation is asserted explicitly because the
 * billing surface is the highest-blast-radius piece of Phase 4 — a
 * leak here means org A sees org B's usage charges.
 */
import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

interface ApiErrorBody {
  error: true;
  message: string;
  code: string;
}

interface BillingUsageItem {
  id: string;
  claimId: string;
  billingPeriodStart: string;
  amountCents: number;
  stripeUsageRecordId: string | null;
  postedAt: string | null;
  createdAt: string;
}

interface BillingUsageBody {
  currentMonthCents: number;
  last90DaysCents: number;
  items: BillingUsageItem[];
}

interface BillingPortalBody {
  url: string;
}

async function seedOrgAndUser(
  role: 'OWNER' | 'ADMIN' | 'BILLING_STAFF',
  opts: { stripeCustomerId?: string | null } = {},
): Promise<{ orgId: string; userId: string }> {
  const slug = Math.random().toString(36).slice(2);
  const org = await prisma.organization.create({
    data: {
      name: `Org ${slug}`,
      clerkOrgId: `clerk_${slug}`,
      ...(opts.stripeCustomerId !== undefined ? { stripeCustomerId: opts.stripeCustomerId } : {}),
    },
  });
  const user = await prisma.user.create({
    data: {
      clerkUserId: `user_${slug}`,
      organizationId: org.id,
      role,
      email: `${slug}@test.local`,
      name: `Test ${role}`,
    },
  });
  return { orgId: org.id, userId: user.id };
}

async function seedClaim(orgId: string): Promise<string> {
  const slug = Math.random().toString(36).slice(2);
  const claim = await prisma.claim.create({
    data: {
      organizationId: orgId,
      patientDOBHash: `hash_${slug}`,
      patientDOBLast4: '1990',
      claimNumber: `CL-${slug}`,
      cdtCodes: ['D2740'],
      claimAmount: '420.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date(),
      status: 'COMPLETED',
      priority: 80,
    },
  });
  return claim.id;
}

async function seedUsage(
  orgId: string,
  claimId: string,
  billingPeriodStart: Date,
  amountCents: number,
): Promise<void> {
  await prisma.billingUsageRecord.create({
    data: {
      organizationId: orgId,
      claimId,
      billingPeriodStart,
      amountCents,
      idempotencyKey: `claim.${claimId}.${billingPeriodStart.toISOString()}`,
    },
  });
}

describe('Billing API', () => {
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
      'TRUNCATE TABLE "Organization", "User", "Claim", "BillingUsageRecord", "AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  describe('GET /v1/billing/usage', () => {
    it('rejects unauthenticated callers with 401', async () => {
      const response = await server.inject({ method: 'GET', url: '/v1/billing/usage' });
      expect(response.statusCode).toBe(401);
    });

    it('returns aggregates for the calling org and writes an audit row', async () => {
      const { orgId, userId } = await seedOrgAndUser('OWNER');
      const claimId = await seedClaim(orgId);
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const earlier = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      await seedUsage(orgId, claimId, monthStart, 1000);
      await seedUsage(orgId, claimId, earlier, 2500);

      const response = await server.inject({
        method: 'GET',
        url: '/v1/billing/usage',
        headers: { 'x-test-user-id': userId, 'x-test-org-id': orgId },
      });
      expect(response.statusCode).toBe(200);
      const body: BillingUsageBody = response.json();
      expect(body.currentMonthCents).toBe(1000);
      expect(body.last90DaysCents).toBe(3500);
      expect(body.items).toHaveLength(2);

      const audits = await prisma.auditLog.findMany({
        where: { organizationId: orgId, action: 'billing.usage.read' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]!.userId).toBe(userId);
    });

    it('cannot see another org’s usage records (cross-tenant isolation)', async () => {
      const a = await seedOrgAndUser('OWNER');
      const b = await seedOrgAndUser('OWNER');
      const claimB = await seedClaim(b.orgId);
      await seedUsage(b.orgId, claimB, new Date(), 9999);

      const response = await server.inject({
        method: 'GET',
        url: '/v1/billing/usage',
        headers: { 'x-test-user-id': a.userId, 'x-test-org-id': a.orgId },
      });
      expect(response.statusCode).toBe(200);
      const body: BillingUsageBody = response.json();
      expect(body.items).toHaveLength(0);
      expect(body.currentMonthCents).toBe(0);
      expect(body.last90DaysCents).toBe(0);
    });

    it('only counts records inside the 90-day window', async () => {
      const { orgId, userId } = await seedOrgAndUser('OWNER');
      const claimId = await seedClaim(orgId);
      const now = new Date();
      const recent = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const ancient = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000);
      await seedUsage(orgId, claimId, recent, 1000);
      await seedUsage(orgId, claimId, ancient, 5000);

      const response = await server.inject({
        method: 'GET',
        url: '/v1/billing/usage',
        headers: { 'x-test-user-id': userId, 'x-test-org-id': orgId },
      });
      expect(response.statusCode).toBe(200);
      const body: BillingUsageBody = response.json();
      expect(body.last90DaysCents).toBe(1000);
      expect(body.items).toHaveLength(1);
    });
  });

  describe('POST /v1/billing/portal', () => {
    it('rejects unauthenticated callers with 401', async () => {
      const response = await server.inject({ method: 'POST', url: '/v1/billing/portal' });
      expect(response.statusCode).toBe(401);
    });

    it('returns 404 NOT_FOUND when no Stripe customer is associated', async () => {
      const { orgId, userId } = await seedOrgAndUser('OWNER', { stripeCustomerId: null });
      const response = await server.inject({
        method: 'POST',
        url: '/v1/billing/portal',
        headers: { 'x-test-user-id': userId, 'x-test-org-id': orgId },
      });
      expect(response.statusCode).toBe(404);
      const body: ApiErrorBody = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });

    it('OWNER receives a stub URL and an audit row is written', async () => {
      const { orgId, userId } = await seedOrgAndUser('OWNER', {
        stripeCustomerId: 'cus_test_123',
      });
      const response = await server.inject({
        method: 'POST',
        url: '/v1/billing/portal',
        headers: { 'x-test-user-id': userId, 'x-test-org-id': orgId },
      });
      expect(response.statusCode).toBe(200);
      const body: BillingPortalBody = response.json();
      expect(body.url).toBe('https://billing.stripe.com/p/session_stub_cus_test_123');

      const audits = await prisma.auditLog.findMany({
        where: { organizationId: orgId, action: 'billing.portal.opened' },
      });
      expect(audits).toHaveLength(1);
      const meta = audits[0]!.metadata as { stub?: boolean };
      expect(meta.stub).toBe(true);
    });

    it('BILLING_STAFF cannot open the portal (403 FORBIDDEN)', async () => {
      const { orgId, userId } = await seedOrgAndUser('BILLING_STAFF', {
        stripeCustomerId: 'cus_test_456',
      });
      const response = await server.inject({
        method: 'POST',
        url: '/v1/billing/portal',
        headers: { 'x-test-user-id': userId, 'x-test-org-id': orgId },
      });
      expect(response.statusCode).toBe(403);
      const body: ApiErrorBody = response.json();
      expect(body.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /v1/webhooks/stripe', () => {
    it('rejects requests without a Stripe-Signature header (400)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        payload: { id: 'evt_test_1', type: 'invoice.payment_succeeded' },
      });
      expect(response.statusCode).toBe(400);
      const body: ApiErrorBody = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects malformed signatures with 403', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: { 'stripe-signature': 'garbage' },
        payload: { id: 'evt_test_2', type: 'invoice.payment_succeeded' },
      });
      expect(response.statusCode).toBe(403);
      const body: ApiErrorBody = response.json();
      expect(body.code).toBe('FORBIDDEN');
    });

    it('accepts a structurally well-formed Stripe-Signature header (200)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: { 'stripe-signature': 't=1714900000,v1=deadbeefcafef00d' },
        payload: { id: 'evt_test_3', type: 'invoice.payment_succeeded' },
      });
      expect(response.statusCode).toBe(200);
      const body: { received: boolean } = response.json();
      expect(body.received).toBe(true);
    });
  });
});
