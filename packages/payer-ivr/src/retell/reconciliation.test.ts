import { ReadableStream } from 'node:stream/web';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RetellCallEndReason } from './events.js';
import {
  createRetellReconciliationClient,
  RetellReconciliationError,
  type RetellReconciliationClientOptions,
} from './reconciliation.js';
import { parseRetellWebhookEnvelope } from './webhook.js';

const intentId = 'cmsyntheticintent12345';
const started = Date.parse('2026-10-13T10:00:00.000Z');
function response(
  body: ConstructorParameters<typeof Response>[0],
  init?: ConstructorParameters<typeof Response>[1],
): Awaited<ReturnType<typeof fetch>> {
  // The SDK's DOM Response requires bytes(), absent from this repo's Node types.
  // This adapter only reads status and body, both provided by native Response.
  return new Response(body, init) as Awaited<ReturnType<typeof fetch>>;
}
function jsonResponse(body: unknown): Awaited<ReturnType<typeof fetch>> {
  return response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}
function phone(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    call_id: 'call_synthetic',
    agent_id: 'agent_synthetic',
    call_type: 'phone_call',
    call_status: 'registered',
    direction: 'outbound',
    from_number: '+15555550101',
    to_number: '+15555550102',
    metadata: { dentabill_intent_id: intentId },
    ...overrides,
  };
}
function page(items: unknown[], extras: Record<string, unknown> = {}): unknown {
  return { items, has_more: false, ...extras };
}
function transportReturning(...bodies: unknown[]): ReturnType<typeof vi.fn<typeof fetch>> {
  let index = 0;
  return vi.fn<typeof fetch>(async () => {
    if (index >= bodies.length) throw new Error('Unexpected synthetic transport request');
    return jsonResponse(bodies[index++]);
  });
}
function client(
  fetch: typeof globalThis.fetch,
  options: Partial<RetellReconciliationClientOptions> = {},
) {
  return createRetellReconciliationClient({ apiKey: 'synthetic-key', fetch, ...options });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Retell read-only discovery HTTP contract', () => {
  it('uses exact v3 metadata equality across all pages and returns only identity fields', async () => {
    const fetch = transportReturning(
      page(
        [
          phone({
            start_timestamp: started,
            transcript: 'not returned',
            call_analysis: { secret: true },
          }),
        ],
        { has_more: true, pagination_key: 'opaque+/cursor==' },
      ),
      page([phone({ call_id: 'call_second' })]),
    );
    const found = await client(fetch).findCallsByIntent({ intentId });
    expect(found).toEqual([
      {
        providerCallId: 'call_synthetic',
        agentId: 'agent_synthetic',
        fromNumberE164: '+15555550101',
        toNumberE164: '+15555550102',
        direction: 'outbound',
        callType: 'phone_call',
        intentId,
        startedAt: '2026-10-13T10:00:00.000Z',
      },
      expect.objectContaining({ providerCallId: 'call_second', startedAt: null }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const requestBody = {
      filter_criteria: {
        metadata: [{ key: 'dentabill_intent_id', type: 'string', op: 'eq', value: intentId }],
      },
      sort_order: 'descending',
      limit: 10,
      include_total: false,
    };
    for (const [index, [url, init]] of fetch.mock.calls.entries()) {
      expect(url).toBe('https://api.retellai.com/v3/list-calls');
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: 'Bearer synthetic-key', 'Content-Type': 'application/json' },
      });
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
      expect(JSON.parse(init.body)).toEqual({
        ...requestBody,
        ...(index === 0 ? {} : { pagination_key: 'opaque+/cursor==' }),
      });
    }
  });

  it('does not hide inbound or web candidates from the binding policy', async () => {
    const fetch = transportReturning(
      page([
        phone({ direction: 'inbound' }),
        {
          call_id: 'web_synthetic',
          agent_id: 'agent_synthetic',
          call_type: 'web_call',
          call_status: 'ongoing',
          metadata: { dentabill_intent_id: intentId },
          access_token: 'must-never-be-returned',
        },
      ]),
    );
    expect(await client(fetch).findCallsByIntent({ intentId })).toEqual([
      expect.objectContaining({ direction: 'inbound' }),
      {
        providerCallId: 'web_synthetic',
        agentId: 'agent_synthetic',
        intentId,
        callType: 'web_call',
        fromNumberE164: null,
        toNumberE164: null,
        direction: null,
        startedAt: null,
      },
    ]);
  });

  it('returns a completed empty enumeration without making another request', async () => {
    const fetch = transportReturning(page([]));
    expect(await client(fetch).findCallsByIntent({ intentId })).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['old v2 array', [phone()]],
    ['missing has_more', { items: [phone()] }],
    ['nonboolean has_more', { items: [phone()], has_more: 'false' }],
    ['wrong items shape', { items: {}, has_more: false }],
    ['null cursor', page([], { pagination_key: null })],
    ['missing metadata', page([phone({ metadata: {} })])],
    ['invalid call kind', page([phone({ call_type: 'sms' })])],
    ['invalid direction', page([phone({ direction: 'sideways' })])],
    ['invalid phone identity', page([phone({ from_number: '555-5555' })])],
    ['invalid timestamp', page([phone({ start_timestamp: -1 })])],
    ['invalid status', page([phone({ call_status: 'maybe_ended' })])],
  ])('rejects malformed %s without returning partial identities', async (_name, body) => {
    await expect(
      client(transportReturning(body)).findCallsByIntent({ intentId }),
    ).rejects.toMatchObject({
      code: 'RESPONSE_INVALID',
    });
  });

  it('rejects a filter mismatch on a later page', async () => {
    const fetch = transportReturning(
      page([phone()], { has_more: true, pagination_key: 'next' }),
      page([
        phone({ call_id: 'call_unrelated', metadata: { dentabill_intent_id: 'other_intent' } }),
      ]),
    );
    await expect(client(fetch).findCallsByIntent({ intentId })).rejects.toMatchObject({
      code: 'IDENTITY_MISMATCH',
    });
  });

  it.each([false, true])(
    'rejects repeated provider IDs even when conflicting=%s',
    async (conflicting) => {
      const fetch = transportReturning(
        page([phone()], { has_more: true, pagination_key: 'next' }),
        page([phone(conflicting ? { agent_id: 'different_agent' } : {})]),
      );
      await expect(client(fetch).findCallsByIntent({ intentId })).rejects.toMatchObject({
        code: 'DUPLICATE',
      });
    },
  );

  it.each([
    ['missing next cursor', page([phone()], { has_more: true })],
    ['empty continuation page', page([], { has_more: true, pagination_key: 'next' })],
  ])('rejects incomplete %s', async (_name, body) => {
    await expect(
      client(transportReturning(body)).findCallsByIntent({ intentId }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE' });
  });

  it('detects cursor cycles rather than following them', async () => {
    const fetch = transportReturning(
      page([phone()], { has_more: true, pagination_key: 'repeat' }),
      page([phone({ call_id: 'call_second' })], { has_more: true, pagination_key: 'repeat' }),
    );
    await expect(client(fetch).findCallsByIntent({ intentId })).rejects.toMatchObject({
      code: 'INCOMPLETE',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not claim completion when the page cap is reached', async () => {
    const fetch = transportReturning(page([phone()], { has_more: true, pagination_key: 'next' }));
    await expect(
      client(fetch, { maxPages: 1 }).findCallsByIntent({ intentId }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['too many in one page', { pageSize: 1 }, page([phone(), phone({ call_id: 'second' })])],
    [
      'candidate cap with more pages',
      { maxCandidates: 1 },
      page([phone()], { has_more: true, pagination_key: 'next' }),
    ],
  ])('bounds %s', async (_name, options, body) => {
    const fetch = transportReturning(body);
    await expect(client(fetch, options).findCallsByIntent({ intentId })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('enforces cumulative candidate count across pages', async () => {
    const fetch = transportReturning(
      page([phone()], { has_more: true, pagination_key: 'next' }),
      page([phone({ call_id: 'second' }), phone({ call_id: 'third' })]),
    );
    await expect(
      client(fetch, { maxCandidates: 2 }).findCallsByIntent({ intentId }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });
});

describe('Get Call source evidence contract', () => {
  it.each(['ended', 'error'])(
    'uses v2 GET and only existing normalized terminal source evidence for %s',
    async (status) => {
      const raw = phone({
        call_status: status,
        start_timestamp: started,
        end_timestamp: started + 10_900,
        duration_ms: 10_900,
        disconnection_reason: 'agent_hangup',
        transcript: 'Exact synthetic text.  Keep punctuation!',
        transcript_object: [
          { role: 'user', content: 'No business conclusion.', words: [{ start: 0.75 }] },
        ],
        transcript_with_tool_calls: [{ secret: 'ignored tool evidence' }],
        call_analysis: { call_successful: true, call_summary: 'Unsupported business conclusion' },
        recording_url: 'https://example.invalid/private-recording',
      });
      const fetch = transportReturning(raw);
      const result = await client(fetch).getCall({ providerCallId: 'call_synthetic' });
      const normalized = parseRetellWebhookEnvelope(
        JSON.stringify({ event: 'call_ended', call: raw }),
      );
      expect(result.terminalEvent).toEqual(normalized.event);
      expect(result.terminalEvent).toMatchObject({
        endReason:
          status === 'error' ? RetellCallEndReason.ERROR : RetellCallEndReason.AGENT_HANGUP,
        durationSeconds: 10,
        transcript: {
          text: 'Exact synthetic text.  Keep punctuation!',
          turns: [{ role: 'user', text: 'No business conclusion.', startOffsetSeconds: 0.75 }],
        },
      });
      expect(Object.keys(result).sort()).toEqual(['candidate', 'terminalEvent']);
      expect(JSON.stringify(result)).not.toMatch(
        /Unsupported business|ignored tool|private-recording|eventId/,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]).toEqual([
        'https://api.retellai.com/v2/get-call/call_synthetic',
        expect.objectContaining({ method: 'GET', redirect: 'error' }),
      ]);
      expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('body');
    },
  );

  it('preserves unknown timing and missing transcript instead of inventing evidence', async () => {
    const fetch = transportReturning(
      phone({ call_status: 'error', disconnection_reason: 'dial_failed' }),
    );
    const result = await client(fetch).getCall({ providerCallId: 'call_synthetic' });
    expect(result.candidate.startedAt).toBeNull();
    expect(result.terminalEvent).toEqual({
      type: 'call.ended',
      retellCallId: 'call_synthetic',
      endedAt: null,
      durationSeconds: null,
      endReason: RetellCallEndReason.ERROR,
      providerEndReason: 'dial_failed',
    });
  });

  it.each(['registered', 'ongoing', 'not_connected'])(
    'does not manufacture terminal evidence for %s',
    async (status) => {
      const result = await client(transportReturning(phone({ call_status: status }))).getCall({
        providerCallId: 'call_synthetic',
      });
      expect(result.terminalEvent).toBeNull();
    },
  );

  it.each([
    phone({ direction: 'inbound', call_status: 'ended' }),
    {
      call_id: 'call_synthetic',
      agent_id: 'agent_synthetic',
      call_type: 'web_call',
      call_status: 'ended',
      metadata: { dentabill_intent_id: intentId },
    },
  ])('returns incompatible identity without forging outbound terminal evidence', async (raw) => {
    const result = await client(transportReturning(raw)).getCall({
      providerCallId: 'call_synthetic',
    });
    expect(result.terminalEvent).toBeNull();
  });

  it('rejects a Get Call identity that differs from the requested ID', async () => {
    await expect(
      client(transportReturning(phone({ call_id: 'wrong_call' }))).getCall({
        providerCallId: 'call_synthetic',
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
  });

  it.each([
    { call_status: 'ended' },
    { call_status: 'error', disconnection_reason: 'dial_failed', transcript: 42 },
    {
      call_status: 'ended',
      disconnection_reason: 'agent_hangup',
      start_timestamp: started,
      end_timestamp: started - 1,
    },
  ])(
    'rejects malformed terminal evidence rather than returning a partial success',
    async (overrides) => {
      await expect(
        client(transportReturning(phone(overrides))).getCall({ providerCallId: 'call_synthetic' }),
      ).rejects.toMatchObject({ code: 'RESPONSE_INVALID' });
    },
  );
});

describe('read-only transport bounds and sanitized failure', () => {
  it.each([401, 404, 429, 500, 302])(
    'never retries HTTP %s or returns response text',
    async (status) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        response('provider body contains synthetic private text', { status }),
      );
      await expect(client(fetch).getCall({ providerCallId: 'call_synthetic' })).rejects.toEqual(
        new RetellReconciliationError('HTTP', status),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a failed later page instead of returning the earlier positive match', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse(page([phone()], { has_more: true, pagination_key: 'next' })),
      )
      .mockRejectedValueOnce(new Error('private transport diagnostic'));
    await expect(client(fetch).findCallsByIntent({ intentId })).rejects.toEqual(
      new RetellReconciliationError('NETWORK'),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('sanitizes invalid JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response('private invalid payload'));
    await expect(client(fetch).findCallsByIntent({ intentId })).rejects.toEqual(
      new RetellReconciliationError('RESPONSE_INVALID'),
    );
  });

  it('caps response bytes and cancels the unread stream', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      },
      cancel,
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(stream));
    await expect(client(fetch).findCallsByIntent({ intentId })).rejects.toEqual(
      new RetellReconciliationError('LIMIT_EXCEEDED'),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('bounds a hung transport even when it ignores abort', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));
    const pending = client(fetch, { timeoutMs: 20 }).findCallsByIntent({ intentId });
    const assertion = expect(pending).rejects.toEqual(new RetellReconciliationError('TIMEOUT'));
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an overdue result even before the timeout callback gets an event-loop turn', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      vi.setSystemTime(Date.now() + 21);
      return jsonResponse(page([]));
    });
    await expect(client(fetch, { timeoutMs: 20 }).findCallsByIntent({ intentId })).rejects.toEqual(
      new RetellReconciliationError('TIMEOUT'),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses one deadline across all pages, including a stalled second response body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(jsonResponse(page([phone()], { has_more: true, pagination_key: 'next' })));
            }, 15);
          }),
      )
      .mockResolvedValueOnce(response(new ReadableStream<Uint8Array>({ cancel })));
    const pending = client(fetch, { timeoutMs: 20 }).findCallsByIntent({ intentId });
    const assertion = expect(pending).rejects.toEqual(new RetellReconciliationError('TIMEOUT'));
    await vi.advanceTimersByTimeAsync(15);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does not follow more pages after a timed-out transport resolves late', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(jsonResponse(page([phone()], { has_more: true, pagination_key: 'next' })));
          }, 50);
        }),
    );
    const assertion = expect(
      client(fetch, { timeoutMs: 20 }).findCallsByIntent({ intentId }),
    ).rejects.toEqual(new RetellReconciliationError('TIMEOUT'));
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    await vi.advanceTimersByTimeAsync(50);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels a stalled body without exposing the external abort reason', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response(new ReadableStream<Uint8Array>({ cancel })),
    );
    const pending = client(fetch).getCall({
      providerCallId: 'call_synthetic',
      signal: controller.signal as AbortSignal,
    });
    const assertion = expect(pending).rejects.toEqual(new RetellReconciliationError('CANCELLED'));
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new Error('private cancellation detail'));
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does no I/O for already-aborted or invalid inputs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const controller = new AbortController();
    controller.abort();
    const adapter = client(fetch);
    await expect(
      adapter.findCallsByIntent({ intentId, signal: controller.signal as AbortSignal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(adapter.findCallsByIntent({ intentId: 'bad value' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
    await expect(adapter.getCall({ providerCallId: '../delete-call/x' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { maxPages: 11 },
    { maxPages: 0 },
    { maxCandidates: 101 },
    { pageSize: 101 },
    { timeoutMs: 30_001 },
    { timeoutMs: Number.NaN },
    { pageSize: 0.5 },
    { apiKey: ' ' },
  ])('rejects invalid bounds or credentials before I/O: %o', (options) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(() => client(fetch, options)).toThrow(RetellReconciliationError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
