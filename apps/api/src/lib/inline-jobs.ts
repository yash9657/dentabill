/**
 * Inline job runtime (ADR-053) — runs the call / summary processors inside
 * the API process instead of the always-on BullMQ workers.
 *
 * The processors themselves are reused unchanged from the worker packages
 * (`createCallJobHandler`, `createSummaryJobHandler`, `createDlqJobHandler`);
 * this module only supplies what BullMQ used to: a Job-shaped object, the
 * retry policy, duplicate suppression, and the terminal DLQ hand-off.
 */
import { createCallJobHandler, createDlqJobHandler, loadWorkerEnv } from '@dentabill/call-worker';
import { prisma as defaultPrisma } from '@dentabill/db';
import { createLogger, type Logger } from '@dentabill/logger';
import { createRetellPort, type RetellPort } from '@dentabill/payer-ivr';
import {
  asBullMqJob,
  CALL_JOB_NAME,
  type CallJobData,
  CALLS_DEFAULT_JOB_OPTIONS,
  DLQ_JOB_NAME,
  DLQ_REASONS,
  type DlqJobData,
  type JobDispatcher,
  runInlineJob,
  type RunInlineJobOptions,
  SUMMARIES_DEFAULT_JOB_OPTIONS,
  SUMMARY_JOB_NAME,
  type SummaryJobData,
} from '@dentabill/queue';
import { createSummarizerPort, type SummarizerPort } from '@dentabill/summarizer';
import {
  type CostGuard,
  createInMemoryCostGuard,
  createRedisCostGuard,
  createSummaryJobHandler,
  loadSummaryWorkerEnv,
} from '@dentabill/summary-worker';
import type { Redis } from 'ioredis';

type DbClient = typeof defaultPrisma;
type JobOptions = RunInlineJobOptions<unknown, unknown>['jobOptions'];

/**
 * Wall-clock budget for one job's attempts + backoff sleeps: Vercel Pro's
 * 800 s maxDuration minus a margin for the DLQ hand-off and response flush.
 */
export const INLINE_JOB_BUDGET_MS = 760_000;

/**
 * The worker env loaders require `REDIS_URL` because the worker processes
 * connect to BullMQ. The handlers never read it, so in no-Redis inline mode
 * we satisfy the schema with an unroutable placeholder rather than widen
 * the worker contract.
 */
const UNUSED_REDIS_URL = 'redis://redis-not-configured.invalid:6379';

/** Rescheduled attempts (hold-detector) carry `-r<n>`; see resolveHoldBreach. */
const RESCHEDULE_KEY = /-r\d+$/;
/** Operator-initiated summary retries carry `.retry.<n>`; see POST /calls/:id/summary/retry. */
const SUMMARY_RETRY_KEY = /\.retry\.\d+$/;

export type InlineRunReport =
  | { readonly status: 'completed'; readonly attemptsMade: number }
  | { readonly status: 'skipped'; readonly reason: string }
  | {
      readonly status: 'failed';
      readonly attemptsMade: number;
      readonly budgetExhausted: boolean;
      readonly dlq: boolean;
    };

export interface InlineJobRuntime {
  runCall(data: CallJobData): Promise<InlineRunReport>;
  runSummary(data: SummaryJobData): Promise<InlineRunReport>;
}

export interface CreateInlineJobRuntimeDeps {
  readonly jobDispatcher: JobDispatcher;
  /** Shared Redis for the summary cost guard; `null` → process-local guard. */
  readonly redis: Redis | null;
  readonly logger?: Logger;
  readonly prisma?: DbClient;
  readonly env?: NodeJS.ProcessEnv;
  /** Test seams. */
  readonly retellPort?: RetellPort;
  readonly summarizer?: SummarizerPort;
  readonly costGuard?: CostGuard;
  readonly callJobOptions?: JobOptions;
  readonly summaryJobOptions?: JobOptions;
  readonly budgetMs?: number;
  readonly sleep?: RunInlineJobOptions<unknown, unknown>['sleep'];
}

