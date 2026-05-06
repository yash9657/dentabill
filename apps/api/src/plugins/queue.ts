import {
  type CallsQueue,
  createCallsQueue,
  createRedisConnection,
  createSummariesQueue,
  type SummariesQueue,
} from '@dentabill/queue';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

/**
 * Wires a singleton BullMQ `calls` queue onto the Fastify instance so
 * route handlers can enqueue jobs without owning Redis lifecycle. The
 * queue and the underlying Redis connection are closed during
 * `fastify.close()` (registered via `onClose`) so test harnesses and
 * SIGTERM-driven prod shutdowns drain cleanly.
 *
 * In `NODE_ENV === 'test'` the plugin installs a no-op stub instead of
 * a real BullMQ queue. `vitest.setup.ts` defaults `REDIS_URL` to
 * `redis://localhost:6379` for shape validation, but the test harness
 * uses `server.inject()` and never wants a real Redis socket. Tests
 * that exercise enqueue paths replace `server.callsQueue.add` with a
 * `vi.fn()` spy.
 */
declare module 'fastify' {
  interface FastifyInstance {
    callsQueue: CallsQueue;
    summariesQueue: SummariesQueue;
    queueRedis: Redis | null;
    /**
     * Dedicated Redis publisher for the SSE pub/sub bus (ADR-046).
     * Re-uses the BullMQ Redis connection — ioredis pub/sub is on
     * the same socket as `LPUSH` etc., and the channel namespace
     * (`call:*:events`) does not collide with BullMQ keys.
     * `null` in the test stub.
     */
    callEventsPublisher: Redis | null;
  }
}

export interface RegisterQueuePluginInput {
  readonly redisUrl: string;
  /** Override the test detection (default: `NODE_ENV === 'test'`). */
  readonly stubInTest?: boolean;
}

export function registerQueuePlugin(
  fastify: FastifyInstance,
  input: RegisterQueuePluginInput,
): void {
  const stub = input.stubInTest ?? process.env.NODE_ENV === 'test';
  if (stub) {
    // Minimal stub matching the surface route handlers actually call.
    // Anything else throws so a missing test setup is loud, not silent.
    const stubQueue = {
      add: (): never => {
        throw new Error('callsQueue.add called on stub — replace with a vi.fn() spy in tests.');
      },
      close: (): Promise<void> => Promise.resolve(),
    } as unknown as CallsQueue;
    const stubSummariesQueue = {
      add: (): never => {
        throw new Error('summariesQueue.add called on stub — replace with a vi.fn() spy in tests.');
      },
      close: (): Promise<void> => Promise.resolve(),
    } as unknown as SummariesQueue;
    fastify.decorate('callsQueue', stubQueue);
    fastify.decorate('summariesQueue', stubSummariesQueue);
    fastify.decorate('queueRedis', null);
    fastify.decorate('callEventsPublisher', null);
    return;
  }

  const connection = createRedisConnection(input.redisUrl, { lazyConnect: true });
  const queue = createCallsQueue({ connection });
  const summariesQueue = createSummariesQueue({ connection });
  fastify.decorate('callsQueue', queue);
  fastify.decorate('summariesQueue', summariesQueue);
  fastify.decorate('queueRedis', connection);
  fastify.decorate('callEventsPublisher', connection);

  fastify.addHook('onClose', async () => {
    await queue.close();
    await summariesQueue.close();
    connection.disconnect();
  });
}
