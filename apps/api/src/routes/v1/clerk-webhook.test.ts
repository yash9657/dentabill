/**
 * Integration tests for POST /v1/webhooks/clerk (P4-T4).
 */
import { createHmac } from 'crypto';

import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

const RAW_SECRET = Buffer.from('clerk-test-webhook-secret-1234567').toString('base64');
const FULL_SECRET = `whsec_${RAW_SECRET}`;

function signBody(svixId: string, timestamp: string, body: Buffer): string {
  const decoded = Buffer.from(RAW_SECRET, 'base64');
  const signed = Buffer.concat([Buffer.from(`${svixId}.${timestamp}.`, 'utf8'), body]);
  return `v1,${createHmac('sha256', decoded).update(signed).digest('base64')}`;
}

interface ApiErrorBody {
  error: true;
  message: string;
  code: string;
}

async function seedOrgAndUser(
  clerkOrgId: string,
): Promise<{ orgId: string; userId: string; clerkUserId: string }> {
  const slug = Math.random().toString(36).slice(2);
  const org = await prisma.organization.create({
    data: { name: `Org ${slug}`, clerkOrgId },
  });
  const user = await prisma.user.create({
    data: {
      clerkUserId: `user_${slug}`,
      organizationId: org.id,
      role: 'OWNER',
      email: `${slug}@test.local`,
      name: 'Test',
    },
  });
  return { orgId: org.id, userId: user.id, clerkUserId: user.clerkUserId };
}

describe('POST /v1/webhooks/clerk', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.CLERK_WEBHOOK_SECRET = FULL_SECRET;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });

  afterAll(async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    await server.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "AuditLog", "RetellWebhookEvent" RESTART IDENTITY CASCADE',
    );
  });

  afterEach(async () => {
    // double-clean to avoid cross-test contamination
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "AuditLog", "RetellWebhookEvent" RESTART IDENTITY CASCADE',
    );
  });

  it('rejects when Svix headers are missing (signature_invalid)', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/clerk',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'organization.deleted', data: { id: 'org_x' } },
    });
    expect(response.statusCode).toBe(401);
    const body: ApiErrorBody = response.json();
    expect(body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('rejects a tampered body with signature_invalid', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const realBody = Buffer.from(
      JSON.stringify({ type: 'organization.deleted', data: { id: 'org_x' } }),
      'utf8',
    );
    const sig = signBody('evt_1', ts, realBody);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/clerk',
      headers: {
        'content-type': 'application/json',
        'svix-id': 'evt_1',
        'svix-timestamp': ts,
        'svix-signature': sig,
      },
      payload: { type: 'organization.deleted', data: { id: 'org_other' } },
    });
    expect(response.statusCode).toBe(401);
  });

  it('audit-logs an organizationMembership.deleted event for a known user', async () => {
    const { orgId, userId, clerkUserId } = await seedOrgAndUser('org_real_clerk_123');
    const ts = String(Math.floor(Date.now() / 1000));
    const payload = {
      type: 'organizationMembership.deleted',
      data: {
        public_user_data: { user_id: clerkUserId },
        organization: { id: 'org_real_clerk_123' },
      },
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = signBody('evt_member_1', ts, body);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/clerk',
      headers: {
        'content-type': 'application/json',
        'svix-id': 'evt_member_1',
        'svix-timestamp': ts,
        'svix-signature': sig,
      },
      payload,
    });
    expect(response.statusCode).toBe(200);

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: orgId, action: 'clerk.membership.deleted' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.userId).toBe(userId);
  });

  it('audit-logs an organization.deleted event for a known org', async () => {
    const { orgId } = await seedOrgAndUser('org_real_clerk_456');
    const ts = String(Math.floor(Date.now() / 1000));
    const payload = { type: 'organization.deleted', data: { id: 'org_real_clerk_456' } };
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = signBody('evt_org_1', ts, body);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/clerk',
      headers: {
        'content-type': 'application/json',
        'svix-id': 'evt_org_1',
        'svix-timestamp': ts,
        'svix-signature': sig,
      },
      payload,
    });
    expect(response.statusCode).toBe(200);

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: orgId, action: 'clerk.organization.deleted' },
    });
    expect(audits).toHaveLength(1);
  });

  it('replay protection: duplicate svix-id returns 200 with replayed:true and skips side-effects', async () => {
    const { orgId } = await seedOrgAndUser('org_real_clerk_789');
    const ts = String(Math.floor(Date.now() / 1000));
    const payload = { type: 'organization.deleted', data: { id: 'org_real_clerk_789' } };
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = signBody('evt_replay_1', ts, body);

    const headers = {
      'content-type': 'application/json',
      'svix-id': 'evt_replay_1',
      'svix-timestamp': ts,
      'svix-signature': sig,
    };

    const first = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/clerk',
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    const firstBody: { ok: boolean; replayed?: boolean } = first.json();
    expect(firstBody.replayed).toBeUndefined();

    const second = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/clerk',
      headers,
      payload,
    });
    expect(second.statusCode).toBe(200);
    const secondBody: { ok: boolean; replayed?: boolean } = second.json();
    expect(secondBody.replayed).toBe(true);

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: orgId, action: 'clerk.organization.deleted' },
    });
    expect(audits).toHaveLength(1);
  });
});
