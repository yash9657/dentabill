/**
 * Integration tests for GET /v1/calls/:id/events/stream (P4-T5).
 *
 * The route holds the SSE connection open indefinitely; we abort the
 * request after the replay block has been emitted so `inject` resolves
 * with the captured chunks.
 */
import { prisma } from '@dentabill/db';
import * as database from '@dentabill/db';
import { createRedisConnection } from '@dentabill/queue';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';
import { initEnv } from '../../lib/env.js';

interface Seeded {
  orgId: string;
  userId: string;
  callId: string;
  retellCallId: string;
}

function terminalData(seeded: Seeded, text: string): Record<string, unknown> {
  return {
    type: 'call.ended',
    retellCallId: seeded.retellCallId,
    endedAt: '2026-10-13T12:01:00.000Z',
    durationSeconds: 60,
    endReason: 'user_hangup',
    transcript: { text, turns: null },
  };
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

      await prisma.callEvent.create({
        data: {
          callId: seeded.callId,
          eventType: 'webhook.call.ended',
          data: terminalData(seeded, 'final source transcript'),
        },
      });
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

/** Real database/page boundaries; Redis is local and no database is mocked. */
describe('SSE authoritative paginated catch-up', () => {
  let afterPage: (() => Promise<void>) | null = null;
  let recordPageSizes = false;
  let pageSizes: number[] = [];
  let server: FastifyInstance | null = null;

  beforeAll(async () => {
    await prisma.$connect();
    const scopedDb = database.getOrgScopedDb;
    // Instrument actual SELECT completion to control the commit/replay race.
    // Queries and returned rows still come from the real scoped Postgres client.
    vi.spyOn(database, 'getOrgScopedDb').mockImplementation((orgId) =>
      scopedDb(orgId).$extends({
        query: {
          callEvent: {
            async findMany({ args, query }) {
              const result = await query(args);
              if (recordPageSizes) pageSizes.push(result.length);
              const hook = afterPage;
              afterPage = null;
              if (hook) await hook();
              return result;
            },
          },
        },
      }),
    );
  });

  afterEach(async () => {
    afterPage = null;
    recordPageSizes = false;
    pageSizes = [];
    if (server) await server.close();
    server = null;
    vi.unstubAllEnvs();
    initEnv();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Call", "CallEvent", "Claim", "Organization", "User", "AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.$disconnect();
  });

  function configure(redis: boolean): void {
    vi.stubEnv('REDIS_URL', redis ? 'redis://localhost:6379' : '');
    vi.stubEnv('JOB_DISPATCH_MODE', redis ? 'bullmq' : 'inline');
    vi.stubEnv('INTERNAL_JOB_SECRET', 'sse-catchup-local-test-secret-0123456789');
    vi.stubEnv('SSE_POLL_INTERVAL_MS', '30');
    vi.stubEnv('SSE_MAX_STREAM_MS', '');
    initEnv();
  }

  async function connect(seeded: Seeded): Promise<{
    read: (until: (text: string) => boolean) => Promise<string>;
    close: () => void;
  }> {
    server = await buildServer({ logger: false });
    const url = await server.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const deadline = setTimeout(() => {
      controller.abort();
    }, 5_000);
    const response = await fetch(`${url}/v1/calls/${seeded.callId}/events/stream`, {
      headers: { 'x-test-user-id': seeded.userId, 'x-test-org-id': seeded.orgId },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No SSE response body');
    const decoder = new TextDecoder();
    let text = '';
    return {
      async read(until) {
        while (!until(text)) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += decoder.decode(chunk.value as Uint8Array, { stream: true });
        }
        return text;
      },
      close() {
        clearTimeout(deadline);
        controller.abort();
      },
    };
  }

  function eventsFromWire(text: string): { id: string; eventType: string }[] {
    return text.split('\n\n').flatMap((frame) => {
      if (!frame.startsWith('event: replay\n') && !frame.startsWith('event: call.event\n'))
        return [];
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      return data ? [JSON.parse(data.slice(6)) as { id: string; eventType: string }] : [];
    });
  }

  async function replaceWithBacklog(
    seeded: Seeded,
    count: number,
    terminal: boolean,
  ): Promise<string[]> {
    await prisma.callEvent.deleteMany({ where: { callId: seeded.callId } });
    const ids = Array.from(
      { length: count },
      (_, i) => `${seeded.callId}-event-${String(i).padStart(4, '0')}`,
    );
    await prisma.callEvent.createMany({
      data: ids.map((id, i) => ({
        id,
        callId: seeded.callId,
        timestamp: new Date('2026-10-13T12:00:00.000Z'),
        eventType:
          terminal && i === count - 1 ? 'webhook.call.ended' : 'webhook.call.transcript_snapshot',
        data:
          terminal && i === count - 1
            ? terminalData(seeded, `source ${String(i)}`)
            : { transcript: { text: `source ${String(i)}`, turns: null } },
      })),
    });
    return ids;
  }

  it.each([false, true])(
    'delivers all 451 timestamp-tied rows and a final beyond page one, Redis=%s',
    async (redis) => {
      configure(redis);
      const seeded = await seedCall();
      const ids = await replaceWithBacklog(seeded, 451, true);
      const other = await seedCall();
      const otherIds = await replaceWithBacklog(other, 451, true);
      recordPageSizes = true;
      const stream = await connect(seeded);
      try {
        const text = await stream.read(() => false);
        const events = eventsFromWire(text);
        expect(events.map((event) => event.id)).toEqual(ids);
        expect(events.at(-1)?.eventType).toBe('webhook.call.ended');
        expect(new Set(events.map((event) => event.id)).size).toBe(451);
        expect(otherIds.some((id) => text.includes(id))).toBe(false);
        expect(text).toContain('event: close');
        expect(text.indexOf(ids[450] ?? '')).toBeLessThan(text.indexOf('event: replay-end'));
        expect(pageSizes.filter((size) => size === 200).length).toBeGreaterThanOrEqual(2);
        expect(pageSizes.every((size) => size <= 200)).toBe(true);
      } finally {
        stream.close();
      }
    },
  );

  it.each([false, true])(
    'recovers a late row behind the replay cursor before terminal closure, Redis=%s',
    async (redis) => {
      configure(redis);
      const seeded = await seedCall('NAVIGATING_IVR');
      const ids = await replaceWithBacklog(seeded, 401, false);
      const lateId = `a-late-${seeded.callId}`;
      const finalId = `z-final-${seeded.callId}`;
      const publisher = redis ? createRedisConnection('redis://localhost:6379') : null;
      afterPage = async () => {
        // These commits happen after page one's SELECT but before replay resumes.
        // The lower ID sorts behind its cursor, and a hint can race subscription.
        await prisma.$transaction([
          prisma.callEvent.createMany({
            data: [
              {
                id: lateId,
                callId: seeded.callId,
                timestamp: new Date('2026-10-13T12:00:00.000Z'),
                eventType: 'webhook.call.transcript_snapshot',
                data: { transcript: { text: 'late committed source', turns: null } },
              },
              {
                id: finalId,
                callId: seeded.callId,
                timestamp: new Date('2026-10-13T12:00:01.000Z'),
                eventType: 'webhook.call.ended',
                data: terminalData(seeded, 'complete final source'),
              },
            ],
          }),
          prisma.call.updateMany({
            where: { id: seeded.callId, organizationId: seeded.orgId },
            data: { status: 'COMPLETED', endedAt: new Date() },
          }),
        ]);
        await publisher?.publish(
          `call:${seeded.retellCallId}:events`,
          JSON.stringify({
            callEventId: finalId,
            type: 'call.ended',
            data: { text: 'not authoritative pubsub text' },
          }),
        );
      };
      const stream = await connect(seeded);
      try {
        const text = await stream.read(() => false);
        const delivered = eventsFromWire(text).map((event) => event.id);
        expect(delivered).toHaveLength(403);
        expect(new Set(delivered)).toEqual(new Set([...ids, lateId, finalId]));
        expect(text).toContain('complete final source');
        expect(text).not.toContain('not authoritative pubsub text');
        expect(text).toContain('event: close');
        expect(text.indexOf(lateId)).toBeLessThan(text.indexOf('event: close'));
      } finally {
        stream.close();
        publisher?.disconnect();
      }
    },
  );

  it.each([false, true])(
    'catches up after replay without any publish, including an older timestamp, Redis=%s',
    async (redis) => {
      configure(redis);
      const seeded = await seedCall('NAVIGATING_IVR');
      const ids = await replaceWithBacklog(seeded, 210, false);
      const stream = await connect(seeded);
      try {
        await stream.read((text) => text.includes('event: replay-end'));
        const final = await prisma.$transaction(async (tx) => {
          const event = await tx.callEvent.create({
            data: {
              callId: seeded.callId,
              timestamp: new Date('2026-10-13T11:00:00.000Z'),
              eventType: 'webhook.call.ended',
              data: terminalData(seeded, 'final arrived without a hint'),
            },
          });
          await tx.call.updateMany({
            where: { id: seeded.callId, organizationId: seeded.orgId },
            data: { status: 'COMPLETED', endedAt: new Date() },
          });
          return event;
        });
        const text = await stream.read(() => false);
        const delivered = eventsFromWire(text).map((event) => event.id);
        expect(delivered).toHaveLength(211);
        expect(new Set(delivered)).toEqual(new Set([...ids, final.id]));
        expect(text).toContain('final arrived without a hint');
        expect(text).toContain('event: close');
      } finally {
        stream.close();
      }
    },
  );

  it.each(['call.ended', 'webhook.call.ended'])(
    'waits through local cancellation and invalid evidence, then drains valid %s before closing',
    async (eventType) => {
      configure(false);
      const seeded = await seedCall('NAVIGATING_IVR');
      await prisma.call.updateMany({
        where: { id: seeded.callId, organizationId: seeded.orgId },
        data: { status: 'FAILED', endedAt: new Date(), cancelRequestedAt: new Date() },
      });
      await prisma.callEvent.create({
        data: {
          callId: seeded.callId,
          eventType,
          data: { type: 'call.ended', transcript: { text: 'incomplete payload', turns: null } },
        },
      });
      const stream = await connect(seeded);
      try {
        await stream.read((text) => text.includes('event: replay-end'));
        await new Promise((resolve) => setTimeout(resolve, 100));
        const stillLive = await prisma.callEvent.create({
          data: {
            callId: seeded.callId,
            eventType: 'webhook.call.transcript_snapshot',
            data: {
              transcript: {
                text: 'payer is still speaking after cancellation request',
                turns: null,
              },
            },
          },
        });
        const pending = await stream.read((text) => text.includes(stillLive.id));
        expect(pending).toContain(stillLive.id);
        expect(pending).not.toContain('event: close');
        const final = await prisma.callEvent.create({
          data: {
            callId: seeded.callId,
            eventType,
            data: terminalData(seeded, 'final after cancellation'),
          },
        });
        const text = await stream.read(() => false);
        expect(text).toContain('final after cancellation');
        expect(text).toContain('event: close');
        expect(text.indexOf(final.id)).toBeLessThan(text.indexOf('event: close'));
        expect(eventsFromWire(text).filter((event) => event.id === final.id)).toHaveLength(1);
      } finally {
        stream.close();
      }
    },
  );
});
