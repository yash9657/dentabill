import Retell, { type ClientOptions } from 'retell-sdk';
import { describe, expect, it, vi } from 'vitest';

import type { RetellCtor } from './live.js';

import {
  createRetellPort,
  FakeRetell,
  LiveRetell,
  type RetellEvent,
  type StartCallInput,
} from './index.js';

const sampleInput = (overrides: Partial<StartCallInput> = {}): StartCallInput => ({
  payerCode: 'DELTA_DENTAL_PPO',
  agentId: 'agent_delta_dental_ppo',
  fromNumberE164: '+15551234567',
  toNumberE164: '+18007656003',
  agentMetadata: {
    practiceName: 'Sunrise Family Dental',
    providerNpi: '1234567890',
    subscriberId: 'SUB-001',
    dateOfService: '2026-03-15',
  },
  idempotencyKey: 'claim_test_001-1',
  ...overrides,
});

/**
 * Build a stub `Retell` constructor whose only behaviours we exercise
 * are `call.createPhoneCall` and `call.stop`. Cast to the SDK's
 * default-export type just enough to satisfy LiveRetell's loader.
 */
type StubCreatePhoneCall = (
  body: Record<string, unknown>,
  options: { readonly maxRetries: number; readonly timeout: number },
) => Promise<{ call_id: string }>;
type StubStopCall = (
  callId: string,
  options: { readonly maxRetries: number; readonly timeout: number },
) => Promise<void>;

function buildStubRetell(opts: {
  createPhoneCall?: StubCreatePhoneCall;
  stopCall?: StubStopCall;
}): RetellCtor {
  const ctor = vi.fn(function StubRetell(_config: { apiKey: string }) {
    return {
      call: {
        createPhoneCall:
          opts.createPhoneCall ??
          (async (_body: Record<string, unknown>) => ({ call_id: 'retell_call_stub_1' })),
        stop: opts.stopCall ?? (async (_callId: string) => undefined),
      },
    };
  }) as unknown as RetellCtor;
  return ctor;
}

type RetellFetch = NonNullable<ClientOptions['fetch']>;
// The SDK's DOM Response includes bytes(), absent from the repo's Node type version.
// These synthetic responses only exercise status, headers, and text handling.
type RetellResponse = Awaited<ReturnType<RetellFetch>>;

/** Real installed SDK with an injected transport: no provider request can leave this test. */
function buildSdkRetell(fetch: RetellFetch): LiveRetell {
  class TestRetell extends Retell {
    constructor(config: { apiKey: string }) {
      super({ ...config, fetch, baseURL: 'https://api.retellai.com', logLevel: 'off' });
    }
  }
  return new LiveRetell({ apiKey: 'synthetic-test-key', retellLoader: async () => TestRetell });
}

describe('LiveRetell — construction', () => {
  it('throws when apiKey is empty', () => {
    expect(() => new LiveRetell({ apiKey: '' })).toThrow(/non-empty apiKey/);
  });

  it('does not load retell-sdk on construction (lazy)', () => {
    const loader = vi.fn(async () => buildStubRetell({}));
    new LiveRetell({ apiKey: 'rk_test', retellLoader: loader });
    expect(loader).not.toHaveBeenCalled();
  });
});

describe('LiveRetell — startCall', () => {
  it('forwards the agent + numbers + dynamic variables to retell-sdk', async () => {
    const createPhoneCall = vi.fn<StubCreatePhoneCall>(async (_body) => ({
      call_id: 'retell_call_xyz',
    }));
    const loader = vi.fn(async () => buildStubRetell({ createPhoneCall }));
    const live = new LiveRetell({
      apiKey: 'rk_test',
      retellLoader: loader,
      clock: () => new Date('2026-04-28T15:00:00.000Z'),
    });

    const result = await live.startCall(sampleInput());

    expect(loader).toHaveBeenCalledTimes(1);
    expect(createPhoneCall).toHaveBeenCalledTimes(1);
    const callArg = createPhoneCall.mock.calls[0]![0];
    expect(callArg.from_number).toBe('+15551234567');
    expect(callArg.to_number).toBe('+18007656003');
    expect(callArg.override_agent_id).toBe('agent_delta_dental_ppo');
    expect(callArg.retell_llm_dynamic_variables).toEqual({
      practice_name: 'Sunrise Family Dental',
      provider_npi: '1234567890',
      subscriber_id: 'SUB-001',
      date_of_service: '2026-03-15',
    });
    expect(callArg.idempotency_key).toBe('claim_test_001-1');
    expect(callArg.metadata).toEqual({
      dentabill_intent_id: 'claim_test_001-1',
      idempotencyKey: 'claim_test_001-1',
      payerCode: 'DELTA_DENTAL_PPO',
    });
    expect(createPhoneCall.mock.calls[0]![1]).toEqual({ maxRetries: 0, timeout: 30_000 });

    expect(result).toEqual({
      retellCallId: 'retell_call_xyz',
      queuedAt: '2026-04-28T15:00:00.000Z',
    });
  });

  it('reuses the same client across multiple startCall invocations', async () => {
    const ctor = vi.fn(function StubRetell(_config: { apiKey: string }) {
      return {
        call: {
          createPhoneCall: async (_body: Record<string, unknown>) => ({
            call_id: 'retell_call_x',
          }),
          stop: async (_id: string) => undefined,
        },
      };
    });
    const loader = vi.fn(async () => ctor as unknown as RetellCtor);
    const live = new LiveRetell({ apiKey: 'rk_test', retellLoader: loader });

    await live.startCall(sampleInput());
    await live.startCall(sampleInput({ idempotencyKey: 'claim_two-1' }));

    expect(loader).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed input asynchronously (no synchronous throw)', async () => {
    const loader = vi.fn(async () => buildStubRetell({}));
    const live = new LiveRetell({ apiKey: 'rk_test', retellLoader: loader });
    await expect(live.startCall(sampleInput({ toNumberE164: 'bad' }))).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
  });

  it.each(['abcd', 'invalid.key', 'a'.repeat(256)])(
    'rejects an intent ID outside the provider idempotency-key contract before SDK loading',
    async (idempotencyKey) => {
      const loader = vi.fn(async () => buildStubRetell({}));
      const live = new LiveRetell({ apiKey: 'rk_test', retellLoader: loader });
      await expect(live.startCall(sampleInput({ idempotencyKey }))).rejects.toThrow(
        /idempotency key/,
      );
      expect(loader).not.toHaveBeenCalled();
    },
  );
});

