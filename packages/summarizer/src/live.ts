import { SummaryValidationError, type SummarizerPort } from './port.js';
import { getPrompt } from './prompts/index.js';
import {
  SummaryOutputSchema,
  type SummarizeInput,
  type SummarizeResult,
  type SummaryOutput,
} from './types.js';

/**
 * LiveClaude — wraps `@anthropic-ai/sdk` with prompt caching + tool-call
 * structured output.
 *
 * Lazy-loads the SDK via `await import()` so importing the
 * `@dentabill/summarizer` barrel does NOT pull `@anthropic-ai/sdk`
 * into dev / test bundles where `ANTHROPIC_API_KEY` is absent. Mirrors
 * the same pattern Phase-3 used for `retell-sdk`
 * (`packages/payer-ivr/src/retell/live.ts:75-78`).
 *
 * Cost-shape:
 *   - The system prompt is registered as `cache_control: ephemeral` so
 *     Anthropic's prompt-caching feature reduces system-prompt input
 *     tokens by ~90% on cache hits. Per-call dynamic content (the
 *     transcript) is NOT cached.
 *   - Output is forced to a single JSON object via a tool call (Claude's
 *     "structured output" pattern). The tool's `input_schema` mirrors
 *     `SummaryOutputSchema` so a malformed response is caught both at
 *     the API boundary and by our local Zod re-parse.
 *
 * Test seam:
 *   - `anthropicLoader` is a constructor-injected async function that
 *     returns a "client". Production wiring imports `@anthropic-ai/sdk`;
 *     unit tests pass an in-memory loader so we don't need network or
 *     a real API key.
 */

interface AnthropicClientLike {
  readonly messages: {
    create: (request: AnthropicCreateRequest) => Promise<AnthropicCreateResponse>;
  };
}

type AnthropicCtor = new (options: { apiKey: string }) => AnthropicClientLike;

type AnthropicLoader = () => Promise<AnthropicCtor>;

interface AnthropicCreateRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: readonly {
    readonly type: 'text';
    readonly text: string;
    readonly cache_control?: { readonly type: 'ephemeral' };
  }[];
  readonly messages: readonly {
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }[];
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly input_schema: Record<string, unknown>;
  }[];
  readonly tool_choice: { readonly type: 'tool'; readonly name: string };
}

interface AnthropicCreateResponse {
  readonly model: string;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_creation_input_tokens?: number;
    readonly cache_read_input_tokens?: number;
  };
  readonly content: readonly (
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'tool_use'; readonly name: string; readonly input: unknown }
  )[];
  readonly stop_reason: string;
}

export interface LiveClaudeOptions {
  readonly apiKey: string;
  /** Hard cap on Claude's output tokens. Defaults to 4000 per ADR-042. */
  readonly maxOutputTokens?: number;
  /** Test seam — defaults to `import('@anthropic-ai/sdk').then(m => m.default)`. */
  readonly anthropicLoader?: AnthropicLoader;
}

const TOOL_NAME = 'submit_call_summary';

const TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: [
    'claimStatus',
    'denialReason',
    'denialCode',
    'nextAction',
    'confidence',
    'repName',
    'referenceNumber',
    'callbackDate',
    'amountApprovedCents',
    'notes',
  ],
  properties: {
    claimStatus: { type: 'string', enum: ['paid', 'denied', 'pending', 'in_review', 'unknown'] },
    denialReason: { type: ['string', 'null'] },
    denialCode: { type: ['string', 'null'] },
    nextAction: {
      type: 'string',
      enum: [
        'RESUBMIT',
        'APPEAL',
        'SUBMIT_DOCS',
        'CALL_BACK',
        'WRITE_OFF',
        'RESOLVED',
        'MANUAL_REVIEW',
      ],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    repName: { type: ['string', 'null'] },
    referenceNumber: { type: ['string', 'null'] },
    callbackDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    amountApprovedCents: { type: ['integer', 'null'], minimum: 0 },
    notes: { type: ['string', 'null'] },
  },
  additionalProperties: false,
};

export class LiveClaude implements SummarizerPort {
  readonly #apiKey: string;
  readonly #maxOutputTokens: number;
  readonly #loader: AnthropicLoader;
  #client?: AnthropicClientLike;

  public constructor(options: LiveClaudeOptions) {
    if (options.apiKey.length === 0) {
      throw new Error('LiveClaude requires a non-empty apiKey');
    }
    this.#apiKey = options.apiKey;
    this.#maxOutputTokens = options.maxOutputTokens ?? 4000;
    this.#loader =
      options.anthropicLoader ??
      ((): Promise<AnthropicCtor> => {
        // Lazy-load via the bracket form so bundlers/tsc don't try to
        // resolve `@anthropic-ai/sdk` in environments that don't have
        // it installed (dev/test). The package becomes a runtime
        // dependency only on production summary-worker boxes.
        const moduleId = '@anthropic-ai/sdk';
        return import(moduleId).then((m: { default: AnthropicCtor }) => m.default);
      });
  }

  public async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    const prompt = getPrompt(input.promptVersion);
    const client = await this.#getClient();
    const userMessage = renderUserMessage(input);
    const response = await client.messages.create({
      model: prompt.model,
      max_tokens: this.#maxOutputTokens,
      system: [{ type: 'text', text: prompt.systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Submit the structured summary of the call. Call this exactly once.',
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    });

    const summary = parseToolCallOutput(input.callId, response);
    const tokensUsed =
      response.usage.input_tokens +
      response.usage.output_tokens +
      (response.usage.cache_creation_input_tokens ?? 0);

    return {
      summary,
      tokensUsed,
      promptVersion: prompt.version,
      model: response.model,
    };
  }

  async #getClient(): Promise<AnthropicClientLike> {
    if (!this.#client) {
      const Ctor = await this.#loader();
      this.#client = new Ctor({ apiKey: this.#apiKey });
    }
    return this.#client;
  }
}

function renderUserMessage(input: SummarizeInput): string {
  // Plain prose preamble + a deterministic transcript serialisation.
  // Keep the format stable; if it changes, it's a new prompt version.
  const lines: string[] = [
    `Payer: ${input.payerCode}`,
    `Call ID: ${input.callId}`,
    '',
    'Transcript turns (in order):',
  ];
  for (const turn of input.transcriptTurns) {
    lines.push(`[${turn.role}] ${turn.text}`);
  }
  lines.push('', `Call the ${TOOL_NAME} tool exactly once with the structured summary.`);
  return lines.join('\n');
}

function parseToolCallOutput(callId: string, response: AnthropicCreateResponse): SummaryOutput {
  const toolUse = response.content.find(
    (block): block is Extract<typeof block, { type: 'tool_use' }> =>
      block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!toolUse) {
    throw new SummaryValidationError(callId, [
      { path: 'response.content', message: `expected a tool_use block named ${TOOL_NAME}` },
    ]);
  }

  const parsed = SummaryOutputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new SummaryValidationError(
      callId,
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}
