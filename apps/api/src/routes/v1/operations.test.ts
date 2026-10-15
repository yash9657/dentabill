import { randomUUID } from 'node:crypto';

import { enqueueJobOutbox } from '@dentabill/call-worker';
import { prisma, type UserRole } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

async function seed(role: UserRole = 'OWNER') {
  const unique = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic operations practice', clerkOrgId: `org_${unique}` },
  });
  const actor = await prisma.user.create({
    data: {
      organizationId: organization.id,
      clerkUserId: `user_${unique}`,
      email: 'synthetic@example.test',
      role,
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization.id,
      claimNumber: 'SYNTHETIC-PRIVATE-CLAIM',
      subscriberId: 'SYNTHETIC-PRIVATE-MEMBER',
      patientDOBHash: 'synthetic',
      payerCode: 'CIGNA_DENTAL',
      claimAmount: '120.00',
      serviceDate: new Date('2026-01-01'),
      status: 'IN_QUEUE',
      priority: 80,
    },
  });
  const data = {
    organizationId: organization.id,
    claimId: claim.id,
    payerCode: claim.payerCode,
    attemptNumber: 1,
    claimPriority: 80,
    idempotencyKey: `synthetic-command-${unique}`,
  };
  const intent = await prisma.callIntent.create({
    data: { ...data, claimVersion: claim.updatedAt },
  });
  const row = await enqueueJobOutbox(prisma, {
    organizationId: organization.id,
    kind: 'CALL_PLACE',
    data,
  });
  await prisma.jobOutbox.updateMany({
    where: { id: row.id, organizationId: organization.id },
    data: { state: 'QUARANTINED', deliveryAttempts: 10, lastErrorCode: 'DELIVERY_EXHAUSTED' },
  });
  return {
    organization,
    actor,
    claim,
    intent,
    row,
    headers: { 'x-test-user-id': actor.clerkUserId },
  };
}
type Seed = Awaited<ReturnType<typeof seed>>;
interface Preview {
  id: string;
  state: string;
  action: string;
  reviewVersion: string;
  blockedReason: string | null;
}
interface Page {
  items: { id: string; lastErrorCode?: string | null }[];
  nextCursor: string | null;
  hasMore: boolean;
}

