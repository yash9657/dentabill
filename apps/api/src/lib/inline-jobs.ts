/**
 * Inline job runtime (ADR-053) — runs the call / summary processors inside
 * the API process instead of the always-on BullMQ workers.
 *
 * The processors themselves are reused unchanged from the worker packages
 * (`createCallJobHandler`, `createSummaryJobHandler`, `createDlqJobHandler`);
 * this module only supplies what BullMQ used to: a Job-shaped object, the
 * retry policy, duplicate suppression, and the terminal DLQ hand-off.
 */
import {
  createCallJobHandler,
  createDlqJobHandler,
  loadWorkerEnv,
  MissingCallIdentityError,
} from '@dentabill/call-worker';
import { prisma as defaultPrisma } from '@dentabill/db';
import { createLogger, type Logger } from '@dentabill/logger';
import {
  createRetellPort,
  type MissingCallIdentityField,
  type RetellPort,
} from '@dentabill/payer-ivr';
import {
  asBullMqJob,
  CALL_JOB_NAME,
  computeBackoffMs,
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
      readonly status: 'blocked';
      readonly reason: 'MISSING_CALL_IDENTITY';
      readonly missingFields: readonly MissingCallIdentityField[];
      readonly attemptsMade: number;
    }
  | {
      readonly status: 'failed';
      readonly attemptsMade: number;
      readonly budgetExhausted: boolean;
      readonly dlq: boolean;
    };

/**
 * One delivery of a job by an external queue (SQS) that owns the retry
 * policy. `attempt` is 1-based (SQS `ApproximateReceiveCount`).
 */
export interface JobAttempt {
  readonly attempt: number;
  /** Deliveries after which the job is treated as exhausted (SQS `maxReceiveCount`). */
  readonly maxAttempts: number;
}

export type AttemptReport =
  | { readonly status: 'completed'; readonly attempt: number }
  | { readonly status: 'skipped'; readonly reason: string }
  | {
      readonly status: 'blocked';
      readonly reason: 'MISSING_CALL_IDENTITY';
      readonly missingFields: readonly MissingCallIdentityField[];
      readonly attempt: number;
    }
  | {
      /** Failed, attempts remain — the caller must make the queue redeliver. */
      readonly status: 'retry';
      readonly attempt: number;
      /** Backoff the job's BullMQ options would have applied before the next attempt. */
      readonly retryDelayMs: number;
      readonly error: unknown;
    }
  | {
      /** Failed on the last attempt; terminal handling already ran. */
      readonly status: 'failed';
      readonly attempt: number;
      readonly dlq: boolean;
    };

export interface InlineJobRuntime {
  /** Inline mode: every attempt + backoff in-process (BullMQ policy replay). */
  runCall(data: CallJobData): Promise<InlineRunReport>;
  runSummary(data: SummaryJobData): Promise<InlineRunReport>;
  /**
   * SQS mode: exactly one attempt. Retries are the queue's job — on
   * `retry` the caller leaves the message undeleted; on the final attempt
   * the terminal hand-off (call DLQ escalation / summary failure log) runs
   * here and the report is `failed`, so the caller can delete the message.
   */
  runCallAttempt(data: CallJobData, attempt: JobAttempt): Promise<AttemptReport>;
  runSummaryAttempt(data: SummaryJobData, attempt: JobAttempt): Promise<AttemptReport>;
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

  const callJobOptions = deps.callJobOptions ?? CALLS_DEFAULT_JOB_OPTIONS;
  const summaryJobOptions = deps.summaryJobOptions ?? SUMMARIES_DEFAULT_JOB_OPTIONS;

  /**
   * Duplicate suppression. BullMQ collapsed duplicate jobIds in Redis;
   * here the claim row is the lease: the enqueue route flips the claim to
   * IN_QUEUE, and exactly one trigger can move it IN_QUEUE → CALLING. A
   * replayed or doubled trigger finds it already CALLING and stops.
   * Hold-detector reschedules run while the claim is CALLING and carry a
   * deterministic `-r<n>` key, so they bypass the lease.
   *
   * `isRetry` (SQS redelivery after a failed attempt): the failed attempt
   * already moved the claim to CALLING, so CALLING is accepted too — but a
   * claim that reached any other state (resolved, manual review, …) is
   * never redialled.
   */
  const acquireCallLease = async (data: CallJobData, isRetry: boolean): Promise<boolean> => {
    const jobId = data.idempotencyKey;
    if (RESCHEDULE_KEY.test(jobId)) return true;
    const lease = await prisma.claim.updateMany({
      where: {
        id: data.claimId,
        organizationId: data.organizationId,
        status: isRetry ? { in: ['IN_QUEUE', 'CALLING'] } : 'IN_QUEUE',
      },
      data: { status: 'CALLING' },
    });
    if (lease.count === 0) {
      logger.warn(
        { jobId, claimId: data.claimId, isRetry },
        'call job skipped — claim is not in a dialable state (duplicate or stale trigger)',
      );
      return false;
    }
    return true;
  };

  /**
   * Terminal call failure → the same escalation the DLQ consumer performs
   * for `calls-dlq`, invoked directly (there is no DLQ queue here). Returns
   * whether the escalation succeeded.
   */
  const escalateCallToDlq = async (
    data: CallJobData,
    attemptsMade: number,
    error: unknown,
  ): Promise<boolean> => {
    const jobId = data.idempotencyKey;
    const dlqData: DlqJobData = {
      originalJobId: jobId,
      originalQueueName: 'calls',
      originalJobName: CALL_JOB_NAME,
      originalData: data,
      reason: DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS,
      attemptsMade,
      enqueuedAt: new Date().toISOString(),
      ...(error instanceof Error && { failedReason: error.message }),
    };
    try {
      await dlqHandler(
        asBullMqJob({ id: jobId, name: DLQ_JOB_NAME, data: dlqData, attemptsMade: 0 }),
      );
      return true;
    } catch (err) {
      logger.error({ jobId, err: errInfo(err) }, 'DLQ handling failed — manual recovery required');
      return false;
    }
  };

