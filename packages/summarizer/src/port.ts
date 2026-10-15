import type { SummarizeInput, SummarizeResult } from './types.js';

/**
 * `SummarizerPort` — port-and-adapters seam (mirrors `RetellPort`).
 *
 * `summarize(input) → SummarizeResult` reads a call transcript and
 * returns a structured candidate plus nullable token usage. The worker reserves
 * ownership before inference and commits the receipt separately from summary effects.
 * FakeClaude is the enabled synthetic adapter. LiveClaude is an explicit comparison
 * adapter; the production factory and summary worker reject it pending an approved release.
 *
 * Implementations MUST validate their output against
 * `SummaryOutputSchema` before returning. Callers re-validate
 * defence-in-depth, but the port is the contract boundary.
 */
export interface SummarizerPort {
  readonly inference: {
    readonly provider: 'SYNTHETIC' | 'UNAPPROVED';
    readonly releaseId: string;
  };
  summarize(input: SummarizeInput): Promise<SummarizeResult>;
}

/**
 * Thrown by the adapter when the LLM (or the fixture map) returns
 * output that cannot be reconciled to `SummaryOutputSchema`. The
 * worker catches this, audits `summary.dlq`, and routes the Claim
 * to MANUAL_REVIEW.
 */
export class SummaryValidationError extends Error {
  public constructor(
    public readonly callId: string,
    public readonly issues: readonly { readonly path: string; readonly message: string }[],
    public readonly tokensUsed: number | null = null,
  ) {
    super('Summary output failed validation.');
    this.name = 'SummaryValidationError';
  }
}
