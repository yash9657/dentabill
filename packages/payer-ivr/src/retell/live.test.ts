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
 * are `call.createPhoneCall` and `call.delete`. Cast to the SDK's
 * default-export type just enough to satisfy LiveRetell's loader.
 */
type StubCreatePhoneCall = (body: Record<string, unknown>) => Promise<{ call_id: string }>;
type StubDeleteCall = (callId: string) => Promise<void>;

function buildStubRetell(opts: {
  createPhoneCall?: StubCreatePhoneCall;
  deleteCall?: StubDeleteCall;
}): RetellCtor {
  const ctor = vi.fn(function StubRetell(_config: { apiKey: string }) {
    return {
      call: {
        createPhoneCall:
          opts.createPhoneCall ??
          (async (_body: Record<string, unknown>) => ({ call_id: 'retell_call_stub_1' })),
        delete: opts.deleteCall ?? (async (_callId: string) => undefined),
      },
    };
  }) as unknown as RetellCtor;
  return ctor;
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
    expect(callArg.metadata).toMatchObject({ idempotencyKey: 'claim_test_001-1' });

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
          delete: async (_id: string) => undefined,
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
});

describe('LiveRetell — endCall', () => {
  it('calls client.call.delete with the retellCallId', async () => {
    const deleteCall = vi.fn<StubDeleteCall>(async (_callId) => undefined);
    const loader = vi.fn(async () => buildStubRetell({ deleteCall }));
    const live = new LiveRetell({ apiKey: 'rk_test', retellLoader: loader });

    await live.endCall({ retellCallId: 'retell_call_xyz', reason: 'duration_cap_exceeded' });

    expect(deleteCall).toHaveBeenCalledWith('retell_call_xyz');
  });

  it('rejects malformed input asynchronously', async () => {
    const loader = vi.fn(async () => buildStubRetell({}));
    const live = new LiveRetell({ apiKey: 'rk_test', retellLoader: loader });
    await expect(live.endCall({ retellCallId: 'r', reason: 'made_up' as never })).rejects.toThrow();
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
