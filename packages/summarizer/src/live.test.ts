import { describe, expect, it } from 'vitest';

import { LiveClaude, type LiveClaudeOptions } from './live.js';
import { SummaryValidationError } from './port.js';
import type { SummarizeInput } from './types.js';

interface CapturedRequest {
  readonly model: string;
  readonly system: readonly { readonly text: string; readonly cache_control?: unknown }[];
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly tools: readonly { readonly name: string }[];
  readonly tool_choice: { readonly type: string; readonly name: string };
  readonly max_tokens: number;
}

const VALID_TOOL_INPUT = {
  claimStatus: 'paid',
  denialReason: null,
  denialCode: null,
  nextAction: 'RESOLVED',
  confidence: 0.97,
  repName: 'Lisa M.',
  referenceNumber: 'REF-2026',
  callbackDate: null,
  amountApprovedCents: 24000,
  notes: null,
};

// Loader type matches what LiveClaude expects internally; we cast at
// the boundary so tests don't need to spell out Anthropic's full
// request/response shape.
type LoaderCtor = new (options: { apiKey: string }) => unknown;
type AdapterCtor = Awaited<ReturnType<NonNullable<LiveClaudeOptions['anthropicLoader']>>>;

function makeFakeAnthropicCtor(opts: {
  readonly toolInput?: unknown;
  readonly textOnly?: boolean;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheCreationTokens?: number;
  readonly cacheReadTokens?: number;
  readonly captured?: CapturedRequest[];
  readonly usageOverride?: unknown;
  readonly contentOverride?: unknown;
  readonly clientOptions?: unknown[];
}): LoaderCtor {
  return class StubCtor {
    constructor(options: unknown) {
      opts.clientOptions?.push(options);
    }
    public readonly messages = {
      create: async (req: CapturedRequest): Promise<unknown> => {
        opts.captured?.push(req);
        const usage = Object.hasOwn(opts, 'usageOverride')
          ? opts.usageOverride
          : {
              input_tokens: opts.inputTokens ?? 100,
              output_tokens: opts.outputTokens ?? 50,
              cache_creation_input_tokens: opts.cacheCreationTokens ?? 0,
              cache_read_input_tokens: opts.cacheReadTokens ?? 0,
            };
        if (opts.textOnly) {
          return Promise.resolve({
            model: req.model,
            usage,
            content: [{ type: 'text', text: 'oops, no tool call' }],
            stop_reason: 'end_turn',
          });
        }
        return Promise.resolve({
          model: req.model,
          usage,
          content: Object.hasOwn(opts, 'contentOverride')
            ? opts.contentOverride
            : [
                {
                  type: 'tool_use',
                  name: 'submit_call_summary',
                  input: opts.toolInput ?? VALID_TOOL_INPUT,
                },
              ],
          stop_reason: 'tool_use',
        });
      },
    };
  };
}

function inputFor(): SummarizeInput {
  return {
    organizationId: 'org_live_1',
    callId: 'call_live_1',
    payerCode: 'DELTA_DENTAL_PPO',
    promptVersion: 'v1',
    transcriptTurns: [
      { role: 'agent', text: 'Hi this is the agent.', timestamp: new Date() },
      { role: 'representative', text: 'Yes I can help.', timestamp: new Date() },
    ],
  };
}

