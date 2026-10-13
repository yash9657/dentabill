import {
  type CallsQueue,
  createBullMqJobDispatcher,
  createCallsQueue,
  createInlineJobDispatcher,
  createRedisConnection,
  createSqsJobDispatcher,
  createSummariesQueue,
  type JobDispatcher,
  type JobDispatchMode,
  type SummariesQueue,
} from '@dentabill/queue';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

import { runInBackground } from '../lib/background.js';

/**
 * Wires job dispatch (ADR-053) and the shared Redis connection onto the
 * Fastify instance so route handlers never own Redis lifecycle.
 *
 *   - `bullmq` mode: singleton BullMQ `calls` / `summaries` queues on one
 *     lazily-connected ioredis client, wrapped by the BullMQ dispatcher.
 *     Closed in `onClose` so tests and SIGTERM-driven shutdowns drain.
 *   - `inline` mode: NO queues and NO workers are created. The dispatcher
 *     POSTs jobs to `/v1/internal/jobs/*`. Redis is opened only when
 *     `REDIS_URL` is set (SSE pub/sub + readiness); otherwise every Redis
 *     surface is `null` and its consumers fall back (see ADR-053).
 *   - `sqs` mode: NO queues and NO workers either. The dispatcher sends
 *     each job to the SQS queue at `JOBS_QUEUE_URL`; the worker Lambda
 *     consumes it. Nothing runs after the response (no `waitUntil`), which
 *     matters on Lambda, where the process is frozen between requests.
 *     Redis is optional exactly as in `inline` mode.
 *
 * In `NODE_ENV === 'test'` the plugin installs no-op stub queues behind a
 * BullMQ dispatcher instead. Tests that exercise enqueue paths replace
 * `server.callsQueue.add` / `server.summariesQueue.add` with a `vi.fn()`
 * spy, which the dispatcher picks up at dispatch time.
 */
declare module 'fastify' {
  interface FastifyInstance {
    /** Producer surface for every job. Routes MUST use this, not the queues. */
    jobDispatcher: JobDispatcher;
    /**
     * Raw BullMQ queues backing the `bullmq` dispatcher. In `inline` / `sqs`
     * mode (and under test) these are stubs whose `add` throws.
     */
    callsQueue: CallsQueue;
    summariesQueue: SummariesQueue;
    /** Shared ioredis client; `null` when Redis is not configured or under test. */
    queueRedis: Redis | null;
    /**
     * Dedicated Redis publisher for the SSE pub/sub bus (ADR-046).
     * Re-uses the shared Redis connection — ioredis pub/sub is on
     * the same socket as `LPUSH` etc., and the channel namespace
     * (`call:*:events`) does not collide with BullMQ keys.
     * `null` when Redis is not configured (publishing becomes a no-op).
     */
    callEventsPublisher: Redis | null;
  }
}

export interface RegisterQueuePluginInput {
  readonly redisUrl: string | undefined;
  readonly mode: JobDispatchMode;
  /** Required in `inline` mode. */
  readonly inline?: {
    readonly baseUrl: string;
    readonly secret: string;
    /** Extra headers on the internal trigger (e.g. Vercel protection bypass). */
    readonly headers?: Readonly<Record<string, string>>;
  };
  /** Required in `sqs` mode. */
  readonly sqs?: {
    readonly queueUrl: string;
  };
  /** Override the test detection (default: `NODE_ENV === 'test'`). */
  readonly stubInTest?: boolean;
}

function stubQueues(reason: string): { calls: CallsQueue; summaries: SummariesQueue } {
  const calls = {
    add: (): never => {
      throw new Error(`callsQueue.add called on stub — ${reason}`);
    },
    close: (): Promise<void> => Promise.resolve(),
  } as unknown as CallsQueue;
  const summaries = {
    add: (): never => {
      throw new Error(`summariesQueue.add called on stub — ${reason}`);
    },
    close: (): Promise<void> => Promise.resolve(),
  } as unknown as SummariesQueue;
  return { calls, summaries };
}

export function registerQueuePlugin(
  fastify: FastifyInstance,
  input: RegisterQueuePluginInput,
): void {
  const stub = input.stubInTest ?? process.env.NODE_ENV === 'test';
  if (stub) {
    // Minimal stub matching the surface route handlers actually call.
    // Anything else throws so a missing test setup is loud, not silent.
    const { calls, summaries } = stubQueues('replace with a vi.fn() spy in tests.');
    fastify.decorate('callsQueue', calls);
    fastify.decorate('summariesQueue', summaries);
    fastify.decorate(
      'jobDispatcher',
      createBullMqJobDispatcher({ callsQueue: calls, summariesQueue: summaries }),
    );
    fastify.decorate('queueRedis', null);
    fastify.decorate('callEventsPublisher', null);
    return;
  }

  const connection = input.redisUrl
    ? createRedisConnection(input.redisUrl, { lazyConnect: true })
    : null;
  fastify.decorate('queueRedis', connection);
  fastify.decorate('callEventsPublisher', connection);

  if (input.mode === 'bullmq') {
    if (connection === null) throw new Error('JOB_DISPATCH_MODE=bullmq requires REDIS_URL');
    const callsQueue = createCallsQueue({ connection });
    const summariesQueue = createSummariesQueue({ connection });
    fastify.decorate('callsQueue', callsQueue);
    fastify.decorate('summariesQueue', summariesQueue);
    fastify.decorate('jobDispatcher', createBullMqJobDispatcher({ callsQueue, summariesQueue }));
    fastify.addHook('onClose', async () => {
      await callsQueue.close();
      await summariesQueue.close();
      connection.disconnect();
    });
    return;
  }

  if (input.mode === 'sqs') {
    if (!input.sqs) throw new Error('JOB_DISPATCH_MODE=sqs requires JOBS_QUEUE_URL');
    const { calls, summaries } = stubQueues('JOB_DISPATCH_MODE=sqs has no BullMQ queues.');
    fastify.decorate('callsQueue', calls);
    fastify.decorate('summariesQueue', summaries);
    fastify.decorate(
      'jobDispatcher',
      createSqsJobDispatcher({
        queueUrl: input.sqs.queueUrl,
        onDelayClamped: (ctx) => {
          fastify.log.warn(ctx, 'sqs job delay clamped to the 900 s SQS maximum');
        },
      }),
    );
    if (connection !== null) {
      fastify.addHook('onClose', () => {
        connection.disconnect();
      });
    }
    return;
  }

  if (!input.inline) throw new Error('JOB_DISPATCH_MODE=inline requires inline dispatcher config');
  const { calls, summaries } = stubQueues('JOB_DISPATCH_MODE=inline has no BullMQ queues.');
  fastify.decorate('callsQueue', calls);
  fastify.decorate('summariesQueue', summaries);
  fastify.decorate(
    'jobDispatcher',
    createInlineJobDispatcher({
      baseUrl: input.inline.baseUrl,
      secret: input.inline.secret,
      ...(input.inline.headers && { headers: input.inline.headers }),
      waitUntil: runInBackground,
      onTriggerError: (err, ctx) => {
        fastify.log.error(
          { ...ctx, err: err instanceof Error ? { message: err.message, name: err.name } : err },
          'inline job trigger failed — job was not started',
        );
      },
    }),
  );
  if (connection !== null) {
    fastify.addHook('onClose', () => {
      connection.disconnect();
    });
  }
}
