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
 * Postgres is authoritative for replay and periodic catch-up in every
 * deployment mode. Redis messages only request an earlier catch-up; they are
 * never forwarded as evidence. Each scan uses bounded (timestamp, id) pages
 * and deduplicates already delivered IDs, including rows committed behind an
 * earlier cursor. A valid provider terminal event precedes the final complete scan.
 * A max-duration cut omits `close` so clients reconnect and replay safely.
 */
import { audit, getOrgScopedDb, type CallEvent } from '@dentabill/db';
import { RetellEventSchema } from '@dentabill/payer-ivr';
import { createRedisConnection } from '@dentabill/queue';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getEnv, sseMaxStreamMs } from '../../lib/env.js';

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
          'Live call event stream (Server-Sent Events). Replays all persisted CallEvent rows in bounded pages, then catches up from Postgres with optional Redis wake-up hints. Heartbeat every 15s; closes after terminal call events are drained. See ADR-046.',
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
      await audit({
        action: 'call.events.stream.opened',
        resourceType: 'Call',
        resourceId: call.id,
        organizationId: orgId,
        userId: auth.userId,
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

      const sent = new Set<string>();
      let hasTerminalEvent = false;
      const emit = (event: 'replay' | 'call.event', evt: CallEvent): void => {
        if (sent.has(evt.id)) return;
        if (evt.eventType === 'call.ended' || evt.eventType === 'webhook.call.ended') {
          const parsed = RetellEventSchema.safeParse(evt.data);
          if (
            parsed.success &&
            parsed.data.type === 'call.ended' &&
            parsed.data.retellCallId === call.retellCallId
          ) {
            hasTerminalEvent = true;
          }
        }
        sent.add(evt.id);
        const payload: ReplayPayload = {
          id: evt.id,
          eventType: evt.eventType,
          timestamp: evt.timestamp.toISOString(),
          data: toRecord(evt.data),
        };
        write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      };

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

      request.raw.once('aborted', () => {
        finish(null);
      });
      reply.raw.once('close', () => {
        finish(null);
      });
      reply.raw.once('error', () => {
        finish(null);
      });

      const drain = async (event: 'replay' | 'call.event'): Promise<void> => {
        // Restart each scan: transaction commit order is not timestamp/ID order.
        // A retained high-water cursor would miss late commits behind that cursor.
        let cursor: { timestamp: Date; id: string } | null = null;
        while (!isFinished()) {
          const page: CallEvent[] = await db.callEvent.findMany({
            where: {
              callId: call.id,
              call: { organizationId: orgId },
              ...(cursor === null
                ? {}
                : {
                    OR: [
                      { timestamp: { gt: cursor.timestamp } },
                      { timestamp: cursor.timestamp, id: { gt: cursor.id } },
                    ],
                  }),
            },
            orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
            take: REPLAY_LIMIT,
          });
          for (const evt of page) {
            if (isFinished()) return;
            emit(event, evt);
          }
          const last = page.at(-1);
          if (page.length < REPLAY_LIMIT || !last) return;
          cursor = { timestamp: last.timestamp, id: last.id };
        }
      };

      let replaying = true;
      let draining = false;
      let catchupRequested = false;
      const needsCatchup = (): boolean => catchupRequested;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      teardown.push(() => {
        if (pollTimer !== null) clearTimeout(pollTimer);
      });
      const scheduleCatchup = (delay: number): void => {
        if (isFinished()) return;
        if (replaying || draining) {
          catchupRequested = true;
          return;
        }
        if (pollTimer !== null) clearTimeout(pollTimer);
        pollTimer = setTimeout(() => {
          void catchup();
        }, delay);
      };
      const catchup = async (): Promise<void> => {
        if (isFinished()) return;
        draining = true;
        catchupRequested = false;
        try {
          // A cancellation marker can set FAILED before the remote call ends.
          // Drain a complete scan after observing durable provider termination.
          const terminalBeforeDrain = hasTerminalEvent;
          await drain('call.event');
          if (terminalBeforeDrain && !isFinished()) finish('call_ended');
        } catch {
          request.log.warn({ callId: call.id }, 'sse: catch-up failed; retrying');
        } finally {
          draining = false;
          scheduleCatchup(needsCatchup() ? 0 : env.SSE_POLL_INTERVAL_MS);
        }
      };

      if (env.REDIS_URL) {
        const subscriber = createRedisConnection(env.REDIS_URL, { lazyConnect: false });
        const channel = `call:${call.retellCallId}:events`;
        const onMessage = (incoming: string): void => {
          if (incoming === channel) scheduleCatchup(0);
        };
        subscriber.on('message', onMessage);
        teardown.push(() => {
          subscriber.off('message', onMessage);
          subscriber.disconnect();
        });
        // Start subscription before replay. DB polling also covers an unavailable
        // Redis connection, dropped hints, and messages during subscription setup.
        void subscriber.subscribe(channel).catch(() => {
          if (!isFinished())
            request.log.warn({ callId: call.id }, 'sse: subscribe failed; using database catch-up');
        });
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

      try {
        await drain('replay');
        if (!isFinished()) {
          write('event: replay-end\ndata: {}\n\n');
          replaying = false;
          scheduleCatchup(0);
        }
      } catch {
        request.log.warn({ callId: call.id }, 'sse: replay failed; reconnect required');
        finish(null);
      }

      await done;
    },
  );
}

function toRecord(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}
