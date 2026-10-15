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
 *   3. Otherwise, if `deriveWhenUnregistered` is on, synthesize a summary
 *      by reading the transcript (see `deriveSummaryFromTranscript`).
 *   4. Otherwise, throw — silent default outputs would mask test bugs.
 *
 * The `tokensUsed` figure is computed from the transcript word-count
 * (×1.3 ≈ tokens) so cost-guard tests can exercise budget arithmetic
 * without a real model.
 */
export interface FakeClaudeOptions {
  /**
   * Derive a plausible summary from the transcript instead of throwing when
   * nothing is registered. OFF by default, because for tests the throw is the
   * point — a silent default would hide a missing fixture.
   *
   * Exists for demo mode: without it, a genuine call (as opposed to a test)
   * produces no summary at all, the job retries and dead-letters, and the
   * claim never transitions. This is the summarizer's counterpart to the
   * FakeRetell autopilot — the fake was only ever driven by test code, so it
   * could not carry a live run on its own.
   */
  readonly deriveWhenUnregistered?: boolean;
}

export class FakeClaude implements SummarizerPort {
  public readonly inference = { provider: 'SYNTHETIC', releaseId: 'synthetic-summary.v1' } as const;
  readonly #fixtures = new Map<string, ReturnType<typeof SummaryOutputSchema.parse>>();
  readonly #defaultsByPayer = new Map<string, ReturnType<typeof SummaryOutputSchema.parse>>();
  readonly #deriveWhenUnregistered: boolean;
  /** Spy log: every `summarize` call appended in order. */
  public readonly invocations: SummarizeInput[] = [];

  constructor(options: FakeClaudeOptions = {}) {
    this.#deriveWhenUnregistered = options.deriveWhenUnregistered ?? false;
  }

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
    const derived = this.#deriveWhenUnregistered ? deriveSummaryFromTranscript(input) : undefined;
    const candidate = direct ?? fallback ?? derived;
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

/**
 * "1,250.00" / "345" / "345." -> integer cents, or null if unparseable.
 * Sentence punctuation frequently rides along on the captured digits, so a
 * trailing separator is trimmed before parsing.
 */
function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').replace(/\.$/, '');
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Read the transcript and produce a summary consistent with what it says.
 *
 * Deliberately simple string matching, not an attempt at comprehension: the
 * scripted scenarios this backs (the FakeRetell autopilot and
 * `simulate-live-call.mts`) use fixed rep phrasing, so matching on it yields a
 * summary that genuinely agrees with the transcript a viewer is reading. A
 * summary that contradicts the visible transcript is worse than none.
 *
 * Fully deterministic — same transcript in, same summary out.
 */
function deriveSummaryFromTranscript(
  input: SummarizeInput,
): ReturnType<typeof SummaryOutputSchema.parse> {
  const joined = input.transcriptTurns.map((t) => t.text).join(' ');
  const lowered = joined.toLowerCase();

  const denied = lowered.includes('denied') || lowered.includes('denial');
  const approved =
    lowered.includes('approved') || lowered.includes('paid') || lowered.includes('good news');

  // "$345" / "$1,234.56" -> cents. First money mention wins; the scripted
  // scenarios only ever state the claim amount once.
  //
  // One bounded character class, then the cleanup happens in JS. A more
  // natural `[\d,]+(?:\.\d{2})?` has nested-quantifier ambiguity that trips
  // security/detect-unsafe-regex, and this input is model-adjacent text — not
  // somewhere to leave a backtracking risk.
  const amountMatch = /\$\s?([0-9][0-9,.]{0,15})/.exec(joined);
  const amountApprovedCents =
    approved && !denied && amountMatch?.[1] ? parseMoneyToCents(amountMatch[1]) : null;

  const referenceMatch = /\b(REF-[A-Z0-9-]+)\b/.exec(joined);
  const denialCodeMatch = /\b((?:CO|PR|N)-?\d{2,3})\b/.exec(joined);

  // Rep first names appear as "this is <Name>" or "my name is <Name>".
  const repMatch = /(?:this is|my name is)\s+([A-Z][a-z]+)/.exec(joined);

  const claimStatus = denied ? 'denied' : approved ? 'paid' : 'pending';
  const nextAction = denied ? 'APPEAL' : approved ? 'RESOLVED' : 'CALL_BACK';

  return SummaryOutputSchema.parse({
    claimStatus,
    denialReason: denied ? 'Rep cited a denial on the call — see transcript.' : null,
    denialCode: denialCodeMatch?.[1] ?? '',
    nextAction,
    // Honest about provenance: derived from fixed phrasing, so high but not
    // absolute, and never presented as a real model's self-assessment.
    confidence: denied || approved ? 0.88 : 0.61,
    repName: repMatch?.[1] ?? null,
    referenceNumber: referenceMatch?.[1] ?? null,
    callbackDate: null,
    amountApprovedCents,
    notes: 'Summary derived from the call transcript by the offline summarizer (no model call).',
  });
}

function computeTranscriptKey(input: SummarizeInput): string {
  // Stable + deterministic. Tests can build the same key by passing
  // `payerCode + first transcript turn text` — sufficient resolution
  // for fixture maps that need to distinguish "happy" vs "denied".
  const firstAgent = input.transcriptTurns.find((t) => t.role === 'agent')?.text ?? '';
  return `${input.payerCode}::${firstAgent.slice(0, 64)}`;
}
