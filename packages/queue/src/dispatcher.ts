import { z } from 'zod';

import type { CallsQueue, SummariesQueue } from './queues.js';
import { CALL_JOB_NAME, SUMMARY_JOB_NAME, type CallJobData, type SummaryJobData } from './types.js';

/**
 * Job dispatch abstraction (ADR-053).
 *
 * Every producer — the API's enqueue routes, the call handler's summary
 * fan-out, the hold detector's reschedule — goes through this interface
 * instead of calling `queue.add` directly, so the transport can be
 * swapped per deployment:
 *
 *   - `bullmq` (default): the existing Redis-backed queues, consumed by the
 *     always-on call-worker / summary-worker processes.
 *   - `inline`: no queue and no worker process. The job is POSTed to an
 *     authenticated internal API route that runs the same processor to
 *     completion inside its own serverless invocation (see `inline.ts`).
 *   - `sqs`: one Amazon SQS standard queue consumed by the worker Lambda,
 *     one attempt per receive with SQS-driven retries (see `sqs.ts`).
 *
 * Domain idempotency stays in `data.idempotencyKey`; an approved recovery
 * has separate transport provenance across all dispatch modes.
 */
export const JOB_DISPATCH_MODES = ['bullmq', 'inline', 'sqs'] as const;
export type JobDispatchMode = (typeof JOB_DISPATCH_MODES)[number];

export const TransportJobIdSchema = z
  .string()
  .max(160)
  .regex(/^outbox\.[A-Za-z0-9_-]{1,128}\.recovery\.[1-9][0-9]{0,9}$/)
  .refine((value) => Number(value.slice(value.lastIndexOf('.') + 1)) <= 2_147_483_647);

export interface DispatchOptions {
  /** Approved outbox generation; transport provenance, never part of the domain command. */
  readonly transportJobId?: string;
  /**
   * Hold the job back for this long before it may run. BullMQ: `delay`.
   * SQS: `DelaySeconds`, rounded up and clamped to 900 s (the SQS max).
   * Inline: ignored — the job is triggered immediately.
   */
  readonly delayMs?: number;
}

export interface DispatchCallOptions extends DispatchOptions {
  /** BullMQ priority (min-first). Ignored by the inline and SQS dispatchers. */
  readonly priority?: number;
}

export interface JobDispatcher {
  readonly mode: JobDispatchMode;
  /** BullMQ returns its job id; SQS/inline return the unchanged domain key. */
  dispatchCall(data: CallJobData, opts?: DispatchCallOptions): Promise<string>;
  dispatchSummary(data: SummaryJobData, opts?: DispatchOptions): Promise<string>;
}

export interface CreateBullMqJobDispatcherOptions {
  readonly callsQueue?: Pick<CallsQueue, 'add'>;
  readonly summariesQueue?: Pick<SummariesQueue, 'add'>;
}

/**
 * Thin wrapper over the BullMQ queues. Wire format is identical to the
 * pre-dispatcher `queue.add` calls: same job name, `jobId =
 * idempotencyKey`, priority passed through, and the queue's own
 * `defaultJobOptions` (attempts / backoff / retention) apply.
 *
 * Queues are read at dispatch time, not captured, so a test that swaps
 * `queue.add` for a spy after construction still observes the call.
 */
export function createBullMqJobDispatcher(
  options: CreateBullMqJobDispatcherOptions,
): JobDispatcher {
  return {
    mode: 'bullmq',
    async dispatchCall(data, opts): Promise<string> {
      const transportJobId = TransportJobIdSchema.optional().parse(opts?.transportJobId);
      if (!options.callsQueue) throw new Error('bullmq dispatcher: calls queue not configured');
      const job = await options.callsQueue.add(CALL_JOB_NAME, data, {
        jobId: transportJobId ?? data.idempotencyKey,
        ...(opts?.priority !== undefined && { priority: opts.priority }),
        ...(opts?.delayMs !== undefined && opts.delayMs > 0 && { delay: opts.delayMs }),
      });
      return job.id ?? transportJobId ?? data.idempotencyKey;
    },
    async dispatchSummary(data, opts): Promise<string> {
      const transportJobId = TransportJobIdSchema.optional().parse(opts?.transportJobId);
      if (!options.summariesQueue) {
        throw new Error('bullmq dispatcher: summaries queue not configured');
      }
      const job = await options.summariesQueue.add(SUMMARY_JOB_NAME, data, {
        jobId: transportJobId ?? data.idempotencyKey,
        ...(opts?.delayMs !== undefined && opts.delayMs > 0 && { delay: opts.delayMs }),
      });
      return job.id ?? transportJobId ?? data.idempotencyKey;
    },
  };
}

/** Parse `JOB_DISPATCH_MODE`; unset / empty → `bullmq`. */
export function parseJobDispatchMode(raw: string | undefined): JobDispatchMode {
  if (raw === undefined || raw.trim() === '') return 'bullmq';
  const value = raw.trim().toLowerCase();
  if (value === 'bullmq' || value === 'inline' || value === 'sqs') return value;
  throw new Error(
    `JOB_DISPATCH_MODE must be one of ${JOB_DISPATCH_MODES.join(', ')}; got "${raw}"`,
  );
}