describe('operations API with real Postgres', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    await prisma.$connect();
  });
  beforeEach(async () => {
    app = await buildServer({ logger: false, callRecoveryProvider: null });
  });
  afterEach(async () => {
    await app.close();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  async function review(s: Seed): Promise<Preview> {
    const result = await app.inject({
      method: 'GET',
      url: `/v1/operations/outbox/${s.row.id}`,
      headers: s.headers,
    });
    expect(result.statusCode).toBe(200);
    return result.json<Preview>();
  }

  it.each(['OWNER', 'ADMIN'] as const)(
    'allows %s a scoped overview without exposing payloads',
    async (role) => {
      const s = await seed(role);
      await seed();
      const result = await app.inject({ method: 'GET', url: '/v1/operations', headers: s.headers });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({
        counts: {
          pending: 0,
          agedPending: 0,
          quarantined: 1,
          acceptedOverdue: 0,
          observationReview: 0,
          uncertainCalls: 0,
          legacyReadyWithoutDelivery: 0,
        },
        thresholds: { deliveryAgeSeconds: 300, observationAgeSeconds: 120 },
      });
      const list = await app.inject({
        method: 'GET',
        url: '/v1/operations/outbox',
        headers: s.headers,
      });
      expect(list.json<Page>().items.map((row) => row.id)).toEqual([s.row.id]);
      const detail = await review(s);
      expect(detail).toMatchObject({ action: 'RETRY', blockedReason: null });
      for (const response of [result.body, list.body, JSON.stringify(detail)]) {
        expect(response).not.toContain('SYNTHETIC-PRIVATE');
        expect(response).not.toContain(s.row.idempotencyKey);
        expect(response).not.toContain('payload');
      }
    },
  );

  it('rejects unauthenticated, billing staff, and spoofed cross-org role access', async () => {
    const owner = await seed();
    const staff = await seed('BILLING_STAFF');
    for (const url of [
      '/v1/operations',
      '/v1/operations/outbox',
      '/v1/operations/calls',
      `/v1/operations/outbox/${owner.row.id}`,
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: staff.headers })).statusCode).toBe(
        403,
      );
      expect(
        (
          await app.inject({
            method: 'GET',
            url,
            headers: {
              'x-test-user-id': owner.actor.id,
              'x-test-org-id': staff.organization.id,
            },
          })
        ).statusCode,
      ).toBe(403);
    }
    const result = await app.inject({
      method: 'POST',
      url: `/v1/operations/outbox/${owner.row.id}/recover`,
      headers: staff.headers,
      payload: { action: 'RETRY', reviewVersion: '0'.repeat(64) },
    });
    expect(result.statusCode).toBe(403);
  });

  it('returns not found for another tenant’s recovery row', async () => {
    const a = await seed();
    const b = await seed();
    const preview = await review(a);
    for (const method of ['GET', 'POST'] as const) {
      const response = await app.inject({
        method,
        url: `/v1/operations/outbox/${a.row.id}${method === 'POST' ? '/recover' : ''}`,
        headers: b.headers,
        ...(method === 'POST'
          ? { payload: { action: 'RETRY', reviewVersion: preview.reviewVersion } }
          : {}),
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it('records a bounded recovery once, preserves command, and rejects the stale replay', async () => {
    const s = await seed();
    const preview = await review(s);
    const request = {
      method: 'POST' as const,
      url: `/v1/operations/outbox/${s.row.id}/recover`,
      headers: s.headers,
      payload: { action: 'RETRY', reviewVersion: preview.reviewVersion },
    };
    const response = await app.inject(request);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: 'PENDING',
      deliveryAttempts: 10,
      deliveryAttemptLimit: 13,
      recoveryCount: 1,
    });
    expect((await app.inject(request)).statusCode).toBe(409);
    const row = await prisma.jobOutbox.findFirstOrThrow({
      where: { id: s.row.id, organizationId: s.organization.id },
    });
    expect(row.payloadHash).toBe(s.row.payloadHash);
    expect(row.payload).toEqual(s.row.payload);
    expect(row.deliveredAt).toBeNull();
    expect(await prisma.call.count({ where: { organizationId: s.organization.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: s.organization.id, action: 'jobOutbox.retried' },
      }),
    ).toBe(1);
  });

  it('invalidates review after a claim edit and rejects mutation payload extras', async () => {
    const s = await seed();
    const preview = await review(s);
    await prisma.claim.updateMany({
      where: { id: s.claim.id, organizationId: s.organization.id },
      data: { priority: 79 },
    });
    const request = {
      method: 'POST' as const,
      url: `/v1/operations/outbox/${s.row.id}/recover`,
      headers: s.headers,
    };
    expect(
      (
        await app.inject({
          ...request,
          payload: { action: 'RETRY', reviewVersion: preview.reviewVersion },
        })
      ).statusCode,
    ).toBe(409);
    expect((await review(s)).blockedReason).toBe('CLAIM_CHANGED');
    expect(
      (
        await app.inject({
          ...request,
          payload: {
            action: 'RETRY',
            reviewVersion: preview.reviewVersion,
            organizationId: s.organization.id,
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          ...request,
          payload: { action: 'BLOCKED', reviewVersion: preview.reviewVersion },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('closes cancelled work without fabricating a transport receipt', async () => {
    const s = await seed();
    await prisma.callIntent.updateMany({
      where: { id: s.intent.id, organizationId: s.organization.id },
      data: { state: 'CANCELLED' },
    });
    const preview = await review(s);
    expect(preview.action).toBe('CLOSE');
    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/outbox/${s.row.id}/recover`,
      headers: s.headers,
      payload: { action: 'CLOSE', reviewVersion: preview.reviewVersion },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: 'CLOSED',
      deliveredAt: null,
      closedAt: expect.any(String),
    });
  });

  it('returns safe blocked previews for early quarantine and unfinished summary work', async () => {
    const s = await seed();
    await prisma.jobOutbox.updateMany({
      where: { id: s.row.id, organizationId: s.organization.id },
      data: { deliveryAttempts: 1, lastErrorCode: 'SYNTHETIC-PRIVATE-ERROR' },
    });
    expect(await review(s)).toMatchObject({
      action: 'BLOCKED',
      blockedReason: 'DELIVERY_NOT_EXHAUSTED',
      lastErrorCode: 'UNKNOWN',
    });
    const call = await prisma.call.create({
      data: {
        organizationId: s.organization.id,
        claimId: s.claim.id,
        retellCallId: `synthetic_${randomUUID()}`,
        status: 'COMPLETED',
      },
    });
    const summary = await enqueueJobOutbox(prisma, {
      organizationId: s.organization.id,
      kind: 'SUMMARY_GENERATE',
      data: {
        organizationId: s.organization.id,
        callId: call.id,
        promptVersion: 'v1',
        idempotencyKey: `call.${call.id}`,
      },
    });
    await prisma.jobOutbox.updateMany({
      where: { id: summary.id, organizationId: s.organization.id },
      data: { state: 'QUARANTINED', deliveryAttempts: 10 },
    });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/operations/outbox/${summary.id}`,
      headers: s.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      action: 'BLOCKED',
      blockedReason: 'SUMMARY_RETRY_UNSAFE',
    });
  });

  it('paginates by stable age and ID, scopes every page, and rejects malformed/filter-mismatched cursors', async () => {
    const s = await seed();
    const other = await seed();
    const stamp = new Date('2026-01-01');
    await prisma.jobOutbox.updateMany({
      where: { id: s.row.id, organizationId: s.organization.id },
      data: { createdAt: stamp },
    });
    await prisma.jobOutbox.create({
      data: {
        organizationId: s.organization.id,
        kind: 'CALL_PLACE',
        idempotencyKey: 'private-synthetic-key',
        payload: { private: 'SYNTHETIC-PRIVATE' },
        payloadHash: 'invalid',
        state: 'QUARANTINED',
        createdAt: stamp,
        lastErrorCode: 'SYNTHETIC-PRIVATE-ERROR',
      },
    });
    const a = await app.inject({
      method: 'GET',
      url: '/v1/operations/outbox?limit=1',
      headers: s.headers,
    });
    const first = a.json<Page>();
    expect(first.hasMore).toBe(true);
    if (!first.nextCursor) throw new Error('Expected next page in synthetic fixture.');
    const b = await app.inject({
      method: 'GET',
      url: `/v1/operations/outbox?limit=1&cursor=${first.nextCursor}`,
      headers: s.headers,
    });
    const second = b.json<Page>();
    expect(second.hasMore).toBe(false);
    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(other.row.id);
    expect(a.body + b.body).not.toContain('SYNTHETIC-PRIVATE');
    expect([...first.items, ...second.items].some((row) => row.lastErrorCode === 'UNKNOWN')).toBe(
      true,
    );
    for (const query of [
      'cursor=bad',
      'limit=101',
      'organizationId=foreign',
      `state=PENDING&cursor=${first.nextCursor}`,
    ])
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/operations/outbox?${query}`,
            headers: s.headers,
          })
        ).statusCode,
      ).toBe(400);
  });

  it('uses due age instead of creation age and identifies missing legacy delivery without creating work', async () => {
    const s = await seed();
    const foreign = await seed();
    const old = new Date(Date.now() - 900_000);
    await prisma.jobOutbox.updateMany({
      where: { id: s.row.id, organizationId: s.organization.id },
      data: { state: 'PENDING', createdAt: old, availableAt: new Date(Date.now() + 60_000) },
    });
    const legacyClaim = await prisma.claim.create({
      data: {
        organizationId: s.organization.id,
        claimNumber: 'SYNTHETIC-LEGACY',
        patientDOBHash: 'synthetic',
        payerCode: s.claim.payerCode,
        claimAmount: '120.00',
        serviceDate: s.claim.serviceDate,
        status: 'IN_QUEUE',
      },
    });
    const legacy = await prisma.callIntent.create({
      data: {
        organizationId: s.organization.id,
        claimId: legacyClaim.id,
        idempotencyKey: foreign.row.idempotencyKey,
        payerCode: s.claim.payerCode,
        claimPriority: 80,
        claimVersion: s.claim.updatedAt,
        attemptNumber: 2,
      },
    });
    const overview = await app.inject({ method: 'GET', url: '/v1/operations', headers: s.headers });
    expect(overview.json()).toMatchObject({
      counts: { pending: 1, agedPending: 0, legacyReadyWithoutDelivery: 1 },
      oldestPendingAt: null,
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/operations/calls?kind=LEGACY_READY',
      headers: s.headers,
    });
    expect(missing.json<Page>().items.map((row) => row.id)).toEqual([legacy.id]);
    expect(await prisma.jobOutbox.count({ where: { organizationId: s.organization.id } })).toBe(1);
    await prisma.jobOutbox.updateMany({
      where: { id: s.row.id, organizationId: s.organization.id },
      data: { availableAt: old },
    });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/operations', headers: s.headers })).json(),
    ).toMatchObject({ counts: { agedPending: 1 }, oldestPendingAt: old.toISOString() });
  });

  it('lists accepted overdue/stale calls and uncertain submissions without looking up or creating calls', async () => {
    const s = await seed();
    const foreign = await seed();
    const old = new Date(Date.now() - 900_000);
    await prisma.callIntent.updateMany({
      where: { id: s.intent.id, organizationId: s.organization.id },
      data: {
        state: 'ACCEPTED',
        callDeadlineAt: old,
        observationReviewAt: old,
        nextObservationAt: old,
      },
    });
    await prisma.callIntent.updateMany({
      where: { id: foreign.intent.id, organizationId: foreign.organization.id },
      data: { state: 'UNKNOWN' },
    });
    const observation = await app.inject({
      method: 'GET',
      url: '/v1/operations/calls',
      headers: s.headers,
    });
    expect(observation.json<Page>().items.map((row) => row.id)).toEqual([s.intent.id]);
    const overview = await app.inject({ method: 'GET', url: '/v1/operations', headers: s.headers });
    expect(overview.json()).toMatchObject({
      counts: { acceptedOverdue: 1, observationReview: 1, uncertainCalls: 0 },
    });
    await prisma.callIntent.updateMany({
      where: { id: s.intent.id, organizationId: s.organization.id },
      data: { state: 'UNKNOWN' },
    });
    const uncertain = await app.inject({
      method: 'GET',
      url: '/v1/operations/calls?kind=UNCERTAIN',
      headers: s.headers,
    });
    expect(uncertain.json<Page>().items.map((row) => row.id)).toEqual([s.intent.id]);
    const preview = await review(s);
    expect(preview).toMatchObject({
      action: 'BLOCKED',
      blockedReason: 'CALL_RECONCILIATION_REQUIRED',
    });
    expect(await prisma.call.count({ where: { organizationId: s.organization.id } })).toBe(0);
  });
});
