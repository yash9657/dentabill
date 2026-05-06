/**
 * Integration tests for GET /v1/calls/:id/events/stream (P4-T5).
 *
 * The route holds the SSE connection open indefinitely; we abort the
 * request after the replay block has been emitted so `inject` resolves
 * with the captured chunks.
 */
import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

interface Seeded {
  orgId: string;
  userId: string;
  callId: string;
  retellCallId: string;
}

async function seedCall(): Promise<Seeded> {
  const slug = Math.random().toString(36).slice(2);
  const org = await prisma.organization.create({
    data: { name: `Org ${slug}`, clerkOrgId: `clerk_${slug}` },
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
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      patientDOBHash: `hash_${slug}`,
      claimNumber: `CL-${slug}`,
      cdtCodes: ['D2740'],
      claimAmount: '420.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date(),
      status: 'COMPLETED',
      priority: 80,
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: `retell_${slug}`,
      status: 'COMPLETED',
      startedAt: new Date(),
    },
  });
  await prisma.callEvent.createMany({
    data: [
      {
        callId: call.id,
        eventType: 'webhook.call.started',
        data: { type: 'call.started' },
        timestamp: new Date(Date.now() - 2000),
      },
      {
        callId: call.id,
        eventType: 'webhook.call.transcript',
        data: { type: 'call.transcript', text: 'agent says hello' },
        timestamp: new Date(Date.now() - 1000),
      },
    ],
  });
  return { orgId: org.id, userId: user.id, callId: call.id, retellCallId: call.retellCallId };
}

describe('GET /v1/calls/:id/events/stream (P4-T5)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Call", "CallEvent", "Claim", "Organization", "User", "AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  it('rejects unauthenticated callers with 401', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/calls/some_id/events/stream',
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 when the call belongs to another org (cross-tenant isolation)', async () => {
    const a = await seedCall();
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other', clerkOrgId: `clerk_other_${Math.random().toString(36).slice(2)}` },
    });
    const otherUser = await prisma.user.create({
      data: {
        clerkUserId: `user_other_${Math.random().toString(36).slice(2)}`,
        organizationId: otherOrg.id,
        role: 'OWNER',
        email: 'other@test.local',
        name: 'Other',
      },
    });
    const response = await server.inject({
      method: 'GET',
      url: `/v1/calls/${a.callId}/events/stream`,
      headers: { 'x-test-user-id': otherUser.id, 'x-test-org-id': otherOrg.id },
    });
    expect(response.statusCode).toBe(404);
  });

  it('streams replay events + replay-end marker over the SSE wire', async () => {
    const seeded = await seedCall();

    // Use a real listening socket — light-my-request's `inject` does
    // not surface SSE chunk-by-chunk semantics cleanly because it
    // buffers the response until the stream closes.
    const url = await server.listen({ port: 0, host: '127.0.0.1' });

    const controller = new AbortController();
    let response: Response;
    try {
      response = await fetch(`${url}/v1/calls/${seeded.callId}/events/stream`, {
        method: 'GET',
        headers: { 'x-test-user-id': seeded.userId, 'x-test-org-id': seeded.orgId },
        signal: controller.signal,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/event-stream');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('no response body');
      const decoder = new TextDecoder();
      let collected = '';
      const deadline = Date.now() + 4000;
      while (!collected.includes('event: replay-end') && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        collected += decoder.decode(value as Uint8Array, { stream: true });
      }
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      controller.abort();

      expect(collected).toContain('event: replay');
      expect(collected).toContain('webhook.call.started');
      expect(collected).toContain('webhook.call.transcript');
      expect(collected).toContain('event: replay-end');
    } finally {
      // Give the server a tick to clean up so afterEach truncate
      // doesn't race with the route's audit write.
      await new Promise((r) => setTimeout(r, 100));
    }
  });
});
