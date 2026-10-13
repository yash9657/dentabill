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
  // Phase 4 (ADR-042): post-call summarisation. The call-worker enqueues
  // one `summary.generate` job per Call.endedAt — see W2G.
  SUMMARIES: 'summaries',
  SUMMARIES_DLQ: 'summaries-dlq',
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
  /** Resume observation of an already bound call; this command never places a call. */
  resume: z
    .object({ intentId: z.string().min(1), callId: z.string().min(1) })
    .strict()
    .optional(),
});

export type CallJobData = z.infer<typeof CallJobDataSchema>;

/**
 * Outcome the worker returns when the job completes (any non-throw exit).
 * Failure modes that should retry throw instead — BullMQ's retry policy
 * is the source of truth for that path.
 */
export const CallJobResultSchema = z.object({
  callId: z.string().min(1).nullable(),
  retellCallId: z.string().min(1).nullable(),
  outcome: z.enum([
    'COMPLETED',
    'ESCALATED',
    'RESCHEDULED',
    'CANCELLED',
    'BLOCKED',
    'RECONCILIATION_REQUIRED',
    'ALREADY_PROCESSED',
  ]),
  durationSeconds: z.number().int().min(0).nullable(),
});

export type CallJobResult = z.infer<typeof CallJobResultSchema>;

// ─── Summary queue (Phase 4) ──────────────────────────────────────────────

/** Canonical job name in the `summaries` queue. */
export const SUMMARY_JOB_NAME = 'summary.generate' as const;
export type SummaryJobName = typeof SUMMARY_JOB_NAME;

/**
 * Payload for a `summary.generate` job. Same trust-boundary rules as
 * `CallJobData` — validated at enqueue (call-worker) and again at
 * dequeue (summary-worker).
 *
 * `callId` is the DentaBill `Call.id`. The worker re-loads the Call
 * with `getOrgScopedDb(organizationId)` so cross-tenant routing is
 * impossible even with a forged job. `promptVersion` allows the
 * call-worker to pin a specific prompt at enqueue time (default
 * `v1`); the audit log records what the worker actually used.
 */
export const SummaryJobDataSchema = z.object({
  organizationId: z.string().min(1),
  callId: z.string().min(1),
  /** Audit + diagnostics — surfaces in `metadata.prompt`. */
  promptVersion: z.string().min(1).default('v1'),
  /**
   * Idempotency key — used as BullMQ jobId — to prevent double-enqueue.
   * Same rules as CallJobData.idempotencyKey.
   */
  idempotencyKey: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_.-]+$/, 'idempotencyKey must match /^[A-Za-z0-9_.-]+$/'),
});

export type SummaryJobData = z.infer<typeof SummaryJobDataSchema>;

export const SummaryJobResultSchema = z.object({
  summaryId: z.string().min(1).nullable(),
  /**
   * Routing outcomes describe workflow decisions, never collected cash.
   * STALE_RESULT preserves newer/reviewed state; ALREADY_PROCESSED skips
   * duplicate inference; CALL_NOT_TERMINAL refuses an active call;
   * TRANSCRIPT_UNAVAILABLE abstains when finalized evidence is missing or empty.
   * DLQ is non-retryable output validation; BUDGET_EXCEEDED skips inference.
   */
  outcome: z.enum([
    'AUTO_TRANSITIONED',
    'MANUAL_REVIEW',
    'BUDGET_EXCEEDED',
    'DLQ',
    'STALE_RESULT',
    'ALREADY_PROCESSED',
    'CALL_NOT_TERMINAL',
    'TRANSCRIPT_UNAVAILABLE',
    'INFERENCE_REVIEW_REQUIRED',
    'PROVIDER_DISABLED',
  ]),
  tokensUsed: z.number().int().min(0).nullable(),
  promptVersion: z.string().min(1),
});

export type SummaryJobResult = z.infer<typeof SummaryJobResultSchema>;
