import { prisma } from '@dentabill/db';
import { createLogger, type Logger } from '@dentabill/logger';
import { createRetellPort, type RetellPort } from '@dentabill/payer-ivr';
import {
  createCallsWorker,
  createRedisConnection,
  createSummariesQueue,
  type CallsWorker,
  type SummariesQueue,
} from '@dentabill/queue';
import type { Redis } from 'ioredis';

import { createDlqJobHandler, createDlqWorker, type DlqWorker } from './dlq-consumer.js';
import { loadWorkerEnv, type WorkerEnv } from './env.js';
import { createCallJobHandler, type DbClient } from './handler.js';
import { startHealthServer, type HealthServerHandle } from './health.js';

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
  /** Override Prisma client (testing seam — defaults to the singleton). */
  readonly prisma?: DbClient;
  /**
   * Override RetellPort. Defaults to `createRetellPort({ apiKey: env.RETELL_API_KEY })`
   * which selects LiveRetell or FakeRetell automatically.
   */
  readonly retellPort?: RetellPort;
}

export interface CallWorkerHandle {
  readonly env: WorkerEnv;
  readonly logger: Logger;
  readonly worker: CallsWorker;
  readonly dlqWorker: DlqWorker;
  readonly health: HealthServerHandle;
  readonly connection: Redis;
  readonly retellPort: RetellPort;
  /** Phase 4 — fan-out queue for post-call summarisation (P4-T2G). */
  readonly summariesQueue: SummariesQueue;
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

  const prismaClient = options.prisma ?? prisma;
  const retellPort =
    options.retellPort ??
    createRetellPort({
      apiKey: env.RETELL_API_KEY,
      demoAutopilot: env.DEMO_AUTOPILOT === 'true',
    }).port;
  const summariesQueue = createSummariesQueue({ connection });

  const worker = createCallsWorker({
    connection,
    concurrency: env.QUEUE_CONCURRENCY,
    processor: createCallJobHandler({
      logger,
      prisma: prismaClient,
      retellPort,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
      summariesQueue,
    }),
  });

  // DLQ consumer (P3-T14) — runs in the same process so a single
  // deploy unit covers both queues. Concurrency is capped at 1 to keep
  // DB write pressure predictable; failed DLQ runs are not retried
  // (the DLQ queue's `attempts: 1` policy in @dentabill/queue).
  const dlqWorker = createDlqWorker({
    connection,
    concurrency: 1,
    processor: createDlqJobHandler({ logger, prisma: prismaClient }),
  });
  dlqWorker.on('failed', (job, err) => {
    logger.error(
      {
        dlqJobId: job?.id,
        err: { message: err.message, name: err.name },
      },
      'dlq-worker job failed — manual recovery may be required',
    );
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
      await dlqWorker.close();
    } catch (err) {
      logger.error({ err }, 'error closing DLQ worker — continuing shutdown');
    }
    try {
      await summariesQueue.close();
    } catch (err) {
      logger.error({ err }, 'error closing summaries queue — continuing shutdown');
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

  return {
    env,
    logger,
    worker,
    dlqWorker,
    health,
    connection,
    retellPort,
    summariesQueue,
    shutdown,
  };
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
