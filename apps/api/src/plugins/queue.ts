import { type CallsQueue, createCallsQueue, createRedisConnection } from '@dentabill/queue';
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
    queueRedis: Redis | null;
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
    fastify.decorate('callsQueue', stubQueue);
    fastify.decorate('queueRedis', null);
    return;
  }

  const connection = createRedisConnection(input.redisUrl, { lazyConnect: true });
  const queue = createCallsQueue({ connection });
  fastify.decorate('callsQueue', queue);
  fastify.decorate('queueRedis', connection);

  fastify.addHook('onClose', async () => {
    await queue.close();
    connection.disconnect();
  });
}
