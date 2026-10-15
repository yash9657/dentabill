/**
 * Inline job runtime (ADR-053) — runs the call / summary processors inside
 * the API process instead of the always-on BullMQ workers.
 *
 * The processors themselves are reused unchanged from the worker packages
 * (`createCallJobHandler`, `createSummaryJobHandler`, `createDlqJobHandler`);
 * this module only supplies what BullMQ used to: a Job-shaped object, the
 * retry policy, summary duplicate suppression, and the terminal DLQ hand-off.
 * The call processor owns durable intent checks and submission ownership.
 */
import {
  createCallJobHandler,
  createDlqJobHandler,
  loadWorkerEnv,
  MissingCallIdentityError,
  sweepDueAcceptedCalls,
} from '@dentabill/call-worker';
import { prisma as defaultPrisma } from '@dentabill/db';
import { createLogger, type Logger } from '@dentabill/logger';
import {
  createRetellPort,
  createRetellReconciliationClient,
  type MissingCallIdentityField,
  type RetellPort,
  type RetellReconciliationClient,
} from '@dentabill/payer-ivr';
import {
  asBullMqJob,
  CALL_JOB_NAME,
  computeBackoffMs,
  type CallJobData,
  type CallJobResult,
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
  type SummaryJobResult,
} from '@dentabill/queue';
import type { SummarizerPort } from '@dentabill/summarizer';
import {
  type CostGuard,
  createSummaryJobHandler,
  createRuntimeSummarizer,
  loadSummaryWorkerEnv,
  ObservationJobError,
  SummaryInferenceBusyError,
  type ObservationJobConfig,
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

export type InlineRunReport =
  | { readonly status: 'completed'; readonly attemptsMade: number }
  | { readonly status: 'rescheduled'; readonly attemptsMade: number }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'reconciliation_required'; readonly attemptsMade: number }
  | { readonly status: 'inference_review_required'; readonly attemptsMade: number }
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
  /** Authenticated delivery provenance, separate from immutable domain identity. */
  readonly transportJobId?: string;
  readonly attempt: number;
  /** Deliveries after which the job is treated as exhausted (SQS `maxReceiveCount`). */
  readonly maxAttempts: number;
}

export type AttemptReport =
  | { readonly status: 'completed'; readonly attempt: number }
  | { readonly status: 'rescheduled'; readonly attempt: number }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'reconciliation_required'; readonly attempt: number }
  | { readonly status: 'inference_review_required'; readonly attempt: number }
  | {
      readonly status: 'blocked';
      readonly reason: 'MISSING_CALL_IDENTITY';
      readonly missingFields: readonly MissingCallIdentityField[];
      readonly attempt: number;
    }
  | {
      /** Retryable failure or incomplete terminal persistence; keep the delivery. */
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
  runCall(
    data: CallJobData,
    options?: { readonly transportJobId?: string },
  ): Promise<InlineRunReport>;
  runSummary(data: SummaryJobData): Promise<InlineRunReport>;
  /**
   * SQS mode: exactly one attempt. Retries are the queue's job — on
   * `retry` the caller leaves the message undeleted. Exhausted calls must
   * finish the safe DLQ hand-off before deletion; a failed hand-off still
   * returns `retry`. Summaries log their final failure here.
   */
  runCallAttempt(data: CallJobData, attempt: JobAttempt): Promise<AttemptReport>;
  runSummaryAttempt(data: SummaryJobData, attempt: JobAttempt): Promise<AttemptReport>;
}

