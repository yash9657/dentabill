import type { RetellPort } from '@dentabill/payer-ivr';
import {
  type CallJobData,
  CALL_JOB_NAME,
  DLQ_REASONS,
  type DlqQueue,
  enqueueDlqJob,
} from '@dentabill/queue';

/**
 * Per-call wall-clock cap (P3-T13 / ADR-038).
 *
 * The default cap is 900 s (15 min) — long enough for the deepest
 * legitimate IVR + rep dialogue we have observed in dial-tests, short
 * enough that a runaway agent (looping on misheard prompts, infinite
 * "Please hold" rotations, etc.) never burns more than a per-call cap
 * of Retell minutes. Unlike the hold cap (P3-T12), a duration breach
 * is **terminal** — there is no reschedule, because we have no signal
 * that the next attempt would be any shorter; the claim is escalated
 * to MANUAL_REVIEW and the job lands in the DLQ.
 */
export interface DurationGuardOptions {
  /** ADR-038 default 900 s. Lower for tests. */
  readonly maxDurationMs: number;
  /** Override the clock (testing seam). Defaults to `Date.now`. */
  readonly clock?: () => number;
}

export interface DurationGuardState {
  readonly status: 'idle' | 'ok' | 'breached';
  readonly elapsedMs: number;
}

export interface DurationGuard {
  /** Mark call start. Idempotent. */
  start(): void;
  /** Read the current state. Pure — never mutates. */
  check(): DurationGuardState;
}

export function createDurationGuard(options: DurationGuardOptions): DurationGuard {
  if (options.maxDurationMs <= 0) {
    throw new Error(
      `createDurationGuard: maxDurationMs must be positive, got ${String(options.maxDurationMs)}`,
    );
  }
  const clock = options.clock ?? ((): number => Date.now());
  let startedAt: number | null = null;
  return {
    start(): void {
      startedAt ??= clock();
    },
    check(): DurationGuardState {
      if (startedAt === null) return { status: 'idle', elapsedMs: 0 };
      const elapsedMs = clock() - startedAt;
      return {
        status: elapsedMs >= options.maxDurationMs ? 'breached' : 'ok',
        elapsedMs,
      };
    },
  };
}

export interface ResolveDurationBreachInput {
  readonly dlqQueue: DlqQueue;
  readonly retellPort: RetellPort;
  readonly retellCallId: string;
  readonly originalData: CallJobData;
  /** BullMQ jobId of the breached job — used as the DLQ idempotency key. */
  readonly originalJobId: string;
  /** ms of wall-clock observed at the breach (logged on the DLQ payload). */
  readonly elapsedMs: number;
}

export interface ResolveDurationBreachResult {
  readonly outcome: 'dlq_escalated';
}

/**
 * Resolve a duration-cap breach (ADR-038).
 *
 * 1. End the live Retell call with `duration_cap_exceeded` so we stop
 *    accruing minutes on a runaway dialogue.
 * 2. Enqueue a DLQ job with `EXCEEDED_MAX_DURATION`. The DLQ consumer
 *    (P3-T14) is what writes the terminal `CallEvent type=ESCALATED`,
 *    flips the claim to `MANUAL_REVIEW`, and stamps `Call.dlqReason`.
 *    Doing the DB writes here would tightly couple the duration guard
 *    to Prisma; the queue is the right transport for "I'm done with
 *    this job, hand it off to the escalation path".
 *
 * Idempotent on `originalJobId` — a duplicate breach observation
 * collapses to a single DLQ record courtesy of BullMQ's jobId
 * uniqueness.
 */
export async function resolveDurationBreach(
  input: ResolveDurationBreachInput,
): Promise<ResolveDurationBreachResult> {
  await input.retellPort.endCall({
    retellCallId: input.retellCallId,
    reason: 'duration_cap_exceeded',
  });
  await enqueueDlqJob({
    dlq: input.dlqQueue,
    originalJobId: input.originalJobId,
    originalJobName: CALL_JOB_NAME,
    originalData: input.originalData,
    attemptsMade: input.originalData.attemptNumber,
    reason: DLQ_REASONS.EXCEEDED_MAX_DURATION,
    failedReason: `duration cap exceeded after ${String(input.elapsedMs)} ms`,
  });
  return { outcome: 'dlq_escalated' };
}
