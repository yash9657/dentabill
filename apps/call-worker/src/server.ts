import { createLogger, type Logger } from '@dentabill/logger';
import { type CallsWorker, createCallsWorker, createRedisConnection } from '@dentabill/queue';
import type { Redis } from 'ioredis';

import { loadWorkerEnv, type WorkerEnv } from './env.js';
import { startHealthServer, type HealthServerHandle } from './health.js';
import { createStubProcessor } from './processor.js';

/**
 * Boot the call-worker (P3-T9 — wiring only). P3-T10 swaps the stub
 * processor for the real Retell-driven handler.
 *
 * Lifecycle:
 *   1. `loadWorkerEnv` — fail fast on bad config.
 *   2. Open the Redis connection (eager — production worker needs the
 *      connection ready before signalling healthy).
 *   3. Build the BullMQ Worker bound to the `calls` queue with the
 *      stub processor.
 *   4. Start the `/healthz` HTTP server on `WORKER_PORT`.
 *   5. Wait for SIGTERM / SIGINT and run the graceful drain.
 *
 * The shutdown sequence:
 *   - mark health server as draining (probe returns 503 → traffic
 *     routes away from this instance);
 *   - call `worker.close()` which waits for in-flight jobs to finish
 *     up to BullMQ's lock duration;
 *   - close the Redis connection;
 *   - close the health server;
 *   - resolve the returned promise so callers (or the test harness)
 *     can assert the shutdown completed.
 */
export interface BootCallWorkerOptions {
  /** Override env loader (testing seam). */
  readonly env?: WorkerEnv;
  /** Override logger (testing seam). */
  readonly logger?: Logger;
}

export interface CallWorkerHandle {
  readonly env: WorkerEnv;
  readonly logger: Logger;
  readonly worker: CallsWorker;
  readonly health: HealthServerHandle;
  readonly connection: Redis;
  /** Run the graceful shutdown sequence. Idempotent. */
  readonly shutdown: () => Promise<void>;
}

export async function bootCallWorker(
  options: BootCallWorkerOptions = {},
): Promise<CallWorkerHandle> {
  const env = options.env ?? loadWorkerEnv();
  const logger =
    options.logger ?? createLogger({ base: { service: 'call-worker', env: env.NODE_ENV } });

  logger.info({ port: env.WORKER_PORT, concurrency: env.QUEUE_CONCURRENCY }, 'booting call-worker');

  const connection = createRedisConnection(env.REDIS_URL, { lazyConnect: false });
  await connection.ping();

  const worker = createCallsWorker({
    connection,
    concurrency: env.QUEUE_CONCURRENCY,
    processor: createStubProcessor({ logger }),
  });

  worker.on('failed', (job, err) => {
    logger.error(
      {
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err: { message: err.message, name: err.name },
      },
      'call-worker job failed',
    );
  });
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, attemptsMade: job.attemptsMade }, 'call-worker job completed');
  });

  const health = startHealthServer({ port: env.WORKER_PORT, logger });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('call-worker shutdown initiated');
    health.setDraining(true);
    try {
      await worker.close();
    } catch (err) {
      logger.error({ err }, 'error closing BullMQ worker — continuing shutdown');
    }
    try {
      connection.disconnect();
    } catch (err) {
      logger.error({ err }, 'error disconnecting Redis — continuing shutdown');
    }
    try {
      await health.close();
    } catch (err) {
      logger.error({ err }, 'error closing health server');
    }
    logger.info('call-worker shutdown complete');
  };

  return { env, logger, worker, health, connection, shutdown };
}

/**
 * Process-level entrypoint used by `pnpm --filter call-worker dev / start`.
 * Wires SIGTERM + SIGINT to `shutdown` and exits 0 on clean drain.
 */
export async function runCallWorker(): Promise<void> {
  const handle = await bootCallWorker();
  const onSignal = (signal: NodeJS.Signals): void => {
    handle.logger.info({ signal }, 'call-worker received signal');
    void handle.shutdown().then(() => process.exit(0));
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
