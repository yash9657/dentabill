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
 *
 * Both implementations use `data.idempotencyKey` as the job id.
 */
export const JOB_DISPATCH_MODES = ['bullmq', 'inline'] as const;
export type JobDispatchMode = (typeof JOB_DISPATCH_MODES)[number];

export interface DispatchCallOptions {
  /** BullMQ priority (min-first). Ignored by the inline dispatcher. */
  readonly priority?: number;
}

export interface JobDispatcher {
  readonly mode: JobDispatchMode;
  /** Returns the job id (always `data.idempotencyKey` unless BullMQ says otherwise). */
  dispatchCall(data: CallJobData, opts?: DispatchCallOptions): Promise<string>;
  dispatchSummary(data: SummaryJobData): Promise<string>;
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
      if (!options.callsQueue) throw new Error('bullmq dispatcher: calls queue not configured');
      const job = await options.callsQueue.add(CALL_JOB_NAME, data, {
        jobId: data.idempotencyKey,
        ...(opts?.priority !== undefined && { priority: opts.priority }),
      });
      return job.id ?? data.idempotencyKey;
    },
    async dispatchSummary(data): Promise<string> {
      if (!options.summariesQueue) {
        throw new Error('bullmq dispatcher: summaries queue not configured');
      }
      const job = await options.summariesQueue.add(SUMMARY_JOB_NAME, data, {
        jobId: data.idempotencyKey,
      });
      return job.id ?? data.idempotencyKey;
    },
  };
}

/** Parse `JOB_DISPATCH_MODE`; unset / empty → `bullmq`. */
export function parseJobDispatchMode(raw: string | undefined): JobDispatchMode {
  if (raw === undefined || raw.trim() === '') return 'bullmq';
  const value = raw.trim().toLowerCase();
  if (value === 'bullmq' || value === 'inline') return value;
  throw new Error(
    `JOB_DISPATCH_MODE must be one of ${JOB_DISPATCH_MODES.join(', ')}; got "${raw}"`,
  );
}
