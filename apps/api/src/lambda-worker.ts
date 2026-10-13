/**
 * AWS Lambda job worker (ADR-053, `JOB_DISPATCH_MODE=sqs`).
 *
 * Plain Node handler (no web adapter) triggered by the jobs SQS standard
 * queue — batch size 1, `ReportBatchItemFailures` enabled, a redrive policy
 * to a DLQ with `maxReceiveCount` = `JOBS_MAX_RECEIVE_COUNT` (default 3).
 *
 * Each record runs the same processors the inline runtime uses, but as a
 * single attempt per receive; SQS owns the retry loop:
 *
 *   - attempt number = `ApproximateReceiveCount`;
 *   - success / duplicate / durable uncertainty → message deleted;
 *   - failure with attempts remaining      → reported in `batchItemFailures`,
 *     after shortening its visibility timeout to the job's BullMQ backoff
 *     (calls 30 s, 60 s; summaries 15 s, 30 s) so SQS redelivers on that
 *     schedule instead of after the queue-wide timeout;
 *   - failure on the final attempt         → the inline path's terminal
 *     hand-off runs (call → READY-only intent cancellation; summary → error
 *     log), then the message is deleted. Failed call terminal persistence
 *     remains a batch failure for SQS retry/redrive;
 *   - unparseable body / unexpected crash  → reported as a failure without
 *     a visibility change, so it lands in the SQS DLQ via redrive.
 *
 * Module scope holds one runtime (and with it the `@dentabill/db` Prisma
 * singleton) that is reused across warm invocations.
 * A private EventBridge invocation also performs one bounded outbox sweep;
 * it does not instantiate the call/summary runtime or accept tenant input.
 */
import { relayJobOutbox } from '@dentabill/call-worker';
import { prisma } from '@dentabill/db';
import { createLogger, type Logger } from '@dentabill/logger';
import {
  createRedisConnection,
  createSqsJobDispatcher,
  createSqsRetryScheduler,
  parseSqsJobMessage,
} from '@dentabill/queue';
import { z } from 'zod';

import {
  createInlineJobRuntime,
  type AttemptReport,
  type InlineJobRuntime,
} from './lib/inline-jobs.js';

// ─── Minimal SQS event types (the subset of @types/aws-lambda we read) ──────

export interface SqsRecord {
  readonly messageId: string;
  readonly receiptHandle: string;
  readonly body: string;
  readonly attributes: { readonly ApproximateReceiveCount?: string | undefined };
}

export interface SqsEvent {
  readonly Records: readonly SqsRecord[];
}

export interface SqsBatchResponse {
  batchItemFailures: { itemIdentifier: string }[];
}

/** Must match the queue's redrive `maxReceiveCount`. */
export const DEFAULT_MAX_RECEIVE_COUNT = 3;

export interface SqsJobWorkerDeps {
  readonly runtime: Pick<InlineJobRuntime, 'runCallAttempt' | 'runSummaryAttempt'>;
  readonly logger: Logger;
  readonly maxReceiveCount: number;
  /**
   * Best-effort: delay the redelivery of a failed message (visibility
   * timeout). When absent or failing, the queue's own timeout applies.
   */
  readonly scheduleRetry?: (receiptHandle: string, delaySeconds: number) => Promise<void>;
}

export type RecordDecision = 'delete' | 'retry';

