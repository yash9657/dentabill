import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FIREWORKS_ENDPOINT,
  unknownUsage,
  type FireworksTransportRequest,
  type TransportProgress,
} from './contracts.js';
import { createFireworksTransport, isWithinJsonDepth } from './transport.js';

const MODEL = 'accounts/synthetic/models/approved';
const textEncoder = new TextEncoder();
const content = '{"disposition":"ABSTAIN"}';
function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'response_synthetic-01',
    model: MODEL,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    ...overrides,
  };
}
function response(body: unknown = envelope()): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
function request(overrides: Partial<FireworksTransportRequest> = {}): FireworksTransportRequest {
  return {
    apiKey: 'synthetic-transport-key',
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [{ role: 'user', content: 'Synthetic request' }],
    }),
    expectedResponseModels: [MODEL],
    maxResponseBytes: 4096,
    deadlineAt: performance.now() + 5000,
    maxAttempts: 2,
    ...overrides,
  };
}
function fixture() {
  const fetcher = vi.fn<typeof globalThis.fetch>();
  return { fetcher, transport: createFireworksTransport({ fetch: fetcher }) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Fireworks native transport', () => {
  it('uses only the fixed HTTPS endpoint, bearer authorization, JSON and redirect rejection', async () => {
    const { fetcher, transport } = fixture();
    fetcher.mockResolvedValue(response());
    const input = request();
    const result = await transport(input);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(FIREWORKS_ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer synthetic-transport-key',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: input.body,
      signal: expect.any(AbortSignal),
    });
    expect(result).toMatchObject({
      ok: true,
      content,
      model: MODEL,
      responseId: 'response_synthetic-01',
      usage: unknownUsage(),
      attempts: [{ index: 1, httpStatus: 200, acceptance: 'RESPONDED', outcome: 'COMPLETED' }],
    });
  });

  it('has no URL override even when unexpected runtime properties are supplied', async () => {
    const { fetcher, transport } = fixture();
    fetcher.mockResolvedValue(response());
    const input = {
      ...request(),
      endpoint: 'https://untrusted.invalid',
      url: 'https://untrusted.invalid',
    };
    expect((await transport(input)).ok).toBe(true);
    expect(fetcher.mock.calls[0]?.[0]).toBe(FIREWORKS_ENDPOINT);
  });

  it.each([
    undefined,
    null,
    {},
    { prompt_tokens: 17 },
    { completion_tokens: null, prompt_tokens_details: null },
  ])('keeps absent usage unknown: %j', async (usage) => {
    const { fetcher, transport } = fixture();
    fetcher.mockResolvedValue(response(envelope({ usage })));
    const result = await transport(request());
    expect(result).toMatchObject({
      ok: true,
      usage: {
        inputTokens: usage && 'prompt_tokens' in usage ? 17 : null,
        outputTokens: null,
        totalTokens: null,
        cachedInputTokens: null,
      },
    });
  });

  it('retains explicit zero and known nullable usage without inferring totals', async () => {
    const { fetcher, transport } = fixture();
    fetcher.mockResolvedValue(
      response(
        envelope({
          usage: {
            prompt_tokens: 0,
            completion_tokens: null,
            total_tokens: null,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        }),
      ),
    );
    expect(await transport(request())).toMatchObject({
      ok: true,
      usage: { inputTokens: 0, outputTokens: null, totalTokens: null, cachedInputTokens: 0 },
    });
  });

  it.each([-1, 1.5, '10', true, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid token counts and retains other known accounting: %j',
    async (value) => {
      const { fetcher, transport } = fixture();
      fetcher.mockResolvedValue(
        response(
          envelope({ usage: { prompt_tokens: 20, completion_tokens: value, total_tokens: 30 } }),
        ),
      );
      expect(await transport(request())).toMatchObject({
        ok: false,
        code: 'INVALID_RESPONSE',
        attempts: [
          {
            usage: {
              inputTokens: 20,
              outputTokens: null,
              totalTokens: 30,
              cachedInputTokens: null,
            },
          },
        ],
      });
    },
  );

  it.each(['private response text with spaces', 'id\nsecret', 'a'.repeat(129), '', 123])(
    'rejects unsafe response identifiers without reflecting them',
    async (id) => {
      const { fetcher, transport } = fixture();
      fetcher.mockResolvedValue(response(envelope({ id })));
      const result = await transport(request());
      expect(result).toMatchObject({ ok: false, code: 'INVALID_RESPONSE' });
      expect(JSON.stringify(result)).not.toContain('secret');
    },
  );

  it('allows a missing response identifier as unknown', async () => {
    const { fetcher, transport } = fixture();
    fetcher.mockResolvedValue(response(envelope({ id: null })));
    expect(await transport(request())).toMatchObject({ ok: true, responseId: null });
  });

  it.each(['other-model', MODEL.toUpperCase(), `${MODEL}/alias`])(
    'requires an exact allowlisted response model: %s',
    async (model) => {
      const { fetcher, transport } = fixture();
      fetcher.mockResolvedValue(
        response(
          envelope({ model, usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } }),
        ),
      );
      expect(await transport(request())).toMatchObject({
        ok: false,
        code: 'MODEL_IDENTITY_MISMATCH',
        attempts: [{ usage: { inputTokens: 11, outputTokens: 3, totalTokens: 14 } }],
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(
    [
      [],
      [{ index: 1, finish_reason: 'stop', message: { role: 'assistant', content } }],
      [{ index: 0, finish_reason: 'stop', message: { role: 'user', content } }],
      [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null } }],
      [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: [{ text: content }] },
        },
      ],
      [{ index: 0, finish_reason: null, message: { role: 'assistant', content } }],
      [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content } }],
      [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content, tool_calls: [] },
        },
      ],
      [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content, function_call: { name: 'unsafe' } },
        },
      ],
      [{ index: 0 }, { index: 1 }],
      [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content, tool_call_id: 'tool-id' },
        },
      ],
    ].map((choices) => ({ choices })),
  )('rejects multi-choice/non-text/tool protocol shapes %#', async ({ choices }) => {
    const { fetcher, transport } = fixture();
    fetcher.mockResolvedValue(response(envelope({ choices })));
    expect(await transport(request())).toMatchObject({ ok: false, code: 'INVALID_RESPONSE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['length', undefined, 'TRUNCATED'],
    ['content_filter', undefined, 'REFUSED'],
    ['stop', 'Refused synthetic request', 'REFUSED'],
  ])(
    'rejects %s/refusal without returning content and retains usage',
    async (finish_reason, refusal, code) => {
      const { fetcher, transport } = fixture();
      fetcher.mockResolvedValue(
        response(
          envelope({
            choices: [
              {
                index: 0,
                finish_reason,
                message: { role: 'assistant', content: 'PRIVATE_BODY_SENTINEL', refusal },
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
          }),
        ),
      );
      const result = await transport(request());
      expect(result).toMatchObject({
        ok: false,
        code,
        attempts: [
          {
            outcome: 'INVALID_RESPONSE',
            usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain('PRIVATE_BODY_SENTINEL');
    },
  );

  it('rejects invalid UTF-8 and malformed JSON', async () => {
    for (const body of [new Uint8Array([0xff]), textEncoder.encode('{"secret":"private"')]) {
      const { fetcher, transport } = fixture();
      fetcher.mockResolvedValue(new Response(body));
      expect(await transport(request())).toMatchObject({ ok: false, code: 'INVALID_RESPONSE' });
    }
  });

  it('rejects JSON deeper than32 before JSON.parse and ignores brackets in escaped text', async () => {
    const { fetcher, transport } = fixture();
    const nested = ' '.repeat(8) + '['.repeat(33) + '0' + ']'.repeat(33);
    fetcher.mockResolvedValueOnce(new Response(nested));
    const parse = vi.spyOn(JSON, 'parse');
    expect(await transport(request())).toMatchObject({ ok: false, code: 'INVALID_RESPONSE' });
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    fetcher.mockResolvedValueOnce(
      response(
        envelope({
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: '[{\\"'.repeat(100) },
            },
          ],
        }),
      ),
    );
    expect((await transport(request())).ok).toBe(true);
  });

  it('enforces a declared oversized body before pulling it', async () => {
    const { fetcher, transport } = fixture();
    const cancel = vi.fn();
    const pull = vi.fn();
    fetcher.mockResolvedValue(
      new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
        headers: { 'content-length': '9999' },
      }),
    );
    expect(await transport(request({ maxResponseBytes: 20 }))).toMatchObject({
      ok: false,
      code: 'RESPONSE_TOO_LARGE',
    });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('enforces actual UTF-8 bytes across chunks despite a false content length', async () => {
    const { fetcher, transport } = fixture();
    const cancel = vi.fn();
    let index = 0;
    fetcher.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(textEncoder.encode(index++ ? '🙂' : 'ab'));
          },
          cancel,
        }),
        { headers: { 'content-length': '1' } },
      ),
    );
    expect(await transport(request({ maxResponseBytes: 5 }))).toMatchObject({
      ok: false,
      code: 'RESPONSE_TOO_LARGE',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('decodes a valid multi-byte response split across arbitrary chunk boundaries', async () => {
    const { fetcher, transport } = fixture();
    const wire = JSON.stringify(
      envelope({
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Synthetic🙂' },
          },
        ],
      }),
    );
    const bytes = textEncoder.encode(wire);
    let offset = 0;
    fetcher.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (offset === bytes.length) controller.close();
            else controller.enqueue(bytes.slice(offset, ++offset));
          },
        }),
      ),
    );
    expect(await transport(request({ maxResponseBytes: bytes.length }))).toMatchObject({
      ok: true,
      content: 'Synthetic🙂',
    });
  });

  it.each([429, 500, 502, 503, 504])(
    'retries explicit %i only once and discards its body',
    async (status) => {
      const { fetcher, transport } = fixture();
      const cancel = vi.fn();
      fetcher.mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), { status }),
      );
      fetcher.mockResolvedValueOnce(response());
      const result = transport(request());
      await vi.advanceTimersByTimeAsync(200);
      expect(await result).toMatchObject({
        ok: true,
        attempts: [
          { index: 1, httpStatus: status, outcome: 'HTTP_ERROR' },
          { index: 2, httpStatus: 200, outcome: 'COMPLETED' },
        ],
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it.each([301, 400, 401, 403, 404, 408, 409, 422, 501])(
    'does not retry status%i or inspect its private body',
    async (status) => {
      const { fetcher, transport } = fixture();
      const cancel = vi.fn();
      const pull = vi.fn();
      fetcher.mockResolvedValue(
        new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { status }),
      );
      expect(await transport(request())).toMatchObject({
        ok: false,
        code: 'HTTP_ERROR',
        attempts: [{ httpStatus: status, outcome: 'HTTP_ERROR' }],
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('never retries an ambiguous network rejection or exposes its error', async () => {
    const { fetcher, transport } = fixture();
    fetcher.mockRejectedValue(new Error('PRIVATE_PATIENT_BODY Authorization: secret'));
    const result = await transport(request());
    expect(result).toMatchObject({
      ok: false,
      code: 'NETWORK_ERROR',
      attempts: [{ acceptance: 'POSSIBLE', httpStatus: null }],
    });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|secret|Authorization/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honors maxAttempts1 and caps repeated transient responses at2', async () => {
    const { fetcher, transport } = fixture();
    fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
    expect(await transport(request({ maxAttempts: 1 }))).toMatchObject({
      ok: false,
      code: 'HTTP_ERROR',
      attempts: [{ index: 1 }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    const result = transport(request());
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toMatchObject({
      ok: false,
      code: 'HTTP_ERROR',
      attempts: [{ index: 1 }, { index: 2 }],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['2', 'Tue, 01 Jan 2030 00:00:02 GMT'])(
    'honors Retry-After %s within the original deadline',
    async (header) => {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const { fetcher, transport } = fixture();
      fetcher
        .mockResolvedValueOnce(
          new Response(null, { status: 429, headers: { 'Retry-After': header } }),
        )
        .mockResolvedValueOnce(response());
      const result = transport(request());
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await result).ok).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['10', '9999999999999999999999999', 'Tue, 01 Jan 2030 00:00:10 GMT'])(
    'does not retry a Retry-After beyond remaining budget: %s',
    async (header) => {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const { fetcher, transport } = fixture();
      fetcher.mockResolvedValue(
        new Response(null, { status: 429, headers: { 'Retry-After': header } }),
      );
      expect(await transport(request())).toMatchObject({ ok: false, code: 'HTTP_ERROR' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('uses bounded local jitter for malformed Retry-After and never retries early', async () => {
    const { fetcher, transport } = fixture();
    fetcher
      .mockResolvedValueOnce(
        new Response(null, { status: 503, headers: { 'Retry-After': 'PRIVATE_INVALID_HEADER' } }),
      )
      .mockResolvedValueOnce(response());
    const result = transport(request());
    await vi.advanceTimersByTimeAsync(99);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(101);
    expect((await result).ok).toBe(true);
  });

  it('cancels while waiting for retry without making a second attempt', async () => {
    const { fetcher, transport } = fixture();
    const abort = new AbortController();
    fetcher.mockResolvedValue(new Response(null, { status: 503, headers: { 'Retry-After': '2' } }));
    const result = transport(request({ signal: abort.signal }));
    await vi.advanceTimersByTimeAsync(100);
    abort.abort('PRIVATE_CANCEL_REASON');
    expect(await result).toMatchObject({
      ok: false,
      code: 'CANCELLED',
      attempts: [{ index: 1, outcome: 'HTTP_ERROR' }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['cancel', 'deadline'] as const)(
    'returns promptly for an abort-ignoring hung fetch on %s and discards late bodies',
    async (reason) => {
      const { fetcher, transport } = fixture();
      const abort = new AbortController();
      let release: (value: Response) => void = () => undefined;
      fetcher.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      );
      const result = transport(
        request({ signal: abort.signal, deadlineAt: performance.now() + 100 }),
      );
      await vi.advanceTimersByTimeAsync(1);
      if (reason === 'cancel') abort.abort();
      else await vi.advanceTimersByTimeAsync(100);
      expect(await result).toMatchObject({
        ok: false,
        code: reason === 'cancel' ? 'CANCELLED' : 'DEADLINE_EXCEEDED',
        attempts: [{ acceptance: 'POSSIBLE' }],
      });
      const cancel = vi.fn();
      release(new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })));
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['cancel', 'deadline'] as const)(
    'bounds an abort-ignoring reader and cancel promise on %s',
    async (reason) => {
      const { fetcher, transport } = fixture();
      const abort = new AbortController();
      const cancel = vi.fn(() => new Promise<void>(() => undefined));
      fetcher.mockResolvedValue(
        new Response(
          new ReadableStream({ pull: () => new Promise<void>(() => undefined), cancel }),
        ),
      );
      const result = transport(
        request({ signal: abort.signal, deadlineAt: performance.now() + 100 }),
      );
      await vi.advanceTimersByTimeAsync(1);
      if (reason === 'cancel') abort.abort();
      else await vi.advanceTimersByTimeAsync(100);
      expect(await result).toMatchObject({
        ok: false,
        code: reason === 'cancel' ? 'CANCELLED' : 'DEADLINE_EXCEEDED',
        attempts: [{ httpStatus: 200, acceptance: 'RESPONDED' }],
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('shares the original deadline with the second response body', async () => {
    const { fetcher, transport } = fixture();
    const cancel = vi.fn();
    fetcher.mockResolvedValueOnce(
      new Response(null, { status: 503, headers: { 'Retry-After': '1' } }),
    );
    fetcher.mockResolvedValueOnce(
      new Response(new ReadableStream({ pull: () => new Promise<void>(() => undefined), cancel })),
    );
    const result = transport(request({ deadlineAt: performance.now() + 1200 }));
    await vi.advanceTimersByTimeAsync(1201);
    expect(await result).toMatchObject({
      ok: false,
      code: 'DEADLINE_EXCEEDED',
      attempts: [
        { index: 1, httpStatus: 503 },
        { index: 2, httpStatus: 200, outcome: 'DEADLINE_EXCEEDED' },
      ],
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('publishes prior responses and current acceptance before a second attempt stalls', async () => {
    const { fetcher, transport } = fixture();
    const onProgress = vi.fn<(progress: TransportProgress) => void>();
    const abort = new AbortController();
    fetcher.mockResolvedValueOnce(
      new Response(null, { status: 503, headers: { 'Retry-After': '1' } }),
    );
    fetcher.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const result = transport(request({ onProgress, signal: abort.signal }));
    expect(onProgress.mock.calls[0]?.[0]).toEqual({ completedAttempts: [], activeAttempt: null });
    await vi.advanceTimersByTimeAsync(1001);
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({
      completedAttempts: [
        { index: 1, httpStatus: 503, outcome: 'HTTP_ERROR', acceptance: 'RESPONDED' },
      ],
      activeAttempt: { index: 2, httpStatus: null, acceptance: 'POSSIBLE', usage: unknownUsage() },
    });
    abort.abort();
    const completed = await result;
    expect(completed).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(onProgress.mock.lastCall?.[0]).toEqual({
      completedAttempts: completed.attempts,
      activeAttempt: null,
    });
  });

  it('publishes known usage before rejecting model content and isolates observer mutations', async () => {
    const { fetcher, transport } = fixture();
    const snapshots: TransportProgress[] = [];
    const onProgress = (progress: TransportProgress): void => {
      snapshots.push(structuredClone(progress));
      if (progress.activeAttempt) Object.assign(progress.activeAttempt.usage, { inputTokens: 999 });
      for (const attempt of progress.completedAttempts)
        Object.assign(attempt.usage, { inputTokens: 999 });
    };
    fetcher.mockResolvedValue(
      response(
        envelope({
          model: 'unexpected',
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        }),
      ),
    );
    const result = await transport(request({ onProgress }));
    expect(snapshots).toContainEqual({
      completedAttempts: [],
      activeAttempt: {
        index: 1,
        httpStatus: 200,
        acceptance: 'RESPONDED',
        elapsedMs: 0,
        usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10, cachedInputTokens: null },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'MODEL_IDENTITY_MISMATCH',
      attempts: [{ usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } }],
    });
  });

  it('ignores observer errors and publishes no delivery for pre-cancelled requests', async () => {
    const { fetcher, transport } = fixture();
    fetcher.mockResolvedValue(response());
    const onProgress = vi.fn<(progress: TransportProgress) => void>(() => {
      throw new Error('PRIVATE_OBSERVER_ERROR');
    });
    expect((await transport(request({ onProgress }))).ok).toBe(true);
    const abort = new AbortController();
    abort.abort();
    onProgress.mockClear();
    expect(await transport(request({ onProgress, signal: abort.signal }))).toMatchObject({
      ok: false,
      code: 'CANCELLED',
      attempts: [],
    });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({
      completedAttempts: [],
      activeAttempt: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a parse result that finishes after the shared deadline', async () => {
    const { fetcher, transport } = fixture();
    fetcher.mockResolvedValue(response());
    const parse = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementation((value: string) => {
      vi.advanceTimersByTime(101);
      return parse(value) as unknown;
    });
    expect(await transport(request({ deadlineAt: performance.now() + 100 }))).toMatchObject({
      ok: false,
      code: 'DEADLINE_EXCEEDED',
    });
  });

  it('does not send an already cancelled or expired request', async () => {
    const { fetcher, transport } = fixture();
    const abort = new AbortController();
    abort.abort();
    expect(await transport(request({ signal: abort.signal }))).toMatchObject({
      ok: false,
      code: 'CANCELLED',
      attempts: [],
    });
    expect(await transport(request({ deadlineAt: performance.now() }))).toMatchObject({
      ok: false,
      code: 'DEADLINE_EXCEEDED',
      attempts: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { apiKey: '' },
    { apiKey: 'synthetic\nunsafe' },
    { deadlineAt: Number.NaN },
    { maxResponseBytes: 0 },
    { expectedResponseModels: [] },
  ])('fails invalid configuration before transmission: %j', async (overrides) => {
    const { fetcher, transport } = fixture();
    expect(await transport(request(overrides))).toMatchObject({
      ok: false,
      code: 'CONFIGURATION_ERROR',
      attempts: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('bounded JSON depth for outer and embedded model content', () => {
  it('accepts32 levels and rejects33 without parsing', () => {
    expect(isWithinJsonDepth('['.repeat(32) + '0' + ']'.repeat(32))).toBe(true);
    expect(isWithinJsonDepth('['.repeat(33) + '0' + ']'.repeat(33))).toBe(false);
    expect(isWithinJsonDepth(JSON.stringify({ text: '[{\\"'.repeat(100) }))).toBe(true);
  });
  it.each(['[', '}', '{"a":"unfinished', '"escaped\\'])(
    'rejects incomplete lexical structure: %s',
    (value) => {
      expect(isWithinJsonDepth(value)).toBe(false);
    },
  );
});
