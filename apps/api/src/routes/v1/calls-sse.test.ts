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
import { initEnv } from '../../lib/env.js';

interface Seeded {
  orgId: string;
  userId: string;
  callId: string;
  retellCallId: string;
}

async function seedCall(callStatus: 'COMPLETED' | 'NAVIGATING_IVR' = 'COMPLETED'): Promise<Seeded> {
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
      status: callStatus,
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

/**
 * ADR-053 — without REDIS_URL the live phase tails Postgres instead of
 * subscribing to pub/sub, and the stream closes itself once the call is
 * terminal (or at the max-duration cut, without `close`, so the client
 * reconnects).
 */
describe('GET /v1/calls/:id/events/stream — Postgres polling (no Redis)', () => {
  const saved: Record<string, string | undefined> = {};
  const overrides: Record<string, string | undefined> = {
    REDIS_URL: undefined,
    JOB_DISPATCH_MODE: 'inline',
    INTERNAL_JOB_SECRET: 'sse-poll-test-internal-secret-0123456789',
    SSE_POLL_INTERVAL_MS: '50',
    SSE_MAX_STREAM_MS: undefined,
  };

  const applyEnv = (extra: Record<string, string | undefined> = {}): void => {
    for (const [key, value] of Object.entries({ ...overrides, ...extra })) {
      if (!(key in saved)) saved[key] = process.env[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    initEnv();
  };

  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    await prisma.$connect();
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    initEnv();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Call", "CallEvent", "Claim", "Organization", "User", "AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  async function openStream(
    server: FastifyInstance,
    seeded: Seeded,
  ): Promise<{
    read: (until: (s: string) => boolean, ms?: number) => Promise<{ text: string; done: boolean }>;
    abort: () => void;
  }> {
    const url = await server.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const response = await fetch(`${url}/v1/calls/${seeded.callId}/events/stream`, {
      headers: { 'x-test-user-id': seeded.userId, 'x-test-org-id': seeded.orgId },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no response body');
    const decoder = new TextDecoder();
    let text = '';
    let done = false;
    const read = async (
      until: (s: string) => boolean,
      ms = 4_000,
    ): Promise<{ text: string; done: boolean }> => {
      const deadline = Date.now() + ms;
      while (!done && !until(text) && Date.now() < deadline) {
        const chunk = await reader.read();
        if (chunk.done) {
          done = true;
          break;
        }
        text += decoder.decode(chunk.value as Uint8Array, { stream: true });
      }
      return { text, done };
    };
    return {
      read,
      abort: () => {
        controller.abort();
      },
    };
  }

  it('streams rows inserted after replay, then closes when the call ends', async () => {
    applyEnv();
    const server = await buildServer({ logger: false });
    const seeded = await seedCall('NAVIGATING_IVR');
    const stream = await openStream(server, seeded);
    try {
      await stream.read((t) => t.includes('event: replay-end'));

      const live = await prisma.callEvent.create({
        data: {
          callId: seeded.callId,
          eventType: 'call.transcript',
          data: { type: 'call.transcript', text: 'rep picks up' },
        },
      });
      const afterLive = await stream.read((t) => t.includes(live.id));
      expect(afterLive.text).toContain('event: call.event');
      expect(afterLive.text).toContain(live.id);

      await prisma.call.updateMany({
        where: { id: seeded.callId, organizationId: seeded.orgId },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
      const end = await stream.read(() => false);
      expect(end.done).toBe(true);
      expect(end.text).toContain('event: close');
      expect(end.text).toContain('call_ended');
      // Each event goes out exactly once across replay + polling.
      expect(end.text.split(live.id).length - 1).toBe(1);
    } finally {
      stream.abort();
      await new Promise((r) => setTimeout(r, 100));
      await server.close();
    }
  });

  it('ends without a close event at the max-duration cut so the client reconnects', async () => {
    applyEnv({ SSE_MAX_STREAM_MS: '300' });
    const server = await buildServer({ logger: false });
    const seeded = await seedCall('NAVIGATING_IVR');
    const stream = await openStream(server, seeded);
    try {
      const end = await stream.read(() => false);
      expect(end.done).toBe(true);
      expect(end.text).toContain('event: replay-end');
      expect(end.text).not.toContain('event: close');
    } finally {
      stream.abort();
      await new Promise((r) => setTimeout(r, 100));
      await server.close();
    }
  });
});
