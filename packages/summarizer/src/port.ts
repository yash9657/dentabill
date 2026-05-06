import type { SummarizeInput, SummarizeResult } from './types.js';

/**
 * `SummarizerPort` — port-and-adapters seam (mirrors `RetellPort`).
 *
 * `summarize(input) → SummarizeResult` reads a call transcript and
 * returns a structured CallSummary candidate plus the token cost so
 * the worker can debit the per-org budget atomically.
 *
 * Adapters:
 *   - `FakeClaude` (./fake.ts): deterministic per-payer fixture map.
 *     Selected when no `ANTHROPIC_API_KEY` is set. Used by every
 *     test that doesn't need to pay for real Claude calls.
 *   - `LiveClaude` (./live.ts, lands in W2B): wraps
 *     `@anthropic-ai/sdk` with prompt caching + tool-call structured
 *     output. Lazy-imports the SDK so the dev/test bundles stay
 *     SDK-free.
 *
 * Implementations MUST validate their output against
 * `SummaryOutputSchema` before returning. Callers re-validate
 * defence-in-depth, but the port is the contract boundary.
 */
export interface SummarizerPort {
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
  ) {
    super(
      `summarizer output failed schema validation for callId=${callId}: ${issues
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`,
    );
    this.name = 'SummaryValidationError';
  }
}
