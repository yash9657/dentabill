import { randomUUID } from 'node:crypto';

import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

async function seed() {
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic observation practice', clerkOrgId: `synthetic_${randomUUID()}` },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization.id,
      patientDOBHash: 'synthetic',
      claimNumber: `synthetic_${randomUUID()}`,
      payerCode: 'CIGNA_DENTAL',
      claimAmount: '100.00',
      serviceDate: new Date('2026-01-01T00:00:00Z'),
      status: 'CALLING',
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: organization.id,
      claimId: claim.id,
      retellCallId: `synthetic_${randomUUID()}`,
      status: 'ON_HOLD',
    },
  });
  const time = new Date('2026-10-13T12:00:00.000Z');
  const intent = await prisma.callIntent.create({
    data: {
      organizationId: organization.id,
      claimId: claim.id,
      callId: call.id,
      idempotencyKey: `synthetic_${randomUUID()}`,
      payerCode: claim.payerCode,
      attemptNumber: 1,
      claimPriority: 50,
      claimVersion: claim.updatedAt,
      state: 'ACCEPTED',
      callDeadlineAt: time,
      nextObservationAt: time,
      stopRequestedAt: time,
      stopAcknowledgedAt: time,
      observationReviewAt: time,
      lastObservedAt: time,
      observationErrorCode: 'STOP_CONFIRMATION_EXPIRED',
      requestPayload: { subscriberId: 'SYNTHETIC-PRIVATE-MEMBER' },
      observationLeaseToken: 'synthetic-private-lease',
    },
  });
  return {
    organization,
    claim,
    call,
    intent,
    time,
    headers: { 'x-test-user-id': 'synthetic-user', 'x-test-org-id': organization.id },
  };
}

const expectedMonitoring = {
  deadlineAt: '2026-10-13T12:00:00.000Z',
  nextObservationAt: '2026-10-13T12:00:00.000Z',
  stopRequestedAt: '2026-10-13T12:00:00.000Z',
  stopAcknowledgedAt: '2026-10-13T12:00:00.000Z',
  reviewRequiredAt: '2026-10-13T12:00:00.000Z',
  lastCheckedAt: '2026-10-13T12:00:00.000Z',
  lastErrorCode: 'STOP_CONFIRMATION_EXPIRED',
};

describe('safe call monitoring projection', () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false, callRecoveryProvider: null });
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it.each(['list', 'detail', 'cancel'] as const)(
    'exposes safe monitoring fields on %s without fabricating terminal status',
    async (route) => {
      const seeded = await seed();
      const response = await server.inject({
        method: route === 'cancel' ? 'POST' : 'GET',
        url:
          route === 'list'
            ? '/v1/calls'
            : `/v1/calls/${seeded.call.id}${route === 'cancel' ? '/cancel' : ''}`,
        headers: seeded.headers,
      });
      expect(response.statusCode).toBe(200);
      const result = response.json<{ items?: unknown[] }>();
      expect(route === 'list' ? result.items?.[0] : result).toMatchObject({
        status: 'ON_HOLD',
        endedAt: null,
        durationSeconds: null,
        monitoring: expectedMonitoring,
      });
      expect(response.body).not.toContain('SYNTHETIC-PRIVATE-MEMBER');
      expect(response.body).not.toContain('synthetic-private-lease');
    },
  );

  it('omits unexpected error text from the monitoring projection', async () => {
    const seeded = await seed();
    await prisma.callIntent.updateMany({
      where: { id: seeded.intent.id, organizationId: seeded.organization.id },
      data: { observationErrorCode: 'UNRECOGNIZED_PRIVATE_TEXT' },
    });
    const response = await server.inject({
      method: 'GET',
      url: `/v1/calls/${seeded.call.id}`,
      headers: seeded.headers,
    });
    expect(response.json()).toMatchObject({ monitoring: { lastErrorCode: null } });
    expect(response.body).not.toContain('UNRECOGNIZED_PRIVATE_TEXT');
  });

  it('does not project another organization’s monitoring state', async () => {
    const a = await seed();
    const b = await seed();
    const response = await server.inject({
      method: 'GET',
      url: `/v1/calls/${a.call.id}`,
      headers: b.headers,
    });
    expect(response.statusCode).toBe(404);
    const list = await server.inject({
      method: 'GET',
      url: `/v1/calls?claimId=${a.claim.id}`,
      headers: b.headers,
    });
    expect(list.json()).toMatchObject({ items: [] });
  });

  it('returns null monitoring for historical calls without an intent', async () => {
    const seeded = await seed();
    await prisma.callIntent.deleteMany({
      where: { organizationId: seeded.organization.id, id: seeded.intent.id },
    });
    const response = await server.inject({
      method: 'GET',
      url: `/v1/calls/${seeded.call.id}`,
      headers: seeded.headers,
    });
    expect(response.json()).toMatchObject({ monitoring: null });
  });
});
