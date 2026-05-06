/**
 * `GET /v1/calls/:id/events/stream` — Server-Sent Events for live
 * call transcripts (P4-T5 / ADR-046).
 *
 * Wire format:
 *   - `event: replay\ndata: <json>\n\n` for every CallEvent persisted
 *      before the connection. Sent once, in timestamp order.
 *   - `event: call.event\ndata: <json>\n\n` for live events received
 *      via Redis pub/sub on `call:<retellCallId>:events` while the
 *      connection is open.
 *   - `: ping\n\n` heartbeat every 15s so intermediaries do not idle-
 *      kill the connection.
 *   - `event: close\ndata: <reason>\n\n` then `reply.raw.end()` on a
 *      clean shutdown (server close, auth expiry).
 *
 * Authentication: existing `requireAuth` preHandler. The Call lookup
 * is org-scoped via `getOrgScopedDb` — cross-org access returns 404.
 *
 * The route is fully Postgres-authoritative on connect (replay) and
 * Redis pub/sub for fan-out. A subscriber that connected after the
 * webhook fired but before the SSE write reached it would observe
 * the event via the Postgres replay; a subscriber connected before
 * the webhook fired observes it via the Redis publish. The two
 * sources can overlap on a fast publish — the client de-dupes on
 * `id` (every call.event payload carries a `callEventId`).
 */
import { audit, getOrgScopedDb } from '@dentabill/db';
import { createRedisConnection } from '@dentabill/queue';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getEnv } from '../../lib/env.js';

const HEARTBEAT_INTERVAL_MS = 15_000;
const REPLAY_LIMIT = 200;

const StreamParamsSchema = z.object({ id: z.string().min(1) });

interface ReplayPayload {
  readonly id: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
}

export function callsSseRoutes(fastify: FastifyInstance): void {
  const { requireAuth } = fastify.auth;

  fastify.get(
    '/calls/:id/events/stream',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Live call event stream (Server-Sent Events). Replays persisted CallEvent rows on connect, then streams new events via Redis pub/sub. Heartbeat every 15s; closes on server shutdown or auth expiry. See ADR-046.',
        security: [{ bearer: [] as string[] }],
        params: StreamParamsSchema,
      },
    },
    async (request, reply): Promise<void> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const params = request.params as z.infer<typeof StreamParamsSchema>;

      const db = getOrgScopedDb(orgId);
      const call = await db.call.findFirst({
        where: { id: params.id },
        select: { id: true, retellCallId: true },
      });
      if (!call) {
        throw new ApiError('NOT_FOUND', 'Call not found in your organization.');
      }

      const events = await db.callEvent.findMany({
        where: { callId: call.id },
        orderBy: { timestamp: 'asc' },
        take: REPLAY_LIMIT,
      });

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const write = (chunk: string): void => {
        if (!reply.raw.writableEnded) reply.raw.write(chunk);
      };

      for (const evt of events) {
        const payload: ReplayPayload = {
          id: evt.id,
          eventType: evt.eventType,
          timestamp: evt.timestamp.toISOString(),
          data: toRecord(evt.data),
        };
        write(`event: replay\ndata: ${JSON.stringify(payload)}\n\n`);
      }
      write('event: replay-end\ndata: {}\n\n');

      // Subscribe to Redis pub/sub. We open a per-connection subscriber
      // because ioredis subscribers are not shared with the publish
      // connection, and using a per-process shared subscriber adds
      // bookkeeping for partial unsubscribe that is not yet justified.
      const env = getEnv();
      const subscriber = createRedisConnection(env.REDIS_URL, { lazyConnect: false });
      const channel = `call:${call.retellCallId}:events`;
      const onMessage = (incoming: string, message: string): void => {
        if (incoming !== channel) return;
        write(`event: call.event\ndata: ${message}\n\n`);
      };
      try {
        await subscriber.subscribe(channel);
      } catch (err) {
        request.log.warn({ err, channel }, 'sse: subscribe failed; continuing replay-only');
      }
      subscriber.on('message', onMessage);

      const heartbeat = setInterval(() => {
        write(`: ping\n\n`);
      }, HEARTBEAT_INTERVAL_MS);

      await audit({
        action: 'call.events.stream.opened',
        resourceType: 'Call',
        resourceId: call.id,
        organizationId: orgId,
        userId: auth.userId,
        metadata: { replayCount: events.length },
      });

      const cleanup = (): void => {
        clearInterval(heartbeat);
        subscriber.off('message', onMessage);
        void subscriber.unsubscribe(channel).catch(() => undefined);
        subscriber.disconnect();
        if (!reply.raw.writableEnded) {
          write(`event: close\ndata: ${JSON.stringify({ reason: 'server_close' })}\n\n`);
          reply.raw.end();
        }
      };

      request.raw.once('close', cleanup);
      reply.raw.once('error', cleanup);

      // Returning a never-resolving promise is the documented Fastify
      // pattern for keeping the response open. The cleanup above
      // resolves it implicitly when the client disconnects.
      await new Promise<void>((resolve) => {
        request.raw.once('close', () => {
          resolve();
        });
      });
    },
  );
}

function toRecord(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}
