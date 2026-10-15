import { prisma } from '@dentabill/db';
import { createLogger, type Logger } from '@dentabill/logger';
import {
  type SummariesWorker,
  createSummariesWorker,
  createRedisConnection,
} from '@dentabill/queue';
import type { SummarizerPort } from '@dentabill/summarizer';
import type { Redis } from 'ioredis';

import { loadSummaryWorkerEnv, type SummaryWorkerEnv } from './env.js';
import { createSummaryJobHandler, type DbClient } from './handler.js';
import { startHealthServer, type HealthServerHandle } from './health.js';
import type { ObservationJobConfig } from './observation-handler.js';
import { createRuntimeSummarizer } from './runtime-summarizer.js';

/**
 * Boot the summary-worker. Mirrors `apps/call-worker/src/server.ts`:
 * env load → Redis connect → BullMQ Worker → /healthz → graceful drain.
 *
 * Persisted review outcomes complete delivery after their effects commit.
 * BUSY work and database failures throw for BullMQ backoff/redrive. A
 * provider attempt whose result is unknown remains reserved for review;
 * another delivery never submits that inference again.
 */

export interface BootSummaryWorkerOptions {
  readonly env?: SummaryWorkerEnv;
  readonly logger?: Logger;
  readonly prisma?: DbClient;
  readonly summarizer?: SummarizerPort;
  readonly observationConfig?: ObservationJobConfig;
}

export interface SummaryWorkerHandle {
  readonly env: SummaryWorkerEnv;
  readonly logger: Logger;
  readonly worker: SummariesWorker;
  readonly health: HealthServerHandle;
  readonly connection: Redis;
  readonly summarizer: SummarizerPort;
  readonly shutdown: () => Promise<void>;
}

export async function bootSummaryWorker(
  options: BootSummaryWorkerOptions = {},
): Promise<SummaryWorkerHandle> {
  const env = options.env ?? loadSummaryWorkerEnv();
  const logger =
    options.logger ?? createLogger({ base: { service: 'summary-worker', env: env.NODE_ENV } });

  logger.info(
    { port: env.WORKER_PORT, concurrency: env.QUEUE_CONCURRENCY },
    'booting summary-worker',
  );

  const connection = createRedisConnection(env.REDIS_URL, { lazyConnect: false });
  await connection.ping();

  const prismaClient = options.prisma ?? prisma;
  const summarizer = options.summarizer ?? createRuntimeSummarizer(env);
  const worker = createSummariesWorker({
    connection,
    concurrency: env.QUEUE_CONCURRENCY,
    processor: createSummaryJobHandler({
      logger,
      prisma: prismaClient,
      summarizer,
      env,
      ...(options.observationConfig ? { observationConfig: options.observationConfig } : {}),
    }),
  });

  worker.on('failed', (job) => {
    logger.error(
      {
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        code: 'SUMMARY_DELIVERY_UNCONFIRMED',
      },
      'summary-worker job failed',
    );
  });
  worker.on('completed', (job, result) => {
    logger.info(
      { jobId: job.id, outcome: result.outcome, tokensUsed: result.tokensUsed },
      'summary-worker job completed',
    );
  });

  const health = startHealthServer({ port: env.WORKER_PORT, logger });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('summary-worker shutdown initiated');
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
    logger.info('summary-worker shutdown complete');
  };

  return { env, logger, worker, health, connection, summarizer, shutdown };
}

export async function runSummaryWorker(): Promise<void> {
  const handle = await bootSummaryWorker();
  const onSignal = (signal: NodeJS.Signals): void => {
    handle.logger.info({ signal }, 'summary-worker received signal');
    void handle.shutdown().then(() => process.exit(0));
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