describe('LiveRetell — installed SDK create-call contract (synthetic transport)', () => {
  // Current API docs include body idempotency_key; SDK 5.16.0's types predate it.
  // https://docs.retellai.com/api-references/create-phone-call (2026-10-13).
  it('sends one POST with a real idempotency body field and minimal correlation metadata', async () => {
    const fetch = vi.fn<RetellFetch>(
      async () =>
        Response.json({ call_id: 'call_synthetic_fw25' }, { status: 201 }) as RetellResponse,
    );
    const live = buildSdkRetell(fetch);

    expect(
      await live.startCall(sampleInput({ idempotencyKey: 'intent_synthetic_fw25' })),
    ).toMatchObject({
      retellCallId: 'call_synthetic_fw25',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    const request = new Request(url, init);
    expect(request.url).toBe('https://api.retellai.com/v2/create-phone-call');
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({
      from_number: '+15551234567',
      to_number: '+18007656003',
      override_agent_id: 'agent_delta_dental_ppo',
      idempotency_key: 'intent_synthetic_fw25',
      metadata: {
        dentabill_intent_id: 'intent_synthetic_fw25',
        idempotencyKey: 'intent_synthetic_fw25',
        payerCode: 'DELTA_DENTAL_PPO',
      },
      retell_llm_dynamic_variables: {
        practice_name: 'Sunrise Family Dental',
        provider_npi: '1234567890',
        subscriber_id: 'SUB-001',
        date_of_service: '2026-03-15',
      },
    });
  });

  it.each([400, 401, 402, 408, 409, 422, 429, 500])(
    'propagates create HTTP %s without an implicit SDK retry',
    async (status) => {
      const fetch = vi.fn<RetellFetch>(
        async () =>
          Response.json({ message: 'Synthetic create rejection' }, { status }) as RetellResponse,
      );
      const live = buildSdkRetell(fetch);

      await expect(live.startCall(sampleInput())).rejects.toMatchObject({ status });

      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('does not redial when transport loses the response after accepting the request', async () => {
    const acceptedRequests: unknown[] = [];
    const cause = new TypeError('Synthetic connection lost after request acceptance');
    const fetch = vi.fn<RetellFetch>(async (url, init) => {
      acceptedRequests.push(await new Request(url, init).json());
      throw cause;
    });
    const live = buildSdkRetell(fetch);

    await expect(
      live.startCall(sampleInput({ idempotencyKey: 'intent_synthetic_lost_response' })),
    ).rejects.toMatchObject({ cause });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(acceptedRequests).toHaveLength(1);
    expect(acceptedRequests[0]).toMatchObject({
      idempotency_key: 'intent_synthetic_lost_response',
      metadata: { dentabill_intent_id: 'intent_synthetic_lost_response' },
    });
  });

  it('aborts a stalled create request after thirty seconds without retry', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn<RetellFetch>(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                reject(new DOMException('Synthetic create timeout', 'AbortError'));
              },
              { once: true },
            );
          }),
      );
      const live = buildSdkRetell(fetch);
      const outcome = live.startCall(sampleInput()).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(30_000);

      expect(await Promise.race([outcome, Promise.resolve('still pending')])).toBeInstanceOf(
        Retell.APIConnectionTimeoutError,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('LiveRetell — endCall', () => {
  it('requests stop with a bounded timeout and no SDK retries', async () => {
    const stopCall = vi.fn<StubStopCall>(async (_callId) => undefined);
    const loader = vi.fn(async () => buildStubRetell({ stopCall }));
    const live = new LiveRetell({ apiKey: 'rk_test', retellLoader: loader });

    await live.endCall({ retellCallId: 'retell_call_xyz', reason: 'duration_cap_exceeded' });

    expect(stopCall).toHaveBeenCalledTimes(1);
    expect(stopCall).toHaveBeenCalledWith('retell_call_xyz', {
      maxRetries: 0,
      timeout: 10_000,
    });
  });

  it('rejects malformed input asynchronously', async () => {
    const loader = vi.fn(async () => buildStubRetell({}));
    const live = new LiveRetell({ apiKey: 'rk_test', retellLoader: loader });
    await expect(live.endCall({ retellCallId: 'r', reason: 'made_up' as never })).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
  });
});

describe('LiveRetell — installed SDK stop-call contract (synthetic transport)', () => {
  // Verified against https://docs.retellai.com/api-references/stop-call (2026-10-13).
  // Delete Call removes call data and is not the hard-hangup API.
  it('sends POST /v2/stop-call/{call_id}, accepts 204, and does not synthesize lifecycle events', async () => {
    const fetch = vi.fn<RetellFetch>(
      async () => new Response(null, { status: 204 }) as RetellResponse,
    );
    const live = buildSdkRetell(fetch);
    const listener = vi.fn();
    live.subscribe('call_synthetic_fw28', listener);

    await expect(
      live.endCall({ retellCallId: 'call_synthetic_fw28', reason: 'duration_cap_exceeded' }),
    ).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    const request = new Request(url, init);
    expect(request.url).toBe('https://api.retellai.com/v2/stop-call/call_synthetic_fw28');
    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('');
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([400, 401, 404, 422, 429, 500])(
    'propagates HTTP %s without retry or data-deletion fallback',
    async (status) => {
      const fetch = vi.fn<RetellFetch>(
        async () =>
          Response.json(
            { status: 'error', message: 'Synthetic provider rejection' },
            { status },
          ) as RetellResponse,
      );
      const live = buildSdkRetell(fetch);

      await expect(
        live.endCall({ retellCallId: 'call_synthetic_fw28', reason: 'operator_cancel' }),
      ).rejects.toMatchObject({ status });

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0]!;
      const request = new Request(url, init);
      expect(request.method).toBe('POST');
      expect(request.url).toBe('https://api.retellai.com/v2/stop-call/call_synthetic_fw28');
    },
  );

  it('propagates ambiguous transport failure without retry or data deletion', async () => {
    const cause = new TypeError('Synthetic connection failure');
    const fetch = vi.fn<RetellFetch>(async () => {
      throw cause;
    });
    const live = buildSdkRetell(fetch);

    await expect(
      live.endCall({ retellCallId: 'call_synthetic_fw28', reason: 'hold_cap_exceeded' }),
    ).rejects.toMatchObject({ cause });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled stop request after ten seconds without retry', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn<RetellFetch>(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                reject(new DOMException('Synthetic timeout', 'AbortError'));
              },
              { once: true },
            );
          }),
      );
      const live = buildSdkRetell(fetch);
      const outcome = live
        .endCall({ retellCallId: 'call_synthetic_fw28', reason: 'duration_cap_exceeded' })
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(await Promise.race([outcome, Promise.resolve('still pending')])).toBeInstanceOf(
        Retell.APIConnectionTimeoutError,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('LiveRetell — subscribe + ingest', () => {
  it('fans an ingested event out to subscribed listeners', () => {
    const live = new LiveRetell({ apiKey: 'rk_test' });
    const seen: RetellEvent[] = [];
    live.subscribe('retell_call_a', (event) => {
      seen.push(event);
    });
    live.ingest('retell_call_a', {
      type: 'call.transcript',
      retellCallId: 'retell_call_a',
      role: 'agent',
      text: 'hello',
      timestamp: '2026-04-28T15:00:00.000Z',
    });
    expect(seen).toHaveLength(1);
  });

  it('ingest is a no-op when no listeners are registered', () => {
    const live = new LiveRetell({ apiKey: 'rk_test' });
    expect(() => {
      live.ingest('retell_call_unknown', {
        type: 'call.error',
        retellCallId: 'retell_call_unknown',
        code: 'X',
        message: 'X',
        occurredAt: '2026-04-28T15:00:00.000Z',
      });
    }).not.toThrow();
  });
});

describe('createRetellPort — adapter selection', () => {
  it('returns LiveRetell when apiKey is present', () => {
    const result = createRetellPort({ apiKey: 'rk_real' });
    expect(result.mode).toBe('live');
    expect(result.port).toBeInstanceOf(LiveRetell);
  });

  it('returns FakeRetell when apiKey is absent', () => {
    const result = createRetellPort({ apiKey: undefined });
    expect(result.mode).toBe('fake');
    expect(result.port).toBeInstanceOf(FakeRetell);
  });

  it('returns FakeRetell when apiKey is empty / whitespace', () => {
    expect(createRetellPort({ apiKey: '' }).mode).toBe('fake');
    expect(createRetellPort({ apiKey: '   ' }).mode).toBe('fake');
  });
});