describe('LiveClaude', () => {
  it('rejects an empty apiKey at construction', () => {
    expect(() => new LiveClaude({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('parses a valid tool-call response and returns SummarizeResult', async () => {
    const captured: CapturedRequest[] = [];
    const live = new LiveClaude({
      apiKey: 'sk-test',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicLoader: () => Promise.resolve(makeFakeAnthropicCtor({ captured }) as any),
    });
    const result = await live.summarize(inputFor());
    expect(result.summary.nextAction).toBe('RESOLVED');
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.promptVersion).toBe('v1');
    expect(captured).toHaveLength(1);
  });

  it('caches the system prompt via cache_control: ephemeral', async () => {
    const captured: CapturedRequest[] = [];
    const live = new LiveClaude({
      apiKey: 'sk-test',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicLoader: () => Promise.resolve(makeFakeAnthropicCtor({ captured }) as any),
    });
    await live.summarize(inputFor());
    expect(captured[0]?.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('forces tool_choice to submit_call_summary', async () => {
    const captured: CapturedRequest[] = [];
    const live = new LiveClaude({
      apiKey: 'sk-test',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicLoader: () => Promise.resolve(makeFakeAnthropicCtor({ captured }) as any),
    });
    await live.summarize(inputFor());
    expect(captured[0]?.tool_choice).toEqual({ type: 'tool', name: 'submit_call_summary' });
  });

  it('caps output tokens at the configured maxOutputTokens', async () => {
    const captured: CapturedRequest[] = [];
    const live = new LiveClaude({
      apiKey: 'sk-test',
      maxOutputTokens: 1234,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicLoader: () => Promise.resolve(makeFakeAnthropicCtor({ captured }) as any),
    });
    await live.summarize(inputFor());
    expect(captured[0]?.max_tokens).toBe(1234);
  });

  it('throws SummaryValidationError when the response has no tool_use block', async () => {
    const live = new LiveClaude({
      apiKey: 'sk-test',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicLoader: () => Promise.resolve(makeFakeAnthropicCtor({ textOnly: true }) as any),
    });
    await expect(live.summarize(inputFor())).rejects.toBeInstanceOf(SummaryValidationError);
  });

  it('throws SummaryValidationError when tool input fails Zod validation', async () => {
    const live = new LiveClaude({
      apiKey: 'sk-test',
      anthropicLoader: () =>
        Promise.resolve(
          makeFakeAnthropicCtor({
            toolInput: { ...VALID_TOOL_INPUT, denialCode: 'X'.repeat(65) },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any,
        ),
    });
    await expect(live.summarize(inputFor())).rejects.toBeInstanceOf(SummaryValidationError);
  });

  it('preserves an unrecognized code from a provider response for worker review', async () => {
    const live = new LiveClaude({
      apiKey: 'sk-test',
      anthropicLoader: () =>
        Promise.resolve(
          makeFakeAnthropicCtor({
            toolInput: {
              ...VALID_TOOL_INPUT,
              claimStatus: 'denied',
              denialCode: 'PAYER:Z-42',
              nextAction: 'SUBMIT_DOCS',
            },
          }) as unknown as AdapterCtor,
        ),
    });
    const result = await live.summarize(inputFor());
    expect(result.summary.denialCode).toBe('PAYER:Z-42');
  });

  it('reports tokensUsed including cache_creation_input_tokens', async () => {
    const live = new LiveClaude({
      apiKey: 'sk-test',
      anthropicLoader: () =>
        Promise.resolve(
          makeFakeAnthropicCtor({
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 200,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any,
        ),
    });
    const result = await live.summarize(inputFor());
    expect(result.tokensUsed).toBe(100 + 50 + 200);
  });

  it('preserves known usage on malformed response structure', async () => {
    const live = new LiveClaude({
      apiKey: 'synthetic-key',
      anthropicLoader: async () =>
        makeFakeAnthropicCtor({ contentOverride: null }) as unknown as AdapterCtor,
    });
    await expect(live.summarize(inputFor())).rejects.toMatchObject({
      name: 'SummaryValidationError',
      tokensUsed: 150,
    });
  });

  it('preserves known usage on schema failure and disables hidden SDK retries', async () => {
    const clientOptions: unknown[] = [];
    const live = new LiveClaude({
      apiKey: 'synthetic-key',
      anthropicLoader: async () =>
        makeFakeAnthropicCtor({
          textOnly: true,
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 25,
          clientOptions,
        }) as unknown as AdapterCtor,
    });
    await expect(live.summarize(inputFor())).rejects.toMatchObject({
      name: 'SummaryValidationError',
      message: 'Summary output failed validation.',
      tokensUsed: 175,
    });
    expect(clientOptions).toEqual([{ apiKey: 'synthetic-key', maxRetries: 0, timeout: 30000 }]);
    expect(live.inference.provider).toBe('UNAPPROVED');
  });

  it.each([
    null,
    {},
    { input_tokens: 100, output_tokens: 50 },
    {
      input_tokens: -1,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  ])('keeps missing/invalid usage unknown', async (usageOverride) => {
    const live = new LiveClaude({
      apiKey: 'synthetic-key',
      anthropicLoader: async () =>
        makeFakeAnthropicCtor({ usageOverride }) as unknown as AdapterCtor,
    });
    expect((await live.summarize(inputFor())).tokensUsed).toBeNull();
  });
});
