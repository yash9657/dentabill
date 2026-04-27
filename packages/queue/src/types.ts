import { z } from 'zod';

/**
 * Queue topology — ADR-035.
 *
 * One queue (`calls`) carries the canonical "place an outbound call for
 * this claim" job. One DLQ (`calls-dlq`) collects exhausted jobs for the
 * DLQ consumer (P3-T14) to drain.
 */
export const QUEUE_NAMES = {
  CALLS: 'calls',
  CALLS_DLQ: 'calls-dlq',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Canonical job name in the `calls` queue. */
export const CALL_JOB_NAME = 'call.place' as const;
export type CallJobName = typeof CALL_JOB_NAME;

/**
 * Wire-format payload for a `call.place` job.
 *
 * The queue is a trust boundary: validated at enqueue (API) and again at
 * dequeue (worker). `payerCode` is intentionally a plain string here — not
 * the `@dentabill/db` PayerCode enum — to keep this package free of any
 * Prisma transitive dependency. The worker resolves it to a Retell agent
 * + IVR map via `@dentabill/payer-ivr` at pickup.
 */
export const CallJobDataSchema = z.object({
  organizationId: z.string().min(1),
  claimId: z.string().min(1),
  payerCode: z.string().min(1),
  /** ADR-039 — at most 2 attempts/claim/day. */
  attemptNumber: z.number().int().min(1).max(2),
  /** Mirror of `Claim.priority`; drives queue priority and observability. */
  claimPriority: z.number().int().min(0).max(100),
  /**
   * Idempotency key — used as BullMQ jobId — to prevent double-enqueue
   * on a UI double-click or retry. ADR-035 retains failed jobs forever,
   * so a second enqueue with the same key is a no-op.
   *
   * `:` is reserved by BullMQ as its Redis-key namespace separator and
   * is rejected at job-creation time. The regex enforces that
   * structurally so a misuse fails at the trust boundary, not deep in
   * BullMQ.
   */
  idempotencyKey: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_.-]+$/, 'idempotencyKey must match /^[A-Za-z0-9_.-]+$/'),
});

export type CallJobData = z.infer<typeof CallJobDataSchema>;

/**
 * Outcome the worker returns when the job completes (any non-throw exit).
 * Failure modes that should retry throw instead — BullMQ's retry policy
 * is the source of truth for that path.
 */
export const CallJobResultSchema = z.object({
  callId: z.string().min(1),
  retellCallId: z.string().min(1).nullable(),
  outcome: z.enum(['COMPLETED', 'ESCALATED', 'RESCHEDULED', 'CANCELLED']),
  durationSeconds: z.number().int().min(0),
});

export type CallJobResult = z.infer<typeof CallJobResultSchema>;
