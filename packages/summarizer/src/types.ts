import { z } from 'zod';

/**
 * Wire schema between the LLM (or the FakeClaude fixture map) and the
 * summary-worker. Mirrors the `CallSummary` columns plus the LLM-only
 * fields the worker uses for transition policy (`confidence`,
 * `nextAction`).
 *
 * Validation happens twice in the data flow:
 *
 *   1. The LiveClaude adapter parses the raw tool-call response with
 *      this schema before returning. Any malformed output (missing
 *      keys, oversized denial code, confidence out of range) is a
 *      hard failure routed to the summary DLQ — we do NOT try to
 *      "repair" LLM output.
 *
 *   2. The summary-worker re-parses with the same schema before the
 *      INSERT — defence-in-depth in case a future port shape skips
 *      step 1.
 *
 * Unrecognized denial codes are retained without assigning code-system or
 * payer-policy meaning. The worker's deterministic policy requires review
 * for these observations; schema acceptance does not establish validity.
 */

const TRIM = (s: string): string => s.trim();

const ClaimStatusEnum = z.enum(['paid', 'denied', 'pending', 'in_review', 'unknown']);

/**
 * NextAction parallels Prisma's `NextAction` enum. The summarizer is
 * allowed to recommend any of these; the call-worker auto-transition
 * policy (W2F) restricts which ones can flip the Claim without
 * operator review.
 */
const NextActionEnum = z.enum([
  'RESUBMIT',
  'APPEAL',
  'SUBMIT_DOCS',
  'CALL_BACK',
  'WRITE_OFF',
  'RESOLVED',
  'MANUAL_REVIEW',
]);

/**
 * Confidence is the LLM's self-assessed probability that the
 * structured fields below correctly reflect what the rep said.
 * Auto-transition requires `confidence >= 0.95` (W2F); anything
 * lower routes to MANUAL_REVIEW.
 */
const ConfidenceSchema = z.number().min(0).max(1);

/**
 * Retain the reported code's spelling, group prefix, and punctuation.
 * The size limit contains malformed output without discarding unfamiliar
 * codes. Empty strings normalize to null; recognition is a policy concern.
 */
const DenialCodeSchema = z
  .string()
  .max(64, 'denialCode must be at most 64 characters')
  .transform(TRIM)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable();

export const SummaryOutputSchema = z.object({
  /**
   * Mirrors `CallSummary.claimStatus` — free-text label for the
   * claim outcome from the rep's perspective. Use the canonical
   * values when possible; the dashboard normalises for display.
   */
  claimStatus: ClaimStatusEnum,
  denialReason: z.string().transform(TRIM).nullable(),
  denialCode: DenialCodeSchema,
  nextAction: NextActionEnum,
  confidence: ConfidenceSchema,
  repName: z.string().transform(TRIM).nullable(),
  referenceNumber: z.string().transform(TRIM).nullable(),
  callbackDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'callbackDate must be ISO YYYY-MM-DD')
    .nullable(),
  amountApprovedCents: z.number().int().min(0).nullable(),
  notes: z.string().transform(TRIM).nullable(),
});

export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

/**
 * Input contract for `SummarizerPort.summarize`. Accepts the call's
 * organizationId (multi-tenancy guard — the worker re-checks org
 * scope on the persisted summary), the callId for traceability, and
 * the transcript turns + the payer code (so the prompt can branch on
 * payer-specific rep phrasing).
 */
export interface SummarizeInput {
  readonly organizationId: string;
  readonly callId: string;
  readonly payerCode: string;
  readonly transcriptTurns: readonly {
    // Remote speech can be a representative or IVR; source is unsplit provider text.
    readonly role: 'agent' | 'representative' | 'system' | 'remote' | 'source';
    readonly text: string;
    readonly timestamp: Date;
  }[];
  /**
   * Identifier for the prompt version used. Persisted with the
   * resulting summary on the audit trail so we can correlate
   * regressions to a specific prompt change. Required (no default
   * — the caller chooses).
   */
  readonly promptVersion: string;
}

/**
 * Output of `SummarizerPort.summarize`. Wraps the validated
 * `SummaryOutput` plus the `tokensUsed` figure the worker writes to
 * `Organization.summaryTokensUsed` inside the cost-guard lock.
 */
export interface SummarizeResult {
  readonly summary: SummaryOutput;
  readonly tokensUsed: number;
  readonly promptVersion: string;
  readonly model: string;
}
