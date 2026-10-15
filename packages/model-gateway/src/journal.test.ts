import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  unknownUsage,
  type FireworksTransportRequest,
  type GatewayJournalFactory,
  type TransportJournal,
  type TransportResponseReceipt,
} from './contracts.js';
import { createFireworksGateway } from './gateway.js';
import {
  journalFactoryFixture,
  journalFixture,
  observationFixture,
  releaseFixture,
  requestFixture,
  TEST_ARTIFACT_HASH,
} from './test-fixtures.js';
import { createFireworksTransport } from './transport.js';

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function latch() {
  const deferred = gate<undefined>();
  return {
    promise: deferred.promise,
    resolve: () => {
      deferred.resolve(undefined);
    },
  };
}

const model = 'accounts/fixture/models/observed-response';
function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'synthetic-response',
    model,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(observationFixture()) },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    ...overrides,
  });
}
function request(overrides: Partial<FireworksTransportRequest> = {}): FireworksTransportRequest {
  return {
    apiKey: 'synthetic-key',
    body: '{"synthetic":true}',
    expectedResponseModels: [model],
    maxResponseBytes: 4096,
    deadlineAt: performance.now() + 5000,
    maxAttempts: 2,
    journal: journalFixture(),
    ...overrides,
  };
}
function gateway(fetch: typeof globalThis.fetch, journalFactory?: GatewayJournalFactory) {
  return createFireworksGateway({
    apiKey: 'synthetic-key',
    releases: [releaseFixture()],
    implementationArtifactSha256: TEST_ARTIFACT_HASH,
    transport: createFireworksTransport({ fetch }),
    ...(journalFactory ? { journalFactory } : {}),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('awaited native attempt journal', () => {
  it('requires explicit accounting before native transport or gateway can send', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { journal: omittedJournal, ...input } = request();
    expect(omittedJournal).toBeDefined();
    expect(await createFireworksTransport({ fetch })(input)).toMatchObject({
      ok: false,
      code: 'ACCOUNTING_REQUIRED',
      attempts: [],
    });
    expect(await gateway(fetch).generate(requestFixture())).toMatchObject({
      status: 'FAILED',
      code: 'ACCOUNTING_REQUIRED',
      attempts: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('waits for exact wire admission before fetch', async () => {
    const admission = gate<'ADMITTED'>();
    const started = latch();
    const beforeAttempt = vi.fn<TransportJournal['beforeAttempt']>().mockImplementation(() => {
      started.resolve();
      return admission.promise;
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(envelope()));
    const input = request({ journal: { ...journalFixture(), beforeAttempt } });
    const pending = createFireworksTransport({ fetch })(input);
    await started.promise;
    expect(fetch).not.toHaveBeenCalled();
    expect(beforeAttempt).toHaveBeenCalledWith({
      index: 1,
      wireRequestHash: createHash('sha256').update(input.body).digest('hex'),
    });
    admission.resolve('ADMITTED');
    expect(await pending).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never sends after cancellation while admission was pending', async () => {
    const admission = gate<'ADMITTED'>();
    const started = latch();
    const controller = new AbortController();
    const completeAttempt = vi.fn<TransportJournal['completeAttempt']>().mockResolvedValue();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const pending = createFireworksTransport({ fetch })(
      request({
        signal: controller.signal,
        journal: {
          ...journalFixture(),
          beforeAttempt: async () => {
            started.resolve();
            return admission.promise;
          },
          completeAttempt,
        },
      }),
    );
    await started.promise;
    controller.abort(new Error('PRIVATE_CANCELLATION'));
    admission.resolve('ADMITTED');
    const result = await pending;
    expect(result).toMatchObject({
      ok: false,
      code: 'CANCELLED',
      attempts: [{ acceptance: 'NOT_SENT' }],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(completeAttempt).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it.each(['beforeAttempt', 'recordResponse', 'completeAttempt'] as const)(
    'stops and sanitizes a failed %s write',
    async (stage) => {
      const journal = journalFixture();
      journal[stage] = async () => {
        throw new Error('PRIVATE_DATABASE_DETAIL');
      };
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(null, { status: 503 }));
      const result = await createFireworksTransport({ fetch })(request({ journal }));
      expect(result).toMatchObject({ ok: false, code: 'JOURNAL_ERROR' });
      expect(fetch).toHaveBeenCalledTimes(stage === 'beforeAttempt' ? 0 : 1);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    },
  );

  it('commits the response and attempt before reserving and sending the retry', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const events: string[] = [];
    const firstCompletion = latch();
    const completionStarted = latch();
    const journal: TransportJournal = {
      beforeAttempt: async ({ index }) => {
        events.push(`admit${String(index)}`);
        return 'ADMITTED';
      },
      recordResponse: async ({ index }) => {
        events.push(`raw${String(index)}`);
      },
      completeAttempt: async ({ attempt }) => {
        if (attempt.index === 1) {
          completionStarted.resolve();
          await firstCompletion.promise;
        }
        events.push(`finish${String(attempt.index)}`);
      },
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async () => {
        events.push('http1');
        return new Response(null, { status: 503 });
      })
      .mockImplementationOnce(async () => {
        events.push('http2');
        return new Response(envelope());
      });
    const pending = createFireworksTransport({ fetch })(request({ journal }));
    await completionStarted.promise;
    expect(events).toEqual(['admit1', 'http1', 'raw1']);
    firstCompletion.resolve();
    const result = await pending;
    expect(events).toEqual([
      'admit1',
      'http1',
      'raw1',
      'finish1',
      'admit2',
      'http2',
      'raw2',
      'finish2',
    ]);
    expect(result).toMatchObject({
      ok: true,
      usage: unknownUsage(),
      attempts: [{ usage: unknownUsage() }, { usage: { totalTokens: 12 } }],
    });
  });

  it('does not fabricate an attempt when the retry allocation is denied', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const journal: TransportJournal = {
      ...journalFixture(),
      beforeAttempt: async ({ index }) => (index === 1 ? 'ADMITTED' : 'BUDGET_EXCEEDED'),
    };
    const result = await createFireworksTransport({ fetch })(request({ journal }));
    expect(result).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
    expect(result.attempts).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid JSON', '{', 'INVALID_RESPONSE'],
    ['wrong model', envelope({ model: 'unapproved' }), 'MODEL_IDENTITY_MISMATCH'],
    [
      'unfinished output',
      envelope({
        choices: [
          { index: 0, finish_reason: 'length', message: { role: 'assistant', content: '{}' } },
        ],
      }),
      'TRUNCATED',
    ],
  ])('saves bounded raw %s before rejecting it', async (_name, body, code) => {
    const events: string[] = [];
    let raw: TransportResponseReceipt | undefined;
    const journal: TransportJournal = {
      ...journalFixture(),
      recordResponse: async (receipt) => {
        raw = receipt;
        events.push('raw');
      },
      completeAttempt: async () => {
        expect(raw?.body).toBe(body);
        events.push('finish');
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body));
    const result = await createFireworksTransport({ fetch })(request({ journal }));
    expect(result).toMatchObject({ ok: false, code });
    expect(events).toEqual(['raw', 'finish']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('revalidates a saved response after the original send deadline without another HTTP request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const beforeAttempt = vi.fn<TransportJournal['beforeAttempt']>();
    const recordResponse = vi.fn<TransportJournal['recordResponse']>();
    const completeAttempt = vi.fn<TransportJournal['completeAttempt']>().mockResolvedValue();
    const result = await createFireworksTransport({ fetch })(
      request({
        sendDeadlineAt: performance.now() - 1,
        journal: { beforeAttempt, recordResponse, completeAttempt },
        replay: {
          attempts: [],
          response: { index: 1, status: 200, body: envelope(), retryDelayMs: 0 },
        },
      }),
    );
    expect(result).toMatchObject({ ok: true, usage: { totalTokens: 12 } });
    expect(fetch).not.toHaveBeenCalled();
    expect(beforeAttempt).not.toHaveBeenCalled();
    expect(recordResponse).not.toHaveBeenCalled();
    expect(completeAttempt).toHaveBeenCalledOnce();
  });

  it.each([
    { prompt_tokens: 10000, completion_tokens: 100, total_tokens: 0 },
    { prompt_tokens: 10, total_tokens: 9 },
    { completion_tokens: 10, total_tokens: 9 },
    { prompt_tokens: 10, completion_tokens: 2, total_tokens: 13 },
    {
      prompt_tokens: 10,
      completion_tokens: 2,
      total_tokens: 12,
      prompt_tokens_details: { cached_tokens: 11 },
    },
    { total_tokens: 12, prompt_tokens_details: { cached_tokens: 13 } },
  ])(
    'retains unknown total liability when provider usage contradicts itself: %j',
    async (usage) => {
      const completeAttempt = vi.fn<TransportJournal['completeAttempt']>().mockResolvedValue();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(envelope({ usage })));
      const result = await createFireworksTransport({ fetch })(
        request({ journal: { ...journalFixture(), completeAttempt } }),
      );
      expect(result).toMatchObject({
        ok: false,
        code: 'INVALID_RESPONSE',
        attempts: [{ usage: { totalTokens: null, cachedInputTokens: null } }],
      });
      expect(completeAttempt).toHaveBeenCalledWith({
        attempt: expect.objectContaining({ usage: expect.objectContaining({ totalTokens: null }) }),
        errorCode: 'INVALID_RESPONSE',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('cannot renew an expired send deadline by replaying a retryable receipt', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const beforeAttempt = vi.fn<TransportJournal['beforeAttempt']>();
    const result = await createFireworksTransport({ fetch })(
      request({
        sendDeadlineAt: performance.now() - 1,
        journal: { ...journalFixture(), beforeAttempt },
        replay: { attempts: [], response: { index: 1, status: 503, body: null, retryDelayMs: 0 } },
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'HTTP_ERROR', attempts: [{ index: 1 }] });
    expect(fetch).not.toHaveBeenCalled();
    expect(beforeAttempt).not.toHaveBeenCalled();
  });

  it.each([
    [envelope(), 'COMPLETED', null],
    [envelope({ model: 'unapproved' }), 'INVALID_RESPONSE', 'MODEL_IDENTITY_MISMATCH'],
  ] as const)(
    'keeps definite usage/interpretation when caller aborts after parsing',
    async (body, outcome, errorCode) => {
      const controller = new AbortController();
      const completeAttempt = vi.fn<TransportJournal['completeAttempt']>().mockResolvedValue();
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body));
      const journal = { ...journalFixture(), completeAttempt };
      const result = await createFireworksTransport({ fetch })(
        request({
          journal,
          signal: controller.signal,
          onProgress: (snapshot) => {
            if (snapshot.activeAttempt?.usage.totalTokens === 12) controller.abort();
          },
        }),
      );
      expect(result).toMatchObject({
        ok: false,
        code: 'CANCELLED',
        attempts: [{ outcome, usage: { totalTokens: 12 } }],
      });
      expect(completeAttempt).toHaveBeenLastCalledWith({
        attempt: expect.objectContaining({
          outcome,
          usage: expect.objectContaining({ totalTokens: 12 }),
        }),
        errorCode,
      });
      const replayed = await createFireworksTransport({ fetch })(
        request({
          journal,
          replay: { attempts: [], response: { index: 1, status: 200, body, retryDelayMs: 0 } },
        }),
      );
      expect(replayed.attempts).toMatchObject([{ outcome, usage: { totalTokens: 12 } }]);
      expect(completeAttempt).toHaveBeenLastCalledWith({
        attempt: expect.objectContaining({
          outcome,
          usage: expect.objectContaining({ totalTokens: 12 }),
        }),
        errorCode,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('returns a journal failure when validated output cannot be committed', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(envelope()));
    const fixture = journalFactoryFixture();
    const journalFactory: GatewayJournalFactory = {
      open: async (binding, options) => {
        const opened = await fixture.open(binding, options);
        if (opened.kind !== 'READY') throw new Error('FIXTURE_REQUIRED');
        return {
          ...opened,
          session: {
            ...opened.session,
            complete: async () => {
              throw new Error('PRIVATE_COMMIT');
            },
          },
        };
      },
    };
    const result = await gateway(fetch, journalFactory).generate(requestFixture());
    expect(result).toMatchObject({
      status: 'FAILED',
      code: 'JOURNAL_ERROR',
      attempts: [{ usage: { totalTokens: 12 } }],
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('does not send when journal opening completes after caller cancellation', async () => {
    const opened = latch();
    const release = latch();
    const settled = latch();
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fixture = journalFactoryFixture();
    const journalFactory: GatewayJournalFactory = {
      open: async (binding, options) => {
        opened.resolve();
        await release.promise;
        const result = await fixture.open(binding, options);
        settled.resolve();
        return result;
      },
    };
    const pending = gateway(fetch, journalFactory).generate(requestFixture(), {
      signal: controller.signal,
    });
    await opened.promise;
    controller.abort();
    expect(await pending).toMatchObject({ status: 'FAILED', code: 'CANCELLED' });
    release.resolve();
    await settled.promise;
    expect(fetch).not.toHaveBeenCalled();
  });
});
