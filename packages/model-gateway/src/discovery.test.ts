import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  FIREWORKS_ENDPOINT,
  unknownUsage,
  type FireworksDiscoveryTransport,
  type FireworksDiscoveryTransportRequest,
  type FireworksTransport,
  type TransportJournal,
  type TransportResponseReceipt,
} from './contracts.js';

import { createFireworksDiscoveryTransport, createFireworksTransport } from './index.js';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function journalFixture() {
  const responses: TransportResponseReceipt[] = [];
  const beforeAttempt = vi.fn<TransportJournal['beforeAttempt']>().mockResolvedValue('ADMITTED');
  const recordResponse = vi
    .fn<TransportJournal['recordResponse']>()
    .mockImplementation(async (receipt) => {
      responses.push(structuredClone(receipt));
    });
  const completeAttempt = vi.fn<TransportJournal['completeAttempt']>().mockResolvedValue();
  return { responses, beforeAttempt, recordResponse, completeAttempt };
}

function input(
  overrides: Partial<FireworksDiscoveryTransportRequest> = {},
): FireworksDiscoveryTransportRequest {
  return {
    apiKey: 'SECRET_SYNTHETIC_KEY',
    body: JSON.stringify({
      model: 'synthetic-request-route',
      stream: false,
      messages: [{ role: 'user', content: 'Synthetic transport-only probe' }],
    }),
    maxResponseBytes: 4096,
    deadlineAt: performance.now() + 5000,
    maxAttempts: 1,
    journal: journalFixture(),
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'SECRET_RESPONSE_ID',
    model: 'SECRET_UNOBSERVED_MODEL',
    choices: [
      {
        index: 0,
        finish_reason: 'length',
        message: { role: 'assistant', content: 'SECRET_RAW_CONTENT' },
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 2,
      total_tokens: 12,
      prompt_tokens_details: { cached_tokens: 3 },
    },
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('transport-only Fireworks discovery', () => {
  it('has a separate compiled return type and exposes no gateway observation or completion', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(envelope()));
    const discovery = createFireworksDiscoveryTransport({ fetch });
    expectTypeOf(discovery).toEqualTypeOf<FireworksDiscoveryTransport>();
    expectTypeOf(discovery).not.toExtend<FireworksTransport>();
    expectTypeOf(createFireworksTransport({ fetch })).toEqualTypeOf<FireworksTransport>();
    const journal = journalFixture();
    const request = input({ journal });
    const result = await discovery(request);
    expect(result).toMatchObject({
      ok: true,
      captured: true,
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 3 },
      attempts: [{ index: 1, httpStatus: 200, acceptance: 'RESPONDED', outcome: 'COMPLETED' }],
    });
    expect(Object.keys(result).sort()).toEqual(['attempts', 'captured', 'ok', 'usage']);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(journal.responses[0]?.body).toBe(envelope());
    expect(journal.beforeAttempt).toHaveBeenCalledWith({
      index: 1,
      wireRequestHash: createHash('sha256').update(request.body).digest('hex'),
    });
    expect(fetch).toHaveBeenCalledWith(FIREWORKS_ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer SECRET_SYNTHETIC_KEY',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: request.body,
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    {},
    { model: null, choices: [] },
    {
      model: 99,
      choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ name: 'untrusted' }] } }],
    },
    {
      model: 'new/unapproved/model',
      choices: [{ finish_reason: 'content_filter', message: { refusal: 'untrusted refusal' } }],
    },
  ])('captures a JSON object without approving its model, content or finish %#', async (body) => {
    const raw = JSON.stringify(body);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(raw));
    const journal = journalFixture();
    const result = await createFireworksDiscoveryTransport({ fetch })(input({ journal }));
    expect(result).toMatchObject({ ok: true, captured: true, usage: unknownUsage() });
    expect(journal.responses[0]?.body).toBe(raw);
    expect(result).not.toHaveProperty('model');
    expect(result).not.toHaveProperty('content');
    expect(result).not.toHaveProperty('output');
    expect(result).not.toHaveProperty('status');
  });

  it('does not weaken normal model identity, empty-allowlist, or finish gates', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response(envelope()));
    const normal = createFireworksTransport({ fetch });
    expect(await normal({ ...input(), expectedResponseModels: ['approved-model'] })).toMatchObject({
      ok: false,
      code: 'MODEL_IDENTITY_MISMATCH',
    });
    expect(await normal({ ...input(), expectedResponseModels: [] })).toMatchObject({
      ok: false,
      code: 'CONFIGURATION_ERROR',
      attempts: [],
    });
    expect(
      await normal({ ...input(), expectedResponseModels: ['SECRET_UNOBSERVED_MODEL'] }),
    ).toMatchObject({ ok: false, code: 'TRUNCATED' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await createFireworksDiscoveryTransport({ fetch })(input())).toMatchObject({
      ok: true,
      captured: true,
    });
  });

  it('cannot override the fixed host or change normal behavior with extra discovery properties', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response(envelope()));
    await createFireworksDiscoveryTransport({ fetch })({
      ...input(),
      ...{
        url: 'https://untrusted.invalid',
        endpoint: 'https://untrusted.invalid',
        expectedResponseModels: [],
      },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(FIREWORKS_ENDPOINT);
    const normal = await createFireworksTransport({ fetch })({
      ...input(),
      expectedResponseModels: ['approved-model'],
      ...{ mode: 'DISCOVERY', captured: true },
    });
    expect(normal).toMatchObject({ ok: false, code: 'MODEL_IDENTITY_MISMATCH' });
  });

  it('awaits durable raw capture before completion and before returning capture success', async () => {
    const started = gate();
    const stored = gate();
    const journal = journalFixture();
    journal.recordResponse.mockImplementation(async (receipt) => {
      journal.responses.push(receipt);
      started.resolve();
      await stored.promise;
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(envelope()));
    const pending = createFireworksDiscoveryTransport({ fetch })(input({ journal }));
    await started.promise;
    expect(journal.completeAttempt).not.toHaveBeenCalled();
    stored.resolve();
    expect(await pending).toMatchObject({ ok: true, captured: true });
    expect(journal.completeAttempt).toHaveBeenCalledOnce();
  });

  it.each(['', '{broken json', 'null', '[]', '"raw string"'])(
    'journals malformed/non-object 2xx bodies before failing without reflection: %j',
    async (raw) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(raw));
      const journal = journalFixture();
      const result = await createFireworksDiscoveryTransport({ fetch })(input({ journal }));
      expect(result).toMatchObject({
        ok: false,
        code: 'INVALID_RESPONSE',
        attempts: [{ outcome: 'INVALID_RESPONSE', acceptance: 'RESPONDED' }],
      });
      expect(journal.responses).toEqual([{ index: 1, status: 200, body: raw, retryDelayMs: 0 }]);
      expect(result).not.toHaveProperty('captured');
    },
  );

  it('preserves unknown usage and rejects contradictory accounting without inventing zero spend', async () => {
    const journal = journalFixture();
    const raw = envelope({
      usage: { prompt_tokens: 10_000, completion_tokens: 100, total_tokens: 0 },
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(raw));
    const result = await createFireworksDiscoveryTransport({ fetch })(input({ journal }));
    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_RESPONSE',
      attempts: [
        {
          usage: {
            inputTokens: 10_000,
            outputTokens: 100,
            totalTokens: null,
            cachedInputTokens: null,
          },
        },
      ],
    });
    expect(journal.responses[0]?.body).toBe(raw);
    expect(journal.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'INVALID_RESPONSE' }),
    );
  });

  it('requires an accounting journal before any discovery fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { journal: omitted, ...request } = input();
    expect(omitted).toBeDefined();
    expect(await createFireworksDiscoveryTransport({ fetch })(request)).toEqual({
      ok: false,
      code: 'ACCOUNTING_REQUIRED',
      attempts: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['beforeAttempt', 'recordResponse', 'completeAttempt'] as const)(
    'fails closed on journal failure at %s',
    async (stage) => {
      const journal = journalFixture();
      journal[stage].mockRejectedValue(new Error('SECRET_DATABASE_ERROR'));
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(envelope()));
      const result = await createFireworksDiscoveryTransport({ fetch })(input({ journal }));
      expect(result).toMatchObject({ ok: false, code: 'JOURNAL_ERROR' });
      expect(result).not.toHaveProperty('captured');
      expect(JSON.stringify(result)).not.toContain('SECRET');
      expect(fetch).toHaveBeenCalledTimes(stage === 'beforeAttempt' ? 0 : 1);
    },
  );

  it('checks cancellation after awaited admission and never performs a late send', async () => {
    const started = gate();
    const admitted = gate();
    const controller = new AbortController();
    const journal = journalFixture();
    journal.beforeAttempt.mockImplementation(async () => {
      started.resolve();
      await admitted.promise;
      return 'ADMITTED';
    });
    const fetch = vi.fn<typeof globalThis.fetch>();
    const pending = createFireworksDiscoveryTransport({ fetch })(
      input({ journal, signal: controller.signal }),
    );
    await started.promise;
    controller.abort(new Error('SECRET_CANCEL_REASON'));
    admitted.resolve();
    const result = await pending;
    expect(result).toMatchObject({
      ok: false,
      code: 'CANCELLED',
      attempts: [{ acceptance: 'NOT_SENT' }],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('bounds a hung fetch and retains ambiguous acceptance', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => new Promise<Response>(() => undefined));
    const pending = createFireworksDiscoveryTransport({ fetch })(
      input({ deadlineAt: performance.now() + 50 }),
    );
    await vi.advanceTimersByTimeAsync(51);
    expect(await pending).toMatchObject({
      ok: false,
      code: 'DEADLINE_EXCEEDED',
      attempts: [{ acceptance: 'POSSIBLE' }],
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('enforces the UTF-8 response byte bound without journaling a partial body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"x":"😀😀"}'));
    const journal = journalFixture();
    expect(
      await createFireworksDiscoveryTransport({ fetch })(input({ journal, maxResponseBytes: 12 })),
    ).toMatchObject({ ok: false, code: 'RESPONSE_TOO_LARGE' });
    expect(journal.recordResponse).not.toHaveBeenCalled();
    expect(journal.completeAttempt).toHaveBeenCalledOnce();
  });

  it('records non-2xx status with no error-body reflection and honors a one-attempt plan', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('SECRET_PROVIDER_ERROR', { status: 503 }));
    const journal = journalFixture();
    const result = await createFireworksDiscoveryTransport({ fetch })(
      input({ journal, maxAttempts: 1 }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'HTTP_ERROR',
      attempts: [{ httpStatus: 503, outcome: 'HTTP_ERROR' }],
    });
    expect(journal.responses[0]).toMatchObject({ index: 1, status: 503, body: null });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('replays saved raw capture locally after the original send deadline without another fetch', async () => {
    const journal = journalFixture();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const result = await createFireworksDiscoveryTransport({ fetch })(
      input({
        apiKey: '',
        journal,
        sendDeadlineAt: performance.now() - 1,
        replay: {
          attempts: [],
          response: { index: 1, status: 200, body: envelope(), retryDelayMs: 0 },
        },
      }),
    );
    expect(result).toMatchObject({ ok: true, captured: true, usage: { totalTokens: 12 } });
    expect(fetch).not.toHaveBeenCalled();
    expect(journal.beforeAttempt).not.toHaveBeenCalled();
    expect(journal.recordResponse).not.toHaveBeenCalled();
    expect(journal.completeAttempt).toHaveBeenCalledOnce();
  });
});