/** 1-based attempt number from `ApproximateReceiveCount` (missing / garbage → 1). */
export function receiveAttempt(record: SqsRecord): number {
  const n = Number.parseInt(record.attributes.ApproximateReceiveCount ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** What a runtime report means for the SQS message. */
export function decide(
  report: AttemptReport,
  kind: 'call.place' | 'summary.generate' = 'call.place',
): RecordDecision {
  if (report.status === 'retry') return 'retry';
  if (kind === 'call.place' && report.status === 'failed' && !report.dlq) return 'retry';
  return 'delete';
}

const errInfo = (err: unknown): unknown =>
  err instanceof Error ? { message: err.message, name: err.name } : err;

export async function processRecord(
  record: SqsRecord,
  deps: SqsJobWorkerDeps,
): Promise<RecordDecision> {
  const attempt = receiveAttempt(record);
  const log = { messageId: record.messageId, attempt };

  let message;
  try {
    message = parseSqsJobMessage(record.body);
  } catch (err) {
    deps.logger.error(
      { ...log, err: errInfo(err) },
      'sqs worker: invalid job message — leaving it for the DLQ',
    );
    return 'retry';
  }

  const jobAttempt = { attempt, maxAttempts: deps.maxReceiveCount };
  let report: AttemptReport;
  try {
    report =
      message.type === 'call.place'
        ? await deps.runtime.runCallAttempt(message.data, jobAttempt)
        : await deps.runtime.runSummaryAttempt(message.data, jobAttempt);
  } catch (err) {
    // Infrastructure failure outside the processor (e.g. a runtime lookup).
    // The terminal hand-off could not run, so never delete: SQS retries and,
    // after maxReceiveCount, moves the message to the DLQ.
    deps.logger.error(
      { ...log, type: message.type, jobId: message.data.idempotencyKey, err: errInfo(err) },
      'sqs worker: job crashed outside the processor',
    );
    return 'retry';
  }

  deps.logger[report.status === 'failed' ? 'error' : 'info'](
    { ...log, type: message.type, jobId: message.data.idempotencyKey, ...report, error: undefined },
    'sqs worker: job attempt finished',
  );

  const decision = decide(report, message.type);
  if (report.status === 'retry' && deps.scheduleRetry) {
    try {
      await deps.scheduleRetry(record.receiptHandle, Math.ceil(report.retryDelayMs / 1000));
    } catch (err) {
      deps.logger.warn(
        { ...log, err: errInfo(err) },
        'sqs worker: could not set retry delay — queue visibility timeout applies',
      );
    }
  }
  return decision;
}

export function createSqsJobWorker(
  deps: SqsJobWorkerDeps,
): (event: SqsEvent) => Promise<SqsBatchResponse> {
  return async (event) => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      if ((await processRecord(record, deps)) === 'retry') {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

// ─── Trusted Lambda invocation boundary ────────────────────────────────────

const relayEventSchema = z.strictObject({
  type: z.literal('outbox.relay'),
  version: z.literal(1),
});

const sqsEventSchema = z.strictObject({
  Records: z.array(
    z.looseObject({
      eventSource: z.literal('aws:sqs'),
      messageId: z.string().min(1),
      receiptHandle: z.string().min(1),
      body: z.string(),
      attributes: z.looseObject({ ApproximateReceiveCount: z.string().optional() }),
    }),
  ),
});

export const OUTBOX_RELAY_LIMIT = 25;
export const OUTBOX_RELAY_BUDGET_MS = 20_000;

export interface OutboxRelayReport {
  selected: number;
  sent: number;
  failed: number;
  quarantined: number;
}

export interface LambdaJobWorkerDeps {
  readonly sqsWorker: (event: SqsEvent) => Promise<SqsBatchResponse>;
  readonly relayOutbox: (options: {
    limit: number;
    budgetMs: number;
  }) => Promise<OutboxRelayReport>;
  readonly logger: Logger;
}

export type LambdaJobWorkerResponse = SqsBatchResponse | OutboxRelayReport;

/**
 * IAM on the private worker Lambda is the authorization boundary, not these
 * fields. Only its scoped EventBridge rule (or an authorized operator) may
 * request a cross-tenant sweep. No HTTP route or SQS message body uses this
 * branch. The relay scopes each write to the organization stored on its row.
 */
export function createLambdaJobWorker(
  deps: LambdaJobWorkerDeps,
): (event: unknown) => Promise<LambdaJobWorkerResponse> {
  return async (event) => {
    if (relayEventSchema.safeParse(event).success) {
      try {
        const { selected, sent, failed, quarantined } = await deps.relayOutbox({
          limit: OUTBOX_RELAY_LIMIT,
          budgetMs: OUTBOX_RELAY_BUDGET_MS,
        });
        const counts = { selected, sent, failed, quarantined };
        deps.logger[failed > 0 || quarantined > 0 ? 'warn' : 'info'](
          counts,
          'outbox relay sweep completed',
        );
        return counts;
      } catch {
        // Never emit DB errors, job payloads, or tenant data to Lambda's logs.
        deps.logger.error({ code: 'OUTBOX_RELAY_FAILED' }, 'outbox relay sweep failed');
        throw new Error('lambda-worker: outbox relay sweep failed');
      }
    }

    const sqs = sqsEventSchema.safeParse(event);
    if (sqs.success) return deps.sqsWorker(sqs.data);
    throw new Error('lambda-worker: unsupported invocation envelope');
  };
}

// ─── Lambda entry ───────────────────────────────────────────────────────────

let worker: ReturnType<typeof createLambdaJobWorker> | null = null;

function buildWorker(
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof createLambdaJobWorker> {
  const queueUrl = env.JOBS_QUEUE_URL;
  if (queueUrl === undefined || queueUrl.trim() === '') {
    throw new Error('lambda-worker: JOBS_QUEUE_URL is required');
  }
  const maxReceiveCount = Number.parseInt(env.JOBS_MAX_RECEIVE_COUNT ?? '', 10);
  const logger = createLogger({
    base: { service: 'job-worker', env: env.NODE_ENV ?? 'development' },
  });
  const jobDispatcher = createSqsJobDispatcher({
    queueUrl,
    onDelayClamped: (ctx) => {
      logger.warn(ctx, 'sqs job delay clamped to the 900 s SQS maximum');
    },
  });
  let sqsWorker: ReturnType<typeof createSqsJobWorker> | null = null;
  return createLambdaJobWorker({
    logger,
    relayOutbox: ({ limit, budgetMs }) =>
      relayJobOutbox({ prisma, jobDispatcher, limit, budgetMs }),
    sqsWorker: (event) => {
      // Scheduled recovery must work even when voice/summary runtime config
      // is unavailable. Keep runtime construction on the SQS path only.
      if (sqsWorker === null) {
        const redis =
          env.REDIS_URL !== undefined && env.REDIS_URL !== ''
            ? createRedisConnection(env.REDIS_URL, { lazyConnect: true })
            : null;
        sqsWorker = createSqsJobWorker({
          runtime: createInlineJobRuntime({ jobDispatcher, redis, logger, env }),
          logger,
          maxReceiveCount:
            Number.isFinite(maxReceiveCount) && maxReceiveCount >= 1
              ? maxReceiveCount
              : DEFAULT_MAX_RECEIVE_COUNT,
          scheduleRetry: createSqsRetryScheduler({ queueUrl }),
        });
      }
      return sqsWorker(event);
    },
  });
}

export async function handler(event: unknown): Promise<LambdaJobWorkerResponse> {
  worker ??= buildWorker();
  return worker(event);
}