  /**
   * `CallSummary.callId` is UNIQUE, so a second run for the same call can
   * only fail. Skip duplicates of the automatic `call.<id>` job; operator
   * retries (`.retry.<n>`) keep their BullMQ-era behaviour.
   */
  const summaryAlreadyExists = async (data: SummaryJobData): Promise<boolean> => {
    if (SUMMARY_RETRY_KEY.test(data.idempotencyKey)) return false;
    const existing = await prisma.callSummary.findFirst({
      where: { callId: data.callId, organizationId: data.organizationId },
      select: { id: true },
    });
    if (existing) {
      logger.warn(
        { jobId: data.idempotencyKey, callId: data.callId },
        'summary job skipped — summary exists',
      );
      return true;
    }
    return false;
  };

  return {
    async runCall(data): Promise<InlineRunReport> {
      const jobId = data.idempotencyKey;
      if (!(await acquireCallLease(data, false))) {
        return { status: 'skipped', reason: 'claim_not_in_queue' };
      }

      const outcome = await runInlineJob({
        id: jobId,
        name: CALL_JOB_NAME,
        data,
        jobOptions: callJobOptions,
        budgetMs,
        ...(deps.sleep && { sleep: deps.sleep }),
        process: async (job) => {
          try {
            await callHandler(asBullMqJob(job));
            return null;
          } catch (err) {
            // Missing data needs a biller; retrying or DLQ escalation would
            // replace the handler's NEEDS_INFO state without improving it.
            if (err instanceof MissingCallIdentityError) return err;
            throw err;
          }
        },
        onAttemptFailed: (err, attemptsMade) => {
          logger.error(
            { jobId, attemptsMade, err: errInfo(err) },
            'inline call job attempt failed',
          );
        },
      });
      if (outcome.status === 'completed') {
        if (outcome.result instanceof MissingCallIdentityError) {
          return {
            status: 'blocked',
            reason: outcome.result.code,
            missingFields: outcome.result.missingFields,
            attemptsMade: outcome.attemptsMade,
          };
        }
        logger.info({ jobId, attemptsMade: outcome.attemptsMade }, 'inline call job completed');
        return { status: 'completed', attemptsMade: outcome.attemptsMade };
      }

      const dlq = await escalateCallToDlq(data, outcome.attemptsMade, outcome.error);
      return {
        status: 'failed',
        attemptsMade: outcome.attemptsMade,
        budgetExhausted: outcome.budgetExhausted,
        dlq,
      };
    },

    async runSummary(data): Promise<InlineRunReport> {
      const jobId = data.idempotencyKey;
      if (await summaryAlreadyExists(data)) {
        return { status: 'skipped', reason: 'summary_exists' };
      }

      const outcome = await runInlineJob({
        id: jobId,
        name: SUMMARY_JOB_NAME,
        data,
        jobOptions: summaryJobOptions,
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

    async runCallAttempt(data, { attempt, maxAttempts }): Promise<AttemptReport> {
      const jobId = data.idempotencyKey;
      if (!(await acquireCallLease(data, attempt > 1))) {
        return { status: 'skipped', reason: 'claim_not_in_queue' };
      }
      try {
        await callHandler(
          asBullMqJob({ id: jobId, name: CALL_JOB_NAME, data, attemptsMade: attempt - 1 }),
        );
        logger.info({ jobId, attempt }, 'call job completed');
        return { status: 'completed', attempt };
      } catch (err) {
        if (err instanceof MissingCallIdentityError) {
          return {
            status: 'blocked',
            reason: err.code,
            missingFields: err.missingFields,
            attempt,
          };
        }
        logger.error({ jobId, attempt, maxAttempts, err: errInfo(err) }, 'call job attempt failed');
        if (attempt < maxAttempts) {
          return {
            status: 'retry',
            attempt,
            retryDelayMs: computeBackoffMs(callJobOptions.backoff, attempt),
            error: err,
          };
        }
        const dlq = await escalateCallToDlq(data, attempt, err);
        return { status: 'failed', attempt, dlq };
      }
    },

    async runSummaryAttempt(data, { attempt, maxAttempts }): Promise<AttemptReport> {
      const jobId = data.idempotencyKey;
      if (await summaryAlreadyExists(data)) {
        return { status: 'skipped', reason: 'summary_exists' };
      }
      try {
        const result = await summaryHandler({ id: jobId, data });
        logger.info({ jobId, attempt, outcome: result.outcome }, 'summary job completed');
        return { status: 'completed', attempt };
      } catch (err) {
        logger.error(
          { jobId, attempt, maxAttempts, err: errInfo(err) },
          'summary job attempt failed',
        );
        if (attempt < maxAttempts) {
          return {
            status: 'retry',
            attempt,
            retryDelayMs: computeBackoffMs(summaryJobOptions.backoff, attempt),
            error: err,
          };
        }
        // Parity with BullMQ / inline mode: no summaries DLQ consumer; the
        // operator retries via POST /v1/calls/:id/summary/retry.
        return { status: 'failed', attempt, dlq: false };
      }
    },
  };
}
