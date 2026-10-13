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
 * Redis pub/sub for fan-out. Without `REDIS_URL` (ADR-053) the live
 * phase instead polls Postgres every `SSE_POLL_INTERVAL_MS` and closes
 * with `event: close` once the call reaches a terminal status. On
 * Vercel the stream is also cut (without `close`) before the function
 * timeout so the client reconnects and re-replays, de-duplicating by id. A subscriber that connected after the
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

import { getEnv, sseMaxStreamMs } from '../../lib/env.js';

const HEARTBEAT_INTERVAL_MS = 15_000;
const REPLAY_LIMIT = 200;
/** Call statuses after which no further CallEvents are written. */
const TERMINAL_CALL_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'FAILED', 'VOICEMAIL']);

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

      // From here on the route owns the raw response: hijack so Fastify does
      // not try to send its own reply when the handler settles. Writing to
      // `reply.raw` bypasses Fastify's header flush, so carry over headers
      // hooks already set on the reply (CORS for cross-origin clients).
      reply.hijack();
      const inherited: Record<string, string | number | string[]> = {};
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) inherited[name] = value;
      }
      reply.raw.writeHead(200, {
        ...inherited,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const write = (chunk: string): void => {
        if (!reply.raw.writableEnded) reply.raw.write(chunk);
      };

      // Poll-mode cursor: ids already on the wire + the newest timestamp
      // seen. Polling uses `timestamp >= cursor` and skips sent ids, so
      // events sharing a timestamp with the cursor are never lost.
      const sent = new Set<string>();
      let cursor: Date | null = null;
      const emit = (event: 'replay' | 'call.event', evt: (typeof events)[number]): void => {
        sent.add(evt.id);
        cursor = evt.timestamp;
        const payload: ReplayPayload = {
          id: evt.id,
          eventType: evt.eventType,
          timestamp: evt.timestamp.toISOString(),
          data: toRecord(evt.data),
        };
        write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      };

      for (const evt of events) emit('replay', evt);
      write('event: replay-end\ndata: {}\n\n');

      const env = getEnv();
      const timers: ReturnType<typeof setTimeout>[] = [];
      // Read through a function: the flag flips inside callbacks/awaits,
      // which control-flow narrowing cannot see.
      const state = { finished: false };
      const isFinished = (): boolean => state.finished;
      let resolveDone: () => void = () => undefined;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const teardown: (() => void)[] = [];

      /**
       * End the stream. With a `reason` the client is told the stream is
       * over for good (`event: close` — the web hook stops). Without one
       * the socket just ends and the client reconnects + re-replays,
       * de-duplicating by event id; used for the max-duration cut so a
       * long call survives the platform's function timeout.
       */
      const finish = (reason: string | null): void => {
        if (state.finished) return;
        state.finished = true;
        for (const t of timers) clearTimeout(t);
        for (const fn of teardown) fn();
        if (!reply.raw.writableEnded) {
          if (reason !== null) {
            write(`event: close\ndata: ${JSON.stringify({ reason })}\n\n`);
          }
          reply.raw.end();
        }
        resolveDone();
      };

      if (env.REDIS_URL) {
        // Subscribe to Redis pub/sub. We open a per-connection subscriber
        // because ioredis subscribers are not shared with the publish
        // connection, and using a per-process shared subscriber adds
        // bookkeeping for partial unsubscribe that is not yet justified.
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
        teardown.push(() => {
          subscriber.off('message', onMessage);
          void subscriber.unsubscribe(channel).catch(() => undefined);
          subscriber.disconnect();
        });
      } else {
        // ADR-053 — no Redis: Postgres is already the durable store
        // (ADR-046), so tail it. Status is read BEFORE events: the call
        // handler persists `call.ended` before it writes the terminal
        // status, so once a terminal status is observed every event is
        // already readable and the final batch below is complete.
        const pollIntervalMs = env.SSE_POLL_INTERVAL_MS;
        const poll = async (): Promise<void> => {
          if (isFinished()) return;
          let terminal = false;
          try {
            const current = await db.call.findFirst({
              where: { id: call.id },
              select: { status: true, endedAt: true },
            });
            terminal =
              current === null
                ? true
                : current.endedAt !== null || TERMINAL_CALL_STATUSES.has(current.status);
            const fresh = await db.callEvent.findMany({
              where: { callId: call.id, ...(cursor !== null && { timestamp: { gte: cursor } }) },
              orderBy: { timestamp: 'asc' },
              take: REPLAY_LIMIT,
            });
            for (const evt of fresh) {
              if (isFinished()) return;
              if (!sent.has(evt.id)) emit('call.event', evt);
            }
            // A full page means more rows may be waiting; drain before closing.
            if (fresh.length === REPLAY_LIMIT) terminal = false;
          } catch (err) {
            request.log.warn({ err, callId: call.id }, 'sse: poll failed; retrying');
          }
          if (isFinished()) return;
          if (terminal) {
            finish('call_ended');
            return;
          }
          timers.push(
            setTimeout(() => {
              void poll();
            }, pollIntervalMs),
          );
        };
        void poll();
      }

      const heartbeat = setInterval(() => {
        write(`: ping\n\n`);
      }, HEARTBEAT_INTERVAL_MS);
      teardown.push(() => {
        clearInterval(heartbeat);
      });

      const maxStreamMs = sseMaxStreamMs(env);
      if (maxStreamMs !== null) {
        timers.push(
          setTimeout(() => {
            finish(null);
          }, maxStreamMs),
        );
      }

      await audit({
        action: 'call.events.stream.opened',
        resourceType: 'Call',
        resourceId: call.id,
        organizationId: orgId,
        userId: auth.userId,
        metadata: { replayCount: events.length },
      });

      request.raw.once('close', () => {
        finish('server_close');
      });
      reply.raw.once('error', () => {
        finish('server_close');
      });

      // Keep the handler pending until the stream ends — client
      // disconnect, terminal call (poll mode) or the max-duration cut.
      await done;
    },
  );
}

function toRecord(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}
