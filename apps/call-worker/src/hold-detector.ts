import type { RetellPort } from '@dentabill/payer-ivr';
import { type CallJobData, type DlqQueue, type JobDispatcher } from '@dentabill/queue';

/**
 * Hold detector + termination request (P3-T12).
 *
 * Two pieces, kept separately so the pure-logic detector has zero I/O
 * and the async termination request lives at the provider boundary.
 *
 *   1. `createHoldDetector({ maxHoldMs })` — tracks the wall-clock gap
 *      between the call start (or the rep's last utterance) and "now".
 *      Once the gap exceeds `maxHoldMs` (ADR-039 default = 600 s) the
 *      detector flips to `'breached'`.
 *
 *   2. `resolveHoldBreach({ … })` requests termination with
 *      `hold_cap_exceeded`. A successful stop request is not terminal
 *      evidence; another attempt requires a newly reserved durable intent
 *      after reconciliation. This helper never dispatches a replacement.
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
  /**
   * Legacy integration parameters retained for callers. These transports
   * are deliberately not used before provider termination is established.
   */
  readonly jobDispatcher: Pick<JobDispatcher, 'dispatchCall'>;
  readonly dlqQueue: DlqQueue;
  readonly retellPort: RetellPort;
  readonly retellCallId: string;
  /** The job that just breached the hold cap. */
  readonly originalData: CallJobData;
  /** Legacy BullMQ jobId of the breached job. */
  readonly originalJobId: string;
  /** ms of dead air observed at the breach. */
  readonly silentMs: number;
}

export interface ResolveHoldBreachResult {
  readonly outcome: 'termination_pending';
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
  // Request termination. Live adapter failures propagate; a stop response
  // alone does not confirm termination. W2 must reconcile terminal evidence
  // before any new attempt. This helper is not wired into the live handler.
  await input.retellPort.endCall({
    retellCallId: input.retellCallId,
    reason: 'hold_cap_exceeded',
  });

  return { outcome: 'termination_pending' };
}
