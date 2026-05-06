import { prisma } from '@dentabill/db';
import { createLogger, type Logger } from '@dentabill/logger';
import { createNotifierPort, type NotifierPort } from '@dentabill/notifier';
import {
  type SummariesWorker,
  createSummariesWorker,
  createRedisConnection,
} from '@dentabill/queue';
import { createSummarizerPort, type SummarizerPort } from '@dentabill/summarizer';
import type { Redis } from 'ioredis';

import { loadSummaryWorkerEnv, type SummaryWorkerEnv } from './env.js';
import { createSummaryJobHandler, type DbClient } from './handler.js';
import { startHealthServer, type HealthServerHandle } from './health.js';

/**
 * Boot the summary-worker. Mirrors `apps/call-worker/src/server.ts`:
 * env load → Redis connect → BullMQ Worker → /healthz → graceful drain.
 *
 * Failure modes routed to MANUAL_REVIEW are not retried (the handler
 * returns instead of throwing). Retryable failures (Anthropic 5xx,
 * Postgres lock contention) throw and BullMQ's exponential backoff
 * picks them up.
 */

export interface BootSummaryWorkerOptions {
  readonly env?: SummaryWorkerEnv;
  readonly logger?: Logger;
  readonly prisma?: DbClient;
  readonly summarizer?: SummarizerPort;
  readonly notifier?: NotifierPort;
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
  const summarizer =
    options.summarizer ??
    createSummarizerPort({
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      maxOutputTokens: env.SUMMARIZER_MAX_OUTPUT_TOKENS,
    }).summarizer;
  // Phase 4 ships FakeResend only — the live adapter throws on
  // construction with a key. Phase 4.5 swaps in LiveResend.
  const notifier = options.notifier ?? createNotifierPort({}).notifier;

  const resolveRecipient = async (organizationId: string): Promise<string | null> => {
    const owner = await prismaClient.user.findFirst({
      where: { organizationId, role: { in: ['OWNER', 'ADMIN'] } },
      orderBy: { createdAt: 'asc' },
      select: { email: true },
    });
    return owner?.email ?? null;
  };

  const worker = createSummariesWorker({
    connection,
    concurrency: env.QUEUE_CONCURRENCY,
    processor: createSummaryJobHandler({
      logger,
      prisma: prismaClient,
      redis: connection,
      summarizer,
      env,
      notifier,
      resolveRecipient,
    }),
  });

  worker.on('failed', (job, err) => {
    logger.error(
      {
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err: { message: err.message, name: err.name },
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
