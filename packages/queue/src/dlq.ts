import { Queue, type DefaultJobOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { type CallJobData, CallJobDataSchema, QUEUE_NAMES } from './types.js';

/**
 * Reasons a `calls` job lands in the DLQ. Captured on the BullMQ job
 * payload here AND mirrored to `Call.dlqReason` (P3-T8 migration) so
 * the dashboard surface can display the cause without needing BullMQ
 * admin UI access.
 *
 * Keep these in sync with the call-worker's escalation paths:
 *   - exceeded_max_attempts  : ADR-035 retry exhaustion
 *   - exceeded_max_duration  : ADR-038 — 15 min wall-clock cap
 *   - exceeded_max_hold      : ADR-039 — 10 min hold + reschedule cap
 *   - cancelled_by_operator  : `POST /v1/calls/:id/cancel` (P3-T20)
 */
export const DLQ_REASONS = {
  EXCEEDED_MAX_ATTEMPTS: 'exceeded_max_attempts',
  EXCEEDED_MAX_DURATION: 'exceeded_max_duration',
  EXCEEDED_MAX_HOLD: 'exceeded_max_hold',
  CANCELLED_BY_OPERATOR: 'cancelled_by_operator',
} as const;

export type DlqReason = (typeof DLQ_REASONS)[keyof typeof DLQ_REASONS];

export const DlqJobDataSchema = z.object({
  originalJobId: z.string().min(1),
  originalQueueName: z.string().min(1),
  originalJobName: z.string().min(1),
  originalData: CallJobDataSchema,
  reason: z.enum([
    DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS,
    DLQ_REASONS.EXCEEDED_MAX_DURATION,
    DLQ_REASONS.EXCEEDED_MAX_HOLD,
    DLQ_REASONS.CANCELLED_BY_OPERATOR,
  ]),
  failedReason: z.string().optional(),
  attemptsMade: z.number().int().min(0),
  enqueuedAt: z.string().datetime(),
});

export type DlqJobData = z.infer<typeof DlqJobDataSchema>;

export const DLQ_JOB_NAME = 'call.dead' as const;
export type DlqJobName = typeof DLQ_JOB_NAME;

export type DlqQueue = Queue<DlqJobData, void, DlqJobName>;

/**
 * DLQ retention is generous on purpose — failed jobs are evidence for
 * HIPAA audit, post-mortems on payer outages, and the per-claim
 * "MANUAL_REVIEW" surface. The DLQ consumer (P3-T14) deletes after a
 * successful drain.
 *
 *   - `attempts: 1` — the DLQ itself MUST NOT retry; it is the terminal
 *     resting place. The DLQ consumer's own queue (if any in Phase 4)
 *     is what handles its own retry.
 *   - `removeOnComplete: false` and `removeOnFail: false` — never auto-
 *     prune. Manual retention policy lives in `docs/RUNBOOK.md` (P3-T28).
 */
export const DLQ_DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 1,
  removeOnComplete: false,
  removeOnFail: false,
};

export interface CreateDlqQueueOptions {
  connection: Redis;
}

export function createDlqQueue({ connection }: CreateDlqQueueOptions): DlqQueue {
  return new Queue<DlqJobData, void, DlqJobName>(QUEUE_NAMES.CALLS_DLQ, {
    connection,
    defaultJobOptions: DLQ_DEFAULT_JOB_OPTIONS,
  });
}

export interface EnqueueDlqJobInput {
  dlq: DlqQueue;
  originalJobId: string;
  originalJobName: string;
  originalData: CallJobData;
  attemptsMade: number;
  reason: DlqReason;
  failedReason?: string;
}

/**
 * Move a terminally-failed `calls` job to the DLQ.
 *
 * Idempotent on `originalJobId` — BullMQ's `jobId` constraint silently
 * ignores re-enqueues with the same key. That guarantees the DLQ
 * consumer never sees the same failure twice, and a duplicate webhook
 * or a worker-crash retry cannot inflate the DLQ.
 */
export async function enqueueDlqJob({
  dlq,
  originalJobId,
  originalJobName,
  originalData,
  attemptsMade,
  reason,
  failedReason,
}: EnqueueDlqJobInput): Promise<void> {
  const data: DlqJobData = {
    originalJobId,
    originalQueueName: QUEUE_NAMES.CALLS,
    originalJobName,
    originalData,
    reason,
    attemptsMade,
    enqueuedAt: new Date().toISOString(),
    ...(failedReason !== undefined && { failedReason }),
  };
  await dlq.add(DLQ_JOB_NAME, data, { jobId: originalJobId });
}
