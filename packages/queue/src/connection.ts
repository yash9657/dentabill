import { Redis, type RedisOptions } from 'ioredis';

/**
 * BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
 * on the underlying ioredis connection. Workers and `QueueEvents` block on
 * long-lived `BRPOPLPUSH` / `XREAD` commands; ioredis's default per-request
 * retry counter would error those out spuriously after a few seconds of
 * idle time, producing noisy log spam and dropped jobs.
 *
 * `lazyConnect: true` is the default we use everywhere except production
 * worker bootstrap — it lets factory tests construct queues without
 * opening a real socket.
 */
export interface CreateRedisConnectionOptions extends RedisOptions {
  /** Defaults to `true`. Production worker bootstrap explicitly opts in. */
  lazyConnect?: boolean;
}

export function createRedisConnection(
  redisUrl: string,
  options: CreateRedisConnectionOptions = {},
): Redis {
  const { lazyConnect = true, ...rest } = options;
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect,
    ...rest,
  });
}