export function createInlineJobRuntime(deps: CreateInlineJobRuntimeDeps): InlineJobRuntime {
  const rawEnv = deps.env ?? process.env;
  const redisUrl =
    rawEnv.REDIS_URL !== undefined && rawEnv.REDIS_URL.length > 0
      ? rawEnv.REDIS_URL
      : UNUSED_REDIS_URL;
  const envWithRedis = { ...rawEnv, REDIS_URL: redisUrl };
  const callEnv = loadWorkerEnv(envWithRedis);
  const summaryEnv = loadSummaryWorkerEnv(envWithRedis);
  const logger =
    deps.logger ?? createLogger({ base: { service: 'inline-jobs', env: callEnv.NODE_ENV } });
  const prisma = deps.prisma ?? defaultPrisma;
  const budgetMs = deps.budgetMs ?? INLINE_JOB_BUDGET_MS;

  const retellPort =
    deps.retellPort ??
    createRetellPort({
      apiKey: callEnv.RETELL_API_KEY,
      demoAutopilot: callEnv.DEMO_AUTOPILOT === 'true',
    }).port;
  const summarizer =
    deps.summarizer ??
    createSummarizerPort({
      anthropicApiKey: summaryEnv.ANTHROPIC_API_KEY,
      maxOutputTokens: summaryEnv.SUMMARIZER_MAX_OUTPUT_TOKENS,
      deriveWhenUnregistered: summaryEnv.DEMO_SUMMARIZER_FALLBACK === 'true',
    }).summarizer;
  const costGuard =
    deps.costGuard ?? (deps.redis ? createRedisCostGuard(deps.redis) : createInMemoryCostGuard());

  const callHandler = createCallJobHandler({
    logger,
    prisma,
    retellPort,
    env: callEnv,
    outboundNumberE164: callEnv.WORKER_OUTBOUND_NUMBER,
    jobDispatcher: deps.jobDispatcher,
  });
  const dlqHandler = createDlqJobHandler({ logger, prisma });
  const summaryHandler = createSummaryJobHandler({
    logger,
    prisma,
    costGuard,
    summarizer,
    env: summaryEnv,
  });

  const errInfo = (err: unknown): unknown =>
    err instanceof Error ? { message: err.message, name: err.name } : err;

  return {
    async runCall(data): Promise<InlineRunReport> {
      const jobId = data.idempotencyKey;
      // Duplicate suppression. BullMQ collapsed duplicate jobIds in Redis;
      // here the claim row is the lease: the enqueue route flips the claim
      // to IN_QUEUE, and exactly one trigger can move it IN_QUEUE → CALLING.
      // A replayed or doubled trigger finds it already CALLING and stops.
      // Hold-detector reschedules run while the claim is CALLING and carry
      // a deterministic `-r<n>` key, so they bypass the lease.
      if (!RESCHEDULE_KEY.test(jobId)) {
        const lease = await prisma.claim.updateMany({
          where: { id: data.claimId, organizationId: data.organizationId, status: 'IN_QUEUE' },
          data: { status: 'CALLING' },
        });
        if (lease.count === 0) {
          logger.warn(
            { jobId, claimId: data.claimId },
            'inline call job skipped — claim is not IN_QUEUE (duplicate or stale trigger)',
          );
          return { status: 'skipped', reason: 'claim_not_in_queue' };
        }
      }

      const outcome = await runInlineJob({
        id: jobId,
        name: CALL_JOB_NAME,
        data,
        jobOptions: deps.callJobOptions ?? CALLS_DEFAULT_JOB_OPTIONS,
        budgetMs,
        ...(deps.sleep && { sleep: deps.sleep }),
        process: (job) => callHandler(asBullMqJob(job)),
        onAttemptFailed: (err, attemptsMade) => {
          logger.error(
            { jobId, attemptsMade, err: errInfo(err) },
            'inline call job attempt failed',
          );
        },
      });
      if (outcome.status === 'completed') {
        logger.info({ jobId, attemptsMade: outcome.attemptsMade }, 'inline call job completed');
        return { status: 'completed', attemptsMade: outcome.attemptsMade };
      }

      // Terminal failure → the same escalation the DLQ consumer performs
      // for `calls-dlq`, invoked directly (there is no DLQ queue here).
      const dlqData: DlqJobData = {
        originalJobId: jobId,
        originalQueueName: 'calls',
        originalJobName: CALL_JOB_NAME,
        originalData: data,
        reason: DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS,
        attemptsMade: outcome.attemptsMade,
        enqueuedAt: new Date().toISOString(),
        ...(outcome.error instanceof Error && { failedReason: outcome.error.message }),
      };
      let dlq = false;
      try {
        await dlqHandler(
          asBullMqJob({ id: jobId, name: DLQ_JOB_NAME, data: dlqData, attemptsMade: 0 }),
        );
        dlq = true;
      } catch (err) {
        logger.error(
          { jobId, err: errInfo(err) },
          'inline DLQ handling failed — manual recovery required',
        );
      }
      return {
        status: 'failed',
        attemptsMade: outcome.attemptsMade,
        budgetExhausted: outcome.budgetExhausted,
        dlq,
      };
    },

    async runSummary(data): Promise<InlineRunReport> {
      const jobId = data.idempotencyKey;
      // `CallSummary.callId` is UNIQUE, so a second run for the same call
      // can only fail. Skip duplicates of the automatic `call.<id>` job;
      // operator retries (`.retry.<n>`) keep their BullMQ-era behaviour.
      if (!SUMMARY_RETRY_KEY.test(jobId)) {
        const existing = await prisma.callSummary.findFirst({
          where: { callId: data.callId, organizationId: data.organizationId },
          select: { id: true },
        });
        if (existing) {
          logger.warn(
            { jobId, callId: data.callId },
            'inline summary job skipped — summary exists',
          );
          return { status: 'skipped', reason: 'summary_exists' };
        }
      }

      const outcome = await runInlineJob({
        id: jobId,
        name: SUMMARY_JOB_NAME,
        data,
        jobOptions: deps.summaryJobOptions ?? SUMMARIES_DEFAULT_JOB_OPTIONS,
        budgetMs,
        ...(deps.sleep && { sleep: deps.sleep }),
        process: (job) => summaryHandler(job),
        onAttemptFailed: (err, attemptsMade) => {
          logger.error(
            { jobId, attemptsMade, err: errInfo(err) },
            'inline summary job attempt failed',
          );
        },
      });
      if (outcome.status === 'completed') {
        logger.info(
          { jobId, attemptsMade: outcome.attemptsMade, outcome: outcome.result.outcome },
          'inline summary job completed',
        );
        return { status: 'completed', attemptsMade: outcome.attemptsMade };
      }
      // Parity with BullMQ mode, which has no summaries DLQ consumer: the
      // failure is logged and the operator retries via
      // POST /v1/calls/:id/summary/retry.
      logger.error(
        { jobId, attemptsMade: outcome.attemptsMade, err: errInfo(outcome.error) },
        'inline summary job failed after retries',
      );
      return {
        status: 'failed',
        attemptsMade: outcome.attemptsMade,
        budgetExhausted: outcome.budgetExhausted,
        dlq: false,
      };
    },
  };
}
