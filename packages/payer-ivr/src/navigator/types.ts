/**
 * Pure-logic types for the IVR navigator (P3-T11).
 *
 * The navigator has zero I/O — it consumes a `PayerIvrMap`, the worker's
 * call variables, and a stream of transcript events; it emits the next
 * action the call-worker should dispatch on the live Retell call. The
 * separation lets us exhaustively unit-test the decision logic without
 * faking a Retell connection.
 */

/**
 * Variables the navigator templates into spoken responses or DTMF strings.
 *
 * `subscriberId` is currently aliased to `Claim.claimNumber` in the worker
 * (Phase 3 has no subscriber-id column on Claim — see the call handler
 * for the placeholder note). `memberId` and `claimNumber` are kept
 * separate because some IVR scripts ask for them by different names.
 */
export interface NavigatorVars {
  readonly npi: string;
  readonly subscriberId: string;
  /** ISO YYYY-MM-DD. Spoken/DTMF formatting handled by the navigator. */
  readonly dateOfService: string;
  readonly memberId?: string;
  readonly claimNumber?: string;
}

/**
 * Atomic action the call-worker dispatches against the live call.
 * One step from the IVR map may expand into multiple actions (e.g. a
 * `COLLECT_VOICE_INPUT { fromVar: 'npi' }` becomes a SPEECH action with
 * the NPI digit string templated in).
 */
export type NavigatorAction =
  | { readonly type: 'WAIT'; readonly ms: number; readonly note?: string }
  | { readonly type: 'DTMF'; readonly digit: string; readonly note?: string }
  | { readonly type: 'SPEECH'; readonly say: string; readonly note?: string }
  | {
      readonly type: 'WAIT_FOR_HUMAN';
      readonly maxWaitMs: number;
      readonly note?: string;
    }
  | { readonly type: 'ESCALATE_TO_OPERATOR'; readonly digit: string; readonly reason: string };

export interface NavigatorOptions {
  /**
   * Misdetect retries on a single step before escalating to operator
   * (PRD §6 / ADR — operator handoff after 2 failures). Default 2.
   */
  readonly maxRetriesPerStep?: number;
  /**
   * DTMF digit that routes to a human operator on most US payer IVRs.
   * Default `'0'`. Override per payer if needed.
   */
  readonly operatorDigit?: string;
  /**
   * Patterns the navigator interprets as IVR misdetect signals. The
   * default set covers the dominant 80% of US payer phrasings. Pass an
   * empty array to disable misdetect detection (tests use this to
   * exercise the happy path in isolation).
   */
  readonly misdetectPatterns?: readonly RegExp[];
}

/**
 * Default IVR misdetect patterns. Conservative — false positives here
 * cost a wasted operator escalation, which is recoverable; missed
 * misdetects strand the call mid-menu, which is not.
 */
export const DEFAULT_MISDETECT_PATTERNS: readonly RegExp[] = [
  /i didn'?t (catch|understand|get|hear)/i,
  /i did not (catch|understand|get|hear)/i,
  /please try again/i,
  /that(?:'s| is) (in)?valid/i,
  /this is (in)?valid/i,
  /invalid (entry|input|selection)/i,
  /sorry,? i didn'?t/i,
  /sorry,? i did not/i,
];
