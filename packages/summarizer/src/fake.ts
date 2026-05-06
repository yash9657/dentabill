import { SummaryValidationError, type SummarizerPort } from './port.js';
import { SummaryOutputSchema, type SummarizeInput, type SummarizeResult } from './types.js';

/**
 * `FakeClaude` — deterministic in-memory summarizer used by every test
 * that doesn't pay $0.01 per Claude call.
 *
 * Lookup strategy:
 *   1. Look up by exact `transcriptKey` (caller-provided fixture key).
 *   2. Otherwise, fall back to the per-payer default fixture
 *      registered via `setDefault(payerCode, output)`.
 *   3. Otherwise, throw — silent default outputs would mask test bugs.
 *
 * The `tokensUsed` figure is computed from the transcript word-count
 * (×1.3 ≈ tokens) so cost-guard tests can exercise budget arithmetic
 * without a real model.
 */
export class FakeClaude implements SummarizerPort {
  readonly #fixtures = new Map<string, ReturnType<typeof SummaryOutputSchema.parse>>();
  readonly #defaultsByPayer = new Map<string, ReturnType<typeof SummaryOutputSchema.parse>>();
  /** Spy log: every `summarize` call appended in order. */
  public readonly invocations: SummarizeInput[] = [];

  /**
   * Register a fixture keyed by an arbitrary string. Tests that need
   * a specific output for a specific transcript pass the same key as
   * `transcriptKey` on the input.
   */
  public setFixture(key: string, output: unknown): void {
    this.#fixtures.set(key, SummaryOutputSchema.parse(output));
  }

  /**
   * Register a per-payer default. `summarize` falls back to this
   * when no per-key fixture matches.
   */
  public setDefault(payerCode: string, output: unknown): void {
    this.#defaultsByPayer.set(payerCode, SummaryOutputSchema.parse(output));
  }

  public async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    this.invocations.push(input);

    const transcriptKey = computeTranscriptKey(input);
    const direct = this.#fixtures.get(transcriptKey);
    const fallback = this.#defaultsByPayer.get(input.payerCode);
    const candidate = direct ?? fallback;
    if (!candidate) {
      throw new Error(
        `FakeClaude: no fixture registered for callId=${input.callId} payer=${input.payerCode} key=${transcriptKey}`,
      );
    }

    // Re-parse defence-in-depth — fixtures can be edited at runtime.
    const parsed = SummaryOutputSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new SummaryValidationError(
        input.callId,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    const wordCount = input.transcriptTurns.reduce(
      (sum, turn) => sum + turn.text.split(/\s+/).filter(Boolean).length,
      0,
    );
    const tokensUsed = Math.ceil(wordCount * 1.3);

    return Promise.resolve({
      summary: parsed.data,
      tokensUsed,
      promptVersion: input.promptVersion,
      model: 'fake-claude',
    });
  }
}

function computeTranscriptKey(input: SummarizeInput): string {
  // Stable + deterministic. Tests can build the same key by passing
  // `payerCode + first transcript turn text` — sufficient resolution
  // for fixture maps that need to distinguish "happy" vs "denied".
  const firstAgent = input.transcriptTurns.find((t) => t.role === 'agent')?.text ?? '';
  return `${input.payerCode}::${firstAgent.slice(0, 64)}`;
}
