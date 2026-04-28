import type { RetellPort } from '@dentabill/payer-ivr';
import {
  type CallJobData,
  CALL_JOB_NAME,
  type CallsQueue,
  CALLS_DEFAULT_JOB_OPTIONS,
  DLQ_REASONS,
  type DlqQueue,
  enqueueDlqJob,
} from '@dentabill/queue';

/**
 * Hold detector + reschedule resolver (P3-T12).
 *
 * Two pieces, kept separately so the pure-logic detector has zero I/O
 * and the async resolver lives at the worker → queue boundary.
 *
 *   1. `createHoldDetector({ maxHoldMs })` — tracks the wall-clock gap
 *      between the call start (or the rep's last utterance) and "now".
 *      Once the gap exceeds `maxHoldMs` (ADR-039 default = 600 s) the
 *      detector flips to `'breached'`.
 *
 *   2. `resolveHoldBreach({ … })` — invoked by the worker when the
 *      detector trips. Ends the Retell call with `hold_cap_exceeded`,
 *      then reschedules the job with `attemptNumber + 1` (cap 2 per
 *      ADR-039). When the cap is hit the job is DLQ'd with
 *      `EXCEEDED_MAX_HOLD`. P3-T14's DLQ consumer is what surfaces the
 *      `MANUAL_REVIEW` claim status downstream.
 */
export interface HoldDetectorOptions {
  /** ADR-039 default 600 s. Lower for tests. */
  readonly maxHoldMs: number;
  /** Override the clock (testing seam). Defaults to `Date.now`. */
  readonly clock?: () => number;
}

export interface HoldDetectorState {
  readonly status: 'idle' | 'ok' | 'breached';
  /** ms since the last `noteHumanSpeech` (or `start` if no rep yet). */
  readonly silentMs: number;
}

export interface HoldDetector {
  /** Mark the start of the call. Idempotent — safe to call once. */
  start(): void;
  /**
   * Mark that the rep just spoke (a `user`-role transcript event from
   * Retell — the LLM agent's lines come back as `agent` role, so they
   * must NOT be fed here, otherwise we'd never trip on a stuck-on-hold
   * call where the agent talks but the rep does not).
   */
  noteHumanSpeech(): void;
  /**
   * Read the current state. Pure — never mutates. The worker polls this
   * on a timer (typical cadence: every 5 s) and ends the call when
   * `status === 'breached'`.
   */
  check(): HoldDetectorState;
}

export function createHoldDetector(options: HoldDetectorOptions): HoldDetector {
  if (options.maxHoldMs <= 0) {
    throw new Error(
      `createHoldDetector: maxHoldMs must be positive, got ${String(options.maxHoldMs)}`,
    );
  }
  const clock = options.clock ?? ((): number => Date.now());
  let lastHumanAt: number | null = null;
  let startedAt: number | null = null;

  return {
    start(): void {
      startedAt ??= clock();
    },
    noteHumanSpeech(): void {
      lastHumanAt = clock();
    },
    check(): HoldDetectorState {
      if (startedAt === null) {
        return { status: 'idle', silentMs: 0 };
      }
      const reference = lastHumanAt ?? startedAt;
      const silentMs = clock() - reference;
      return {
        status: silentMs >= options.maxHoldMs ? 'breached' : 'ok',
        silentMs,
      };
    },
  };
}

export interface ResolveHoldBreachInput {
  readonly callsQueue: CallsQueue;
  readonly dlqQueue: DlqQueue;
  readonly retellPort: RetellPort;
  readonly retellCallId: string;
  /** The job that just breached the hold cap. */
  readonly originalData: CallJobData;
  /** BullMQ jobId of the breached job (used as DLQ idempotency key). */
  readonly originalJobId: string;
  /** ms of dead air observed at the breach (logged on the DLQ payload). */
  readonly silentMs: number;
}

export interface ResolveHoldBreachResult {
  readonly outcome: 'rescheduled' | 'dlq_exhausted';
  /** Set on `rescheduled`; the `attemptNumber` of the new job. */
  readonly nextAttemptNumber?: 1 | 2;
  /** Set on `rescheduled`; the BullMQ jobId of the new job. */
  readonly nextJobId?: string;
}

/**
 * Maximum attempts/claim/day per ADR-039. The current schema constrains
 * `CallJobData.attemptNumber` to ≤ 2 already; this constant is the
 * symbolic name used at the breach site.
 */
export const MAX_ATTEMPTS_PER_CLAIM_PER_DAY = 2;

export async function resolveHoldBreach(
  input: ResolveHoldBreachInput,
): Promise<ResolveHoldBreachResult> {
  // 1. End the live call so we stop accruing duration on a stuck line.
  //    Idempotent on the FakeRetell + LiveRetell side — a duplicate
  //    end-call is a silent no-op, matching production.
  await input.retellPort.endCall({
    retellCallId: input.retellCallId,
    reason: 'hold_cap_exceeded',
  });

  const current = input.originalData.attemptNumber;
  // 2. Reschedule if we still have attempts left. The new job carries
  //    attemptNumber + 1; the idempotencyKey is suffixed `-r<n>` so a
  //    racing duplicate breach (two pollers both observing the same
  //    silence threshold) collapses to a single requeue thanks to BullMQ's
  //    jobId uniqueness.
  if (current < MAX_ATTEMPTS_PER_CLAIM_PER_DAY) {
    const nextAttemptNumber = (current + 1) as 1 | 2;
    const nextJobId = `${input.originalData.idempotencyKey}-r${String(nextAttemptNumber)}`;
    const nextData: CallJobData = {
      ...input.originalData,
      attemptNumber: nextAttemptNumber,
      idempotencyKey: nextJobId,
    };
    await input.callsQueue.add(CALL_JOB_NAME, nextData, {
      jobId: nextJobId,
      ...CALLS_DEFAULT_JOB_OPTIONS,
    });
    return { outcome: 'rescheduled', nextAttemptNumber, nextJobId };
  }

  // 3. Cap reached: terminal DLQ. The DLQ consumer (P3-T14) is what
  //    eventually flips `Claim.status` to `MANUAL_REVIEW` and writes the
  //    `Call.dlqReason = EXCEEDED_MAX_HOLD` row.
  await enqueueDlqJob({
    dlq: input.dlqQueue,
    originalJobId: input.originalJobId,
    originalJobName: CALL_JOB_NAME,
    originalData: input.originalData,
    attemptsMade: current,
    reason: DLQ_REASONS.EXCEEDED_MAX_HOLD,
    failedReason: `hold cap exceeded after ${String(input.silentMs)} ms of silence`,
  });
  return { outcome: 'dlq_exhausted' };
}