export interface CreateInlineJobRuntimeDeps {
  readonly jobDispatcher: JobDispatcher;
  /** Shared queue connection; summary admission is persisted in Postgres. */
  readonly redis: Redis | null;
  readonly logger?: Logger;
  readonly prisma?: DbClient;
  readonly env?: NodeJS.ProcessEnv;
  /** Test seams. */
  readonly retellPort?: RetellPort;
  readonly summarizer?: SummarizerPort;
  /** Trusted native fixture/release configuration; never taken from job payloads. */
  readonly observationConfig?: ObservationJobConfig;
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
  const summarizer = deps.summarizer ?? createRuntimeSummarizer(summaryEnv);
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
    ...(deps.costGuard && { costGuard: deps.costGuard }),
    summarizer,
    env: summaryEnv,
    ...(deps.observationConfig ? { observationConfig: deps.observationConfig } : {}),
  });

  const errInfo = (err: unknown): { code: string } => ({
    code:
      err instanceof SummaryInferenceBusyError
        ? 'SUMMARY_INFERENCE_BUSY'
        : err instanceof ObservationJobError
          ? 'OBSERVATION_DELIVERY_UNCONFIRMED'
          : 'JOB_ATTEMPT_FAILED',
  });

  const callJobOptions = deps.callJobOptions ?? CALLS_DEFAULT_JOB_OPTIONS;
  const summaryJobOptions = deps.summaryJobOptions ?? SUMMARIES_DEFAULT_JOB_OPTIONS;

  /**
   * Exhausted call delivery uses the same READY-only cancellation as the
   * DLQ consumer, invoked directly. Submitted and ambiguous intents remain
   * protected. Returns whether that transaction completed.
   */
  const escalateCallToDlq = async (
    data: CallJobData,
    attemptsMade: number,
    transportJobId?: string,
  ): Promise<boolean> => {
    const jobId = transportJobId ?? data.idempotencyKey;
    const dlqData: DlqJobData = {
      originalJobId: jobId,
      originalQueueName: 'calls',
      originalJobName: CALL_JOB_NAME,
      originalData: data,
      reason: DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS,
      attemptsMade,
      enqueuedAt: new Date().toISOString(),
    };
    try {
      await dlqHandler(
        asBullMqJob({ id: jobId, name: DLQ_JOB_NAME, data: dlqData, attemptsMade: 0 }),
      );
      const intent = await prisma.callIntent.findFirst({
        where: {
          organizationId: data.organizationId,
          ...(data.resume
            ? { id: data.resume.intentId, callId: data.resume.callId }
            : { idempotencyKey: data.idempotencyKey }),
          claimId: data.claimId,
          claimPriority: data.claimPriority,
          attemptNumber: data.attemptNumber,
          OR: [
            { state: { in: data.resume ? ['TERMINAL'] : ['CANCELLED', 'TERMINAL', 'UNKNOWN'] } },
            {
              state: 'ACCEPTED',
              callId: { not: null },
              callDeadlineAt: { not: null },
              nextObservationAt: { not: null },
            },
          ],
        },
        select: { payerCode: true },
      });
      return intent?.payerCode === data.payerCode;
    } catch (err) {
      logger.error({ jobId, err: errInfo(err) }, 'DLQ handling failed — manual recovery required');
      return false;
    }
  };

  /** Delivery retries never replace existing summary evidence. */
  const summaryAlreadyExists = async (data: SummaryJobData): Promise<boolean> => {
    const stored = await prisma.inferenceRun.findFirst({
      where: { callId: data.callId, organizationId: data.organizationId, generation: 1 },
      select: { provider: true },
    });
    // Native publication may coexist with historical summary evidence.
    if (stored?.provider === 'FIREWORKS') return false;
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

  const checkedSummaryHandler = async (job: {
    id?: string;
    data: SummaryJobData;
  }): Promise<SummaryJobResult> => {
    const result = await summaryHandler(job);
    if (result.outcome === 'OBSERVATION_PUBLISHED') {
      const observation = result.observationId
        ? await prisma.claimObservation.findFirst({
            where: {
              id: result.observationId,
              organizationId: job.data.organizationId,
              callId: job.data.callId,
              inferenceRun: { generation: 1, provider: 'FIREWORKS', state: 'APPLIED' },
            },
            select: { id: true },
          })
        : null;
      const publicationAudit = observation
        ? await prisma.auditLog.findFirst({
            where: {
              organizationId: job.data.organizationId,
              resourceType: 'ClaimObservation',
              resourceId: observation.id,
              action: 'claimObservation.published',
            },
            select: { id: true },
          })
        : null;
      if (!observation || !publicationAudit || result.summaryId !== null)
        throw new Error('Native observation disposition is unconfirmed.');
    }
    if (result.outcome === 'INFERENCE_REVIEW_REQUIRED') {
      const disposition = await prisma.inferenceRun.findFirst({
        where: {
          organizationId: job.data.organizationId,
          callId: job.data.callId,
          generation: 1,
          state: { in: ['UNKNOWN', 'REJECTED'] },
          reviewAppliedAt: { not: null },
        },
        select: {
          id: true,
          provider: true,
          state: true,
          attempts: {
            orderBy: { attemptNumber: 'desc' },
            take: 1,
            select: { responseRecordedAt: true },
          },
        },
      });
      const reviewAudit = disposition
        ? await prisma.auditLog.findFirst({
            where: {
              organizationId: job.data.organizationId,
              resourceType: 'InferenceRun',
              resourceId: disposition.id,
              action: 'inference.review_applied',
            },
            select: { id: true },
          })
        : null;
      if (
        !disposition ||
        !reviewAudit ||
        (disposition.provider === 'FIREWORKS' &&
          disposition.state === 'UNKNOWN' &&
          disposition.attempts[0]?.responseRecordedAt)
      )
        throw new Error('Summary inference disposition is unconfirmed.');
    }
    return result;
  };

  return {
    async runCall(data, options): Promise<InlineRunReport> {
      const jobId = options?.transportJobId ?? data.idempotencyKey;
      const outcome = await runInlineJob({
        id: jobId,
        name: CALL_JOB_NAME,
        data,
        jobOptions: callJobOptions,
        budgetMs,
        ...(deps.sleep && { sleep: deps.sleep }),
        process: async (job) => {
          try {
            return await callHandler(asBullMqJob(job));
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
        const disposition = callDisposition(outcome.result);
        if (disposition?.status === 'skipped') return disposition;
        if (
          disposition?.status === 'reconciliation_required' ||
          disposition?.status === 'rescheduled'
        ) {
          return { ...disposition, attemptsMade: outcome.attemptsMade };
        }
        logger.info({ jobId, attemptsMade: outcome.attemptsMade }, 'inline call job completed');
        return { status: 'completed', attemptsMade: outcome.attemptsMade };
      }

      const dlq = await escalateCallToDlq(data, outcome.attemptsMade, options?.transportJobId);
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
        process: (job) => checkedSummaryHandler(job),
        onAttemptFailed: (err, attemptsMade) => {
          logger.error(
            { jobId, attemptsMade, err: errInfo(err) },
            'inline summary job attempt failed',
          );
        },
      });
      if (outcome.status === 'completed') {
        if (outcome.result.outcome === 'INFERENCE_REVIEW_REQUIRED') {
          return { status: 'inference_review_required', attemptsMade: outcome.attemptsMade };
        }
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

    async runCallAttempt(data, { attempt, maxAttempts, transportJobId }): Promise<AttemptReport> {
      const jobId = transportJobId ?? data.idempotencyKey;
      try {
        const result = await callHandler(
          asBullMqJob({ id: jobId, name: CALL_JOB_NAME, data, attemptsMade: attempt - 1 }),
        );
        const disposition = callDisposition(result);
        if (disposition?.status === 'skipped') return disposition;
        if (
          disposition?.status === 'reconciliation_required' ||
          disposition?.status === 'rescheduled'
        ) {
          return { ...disposition, attempt };
        }
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
        const dlq = await escalateCallToDlq(data, attempt, transportJobId);
        if (!dlq) {
          return {
            status: 'retry',
            attempt,
            retryDelayMs: computeBackoffMs(callJobOptions.backoff, attempt),
            error: err,
          };
        }
        return { status: 'failed', attempt, dlq };
      }
    },

    async runSummaryAttempt(data, { attempt, maxAttempts }): Promise<AttemptReport> {
      const jobId = data.idempotencyKey;
      if (await summaryAlreadyExists(data)) {
        return { status: 'skipped', reason: 'summary_exists' };
      }
      try {
        const result = await checkedSummaryHandler({ id: jobId, data });
        if (result.outcome === 'INFERENCE_REVIEW_REQUIRED') {
          return { status: 'inference_review_required', attempt };
        }
        logger.info({ jobId, attempt, outcome: result.outcome }, 'summary job completed');
        return { status: 'completed', attempt };
      } catch (err) {
        logger.error(
          { jobId, attempt, maxAttempts, err: errInfo(err) },
          'summary job attempt failed',
        );
        // Only a durable disposition can acknowledge summary delivery. SQS
        // redrive retains exhausted failures for review without resubmission.
        return {
          status: 'retry',
          attempt,
          retryDelayMs: computeBackoffMs(summaryJobOptions.backoff, attempt),
          error: new Error('Summary delivery is unconfirmed.'),
        };
      }
    },
  };
}

/** Queue delivery does not own physical submission; the durable intent does. */
function callDisposition(
  result: CallJobResult,
):
  | { status: 'skipped'; reason: string }
  | { status: 'reconciliation_required' | 'rescheduled' }
  | null {
  if (result.outcome === 'BLOCKED') return { status: 'skipped', reason: 'call_intent_blocked' };
  if (result.outcome === 'ALREADY_PROCESSED') {
    return { status: 'skipped', reason: 'call_intent_already_processed' };
  }
  if (result.outcome === 'RECONCILIATION_REQUIRED') return { status: 'reconciliation_required' };
  if (result.outcome === 'RESCHEDULED') return { status: 'rescheduled' };
  return null;
}

export interface CallObservationReport {
  selected: number;
  observed: number;
  terminal: number;
  rescheduled: number;
  stopRequested: number;
  failed: number;
}

export type CallObservationSweep = (bounds: {
  limit: number;
  budgetMs: number;
}) => Promise<CallObservationReport>;

/** Scheduled observation needs only provider read/stop clients, never the summary runtime. */
export function createCallObservationSweep(
  deps: {
    readonly prisma?: DbClient;
    readonly env?: NodeJS.ProcessEnv;
    readonly retellPort?: RetellPort;
    readonly provider?: RetellReconciliationClient | null;
  } = {},
): CallObservationSweep {
  const env = deps.env ?? process.env;
  let retellPort = deps.retellPort;
  let provider = deps.provider;
  return async (bounds) => {
    const apiKey = env.RETELL_API_KEY ?? '';
    retellPort ??= apiKey
      ? createRetellPort({ apiKey }).port
      : {
          startCall: () => Promise.reject(new Error('Provider submission unavailable.')),
          endCall: () => Promise.reject(new Error('Provider stop unavailable.')),
          subscribe: () => () => undefined,
        };
    if (provider === undefined) {
      provider = apiKey ? createRetellReconciliationClient({ apiKey }) : null;
    }
    return sweepDueAcceptedCalls({
      prisma: deps.prisma ?? defaultPrisma,
      provider,
      retellPort,
      ...bounds,
    });
  };
}
