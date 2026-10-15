import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createRetellPort,
  EndCallInputSchema,
  parseRetellWebhookEnvelope,
  RetellCallEndReason,
  RetellEventSchema,
  RetellWebhookEnvelopeSchema,
  RetellWebhookParseError,
  StartCallInputSchema,
  type RetellWebhookEnvelope,
  verifyRetellWebhookSignature,
} from './index.js';

const SECRET = 'whsec_test_dentabill_phase3_demo_only';

function signPayload(secret: string, body: string): string {
  const timestamp = Date.now();
  return `v=${String(timestamp)},d=${createHmac('sha256', secret)
    .update(body + String(timestamp))
    .digest('hex')}`;
}

describe('RetellEventSchema', () => {
  it('accepts each event type', () => {
    const events = [
      {
        type: 'call.started',
        retellCallId: 'call_123',
        agentId: 'agent_delta_dental_ppo',
        toNumberE164: '+18007656003',
        startedAt: '2026-04-28T15:00:00.000Z',
        metadata: { practiceName: 'Sunrise Family Dental' },
      },
      {
        type: 'call.transcript',
        retellCallId: 'call_123',
        role: 'agent',
        text: 'Hello, this is DentaBill calling on behalf of Sunrise Family Dental.',
        timestamp: '2026-04-28T15:00:05.000Z',
      },
      {
        type: 'call.ended',
        retellCallId: 'call_123',
        endedAt: '2026-04-28T15:08:30.000Z',
        durationSeconds: 510,
        endReason: RetellCallEndReason.COMPLETED,
        collectedInfo: { claimStatus: 'pending', referenceNumber: 'REF-9182' },
      },
      {
        type: 'call.error',
        retellCallId: 'call_123',
        code: 'agent_disconnected',
        message: 'Agent disconnected before call.ended fired',
        occurredAt: '2026-04-28T15:08:45.000Z',
      },
    ];
    for (const event of events) {
      expect(() => RetellEventSchema.parse(event)).not.toThrow();
    }
  });

  it('rejects an unknown event type', () => {
    expect(() => RetellEventSchema.parse({ type: 'call.weird', retellCallId: 'call_x' })).toThrow();
  });
});

describe('StartCallInputSchema', () => {
  const valid = {
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
    idempotencyKey: 'claim_xyz-1',
  };

  it('accepts a well-formed payload', () => {
    expect(() => StartCallInputSchema.parse(valid)).not.toThrow();
  });

  it('preserves historical request serialization and appends the optional duration field', () => {
    const legacyJson = JSON.stringify(valid);
    // JSONB may reorder both the outer request and nested metadata keys.
    const reordered = Object.fromEntries(
      Object.entries({
        ...valid,
        agentMetadata: Object.fromEntries(Object.entries(valid.agentMetadata).reverse()),
      }).reverse(),
    );
    expect(JSON.stringify(StartCallInputSchema.parse(reordered))).toBe(legacyJson);
    expect(StartCallInputSchema.parse(reordered)).not.toHaveProperty('maxDurationMs');
    expect(
      JSON.stringify(StartCallInputSchema.parse({ maxDurationMs: 1_800_000, ...reordered })),
    ).toBe(`${legacyJson.slice(0, -1)},"maxDurationMs":1800000}`);
  });

  it.each([60_000, 7_200_000])(
    'accepts the documented inclusive duration boundary %s',
    (maxDurationMs) => {
      expect(StartCallInputSchema.parse({ ...valid, maxDurationMs }).maxDurationMs).toBe(
        maxDurationMs,
      );
    },
  );

  it.each([59_999, 7_200_001, 60_000.5, Number.NaN, Number.POSITIVE_INFINITY, null, '60000'])(
    'rejects invalid duration %s',
    (maxDurationMs) => {
      expect(StartCallInputSchema.safeParse({ ...valid, maxDurationMs }).success).toBe(false);
    },
  );

  it('rejects a 9-digit NPI', () => {
    expect(() =>
      StartCallInputSchema.parse({
        ...valid,
        agentMetadata: { ...valid.agentMetadata, providerNpi: '123456789' },
      }),
    ).toThrow(/NPI/);
  });

  it('rejects a non-E.164 phone number', () => {
    expect(() => StartCallInputSchema.parse({ ...valid, toNumberE164: '8007656003' })).toThrow();
  });

  it('rejects a malformed dateOfService', () => {
    expect(() =>
      StartCallInputSchema.parse({
        ...valid,
        agentMetadata: { ...valid.agentMetadata, dateOfService: '03/15/2026' },
      }),
    ).toThrow(/YYYY-MM-DD/);
  });
});

describe('EndCallInputSchema', () => {
  it('accepts each documented end reason', () => {
    for (const reason of [
      'operator_cancel',
      'duration_cap_exceeded',
      'hold_cap_exceeded',
    ] as const) {
      expect(() => EndCallInputSchema.parse({ retellCallId: 'call_1', reason })).not.toThrow();
    }
  });
});

describe('verifyRetellWebhookSignature', () => {
  const body = JSON.stringify({
    eventId: 'wh_abc',
    deliveredAt: '2026-04-28T15:00:00.000Z',
    event: {
      type: 'call.started',
      retellCallId: 'call_1',
      agentId: 'a',
      toNumberE164: '+1',
      startedAt: '2026-04-28T15:00:00.000Z',
    },
  });

  it('accepts a timestamped SDK-format signature', () => {
    const sig = signPayload(SECRET, body);
    expect(verifyRetellWebhookSignature({ rawBody: body, signature: sig, secret: SECRET })).toBe(
      true,
    );
  });

  it('accepts a Buffer rawBody equivalently', () => {
    const sig = signPayload(SECRET, body);
    expect(
      verifyRetellWebhookSignature({
        rawBody: Buffer.from(body, 'utf8'),
        signature: sig,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = signPayload(SECRET, body);
    const tamperedBody = body.replace('call_1', 'call_2');
    expect(
      verifyRetellWebhookSignature({ rawBody: tamperedBody, signature: sig, secret: SECRET }),
    ).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const sig = signPayload(SECRET, body);
    expect(
      verifyRetellWebhookSignature({ rawBody: body, signature: sig, secret: 'whsec_other' }),
    ).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(verifyRetellWebhookSignature({ rawBody: body, signature: '', secret: SECRET })).toBe(
      false,
    );
  });

  it('rejects an empty secret', () => {
    expect(verifyRetellWebhookSignature({ rawBody: body, signature: 'any', secret: '' })).toBe(
      false,
    );
  });

  it('rejects a length-mismatched signature in constant time', () => {
    const sig = signPayload(SECRET, body);
    const truncated = sig.slice(0, -2);
    expect(
      verifyRetellWebhookSignature({ rawBody: body, signature: truncated, secret: SECRET }),
    ).toBe(false);
    const padded = `${sig}deadbeef`;
    expect(verifyRetellWebhookSignature({ rawBody: body, signature: padded, secret: SECRET })).toBe(
      false,
    );
  });
});

describe('parseRetellWebhookEnvelope — provider wire format', () => {
  const call = {
    call_id: 'call_1',
    agent_id: 'agent_synthetic',
    direction: 'outbound',
    to_number: '+12025550101',
    start_timestamp: 1791892800000,
  };
  it('normalizes call_started without trusting metadata or inventing delivery IDs', () => {
    const parsed = parseRetellWebhookEnvelope(JSON.stringify({ event: 'call_started', call }));
    expect(parsed).toEqual({
      eventId: 'retell:call_started:call_1',
      retellCallId: 'call_1',
      eventType: 'call_started',
      event: {
        type: 'call.started',
        retellCallId: 'call_1',
        agentId: 'agent_synthetic',
        toNumberE164: '+12025550101',
        startedAt: new Date(call.start_timestamp).toISOString(),
      },
    });
  });
  it('parses Buffer input', () => {
    expect(
      parseRetellWebhookEnvelope(Buffer.from(JSON.stringify({ event: 'call_started', call })))
        .eventId,
    ).toBe('retell:call_started:call_1');
  });
  it('preserves unknown duration and timestamps instead of inventing a successful call', () => {
    const parsed = parseRetellWebhookEnvelope(
      JSON.stringify({
        event: 'call_ended',
        call: {
          call_id: 'call_1',
          direction: 'outbound',
          call_status: 'not_connected',
          disconnection_reason: 'dial_failed',
        },
      }),
    );
    expect(parsed.event).toMatchObject({
      type: 'call.ended',
      endedAt: null,
      durationSeconds: null,
      endReason: 'error',
      providerEndReason: 'dial_failed',
    });
  });
  it.each([
    ['dial_no_answer', 'no_answer'],
    ['dial_busy', 'busy'],
    ['voicemail_reached', 'voicemail'],
    ['call_transfer', 'error'],
    ['max_duration_reached', 'error'],
    ['new_unknown_reason', 'error'],
  ])('maps %s conservatively and preserves source reason', (reason, mapped) => {
    const parsed = parseRetellWebhookEnvelope(
      JSON.stringify({
        event: 'call_ended',
        call: {
          ...call,
          call_status: 'ended',
          end_timestamp: call.start_timestamp + 30_123,
          disconnection_reason: reason,
        },
      }),
    );
    expect(parsed.event).toMatchObject({
      endReason: mapped,
      providerEndReason: reason,
      durationSeconds: 30,
    });
  });
  it.each([
    'not JSON',
    '{"event":"call_started","call":{"call_id":"call_1"}}',
    '{"eventId":"fake","event":{"type":"call.started"}}',
  ])('rejects malformed or internal simulation envelopes', (raw) => {
    expect(() => parseRetellWebhookEnvelope(raw)).toThrow(RetellWebhookParseError);
  });
  it('rejects reversed terminal timestamps', () => {
    expect(() =>
      parseRetellWebhookEnvelope(
        JSON.stringify({
          event: 'call_ended',
          call: {
            ...call,
            call_status: 'ended',
            end_timestamp: 0,
            disconnection_reason: 'agent_hangup',
          },
        }),
      ),
    ).toThrow(RetellWebhookParseError);
  });
  it('preserves repeated speakers and excludes tool output and call analysis', () => {
    const parsed = parseRetellWebhookEnvelope(
      JSON.stringify({
        event: 'transcript_updated',
        call: {
          ...call,
          transcript_object: [
            { role: 'agent', content: 'First' },
            { role: 'agent', content: 'Second' },
          ],
          transcript_with_tool_calls: [
            { role: 'tool_call_result', content: 'fabricated paid status' },
          ],
          call_analysis: { claimStatus: 'paid' },
        },
      }),
    );
    expect(parsed.event).toMatchObject({
      transcript: {
        text: null,
        turns: [
          { role: 'agent', text: 'First', startOffsetSeconds: null },
          { role: 'agent', text: 'Second', startOffsetSeconds: null },
        ],
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('paid');
  });
  it('distinguishes different cumulative snapshots but deduplicates identical evidence', () => {
    const parse = (text: string) =>
      parseRetellWebhookEnvelope(
        JSON.stringify({ event: 'transcript_updated', call: { ...call, transcript: text } }),
      );
    expect(parse('First').eventId).toBe(parse('First').eventId);
    expect(parse('First').eventId).not.toBe(parse('First Second').eventId);
  });
});

describe('RetellWebhookEnvelopeSchema', () => {
  it('round-trips a complete envelope', () => {
    const envelope: RetellWebhookEnvelope = {
      eventId: 'wh_xyz',
      deliveredAt: '2026-04-28T15:00:00.000Z',
      event: {
        type: 'call.ended',
        retellCallId: 'call_1',
        endedAt: '2026-04-28T15:10:00.000Z',
        durationSeconds: 600,
        endReason: RetellCallEndReason.COMPLETED,
      },
    };
    expect(RetellWebhookEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });
});

describe('createRetellPort — retellCallId uniqueness across processes', () => {
  // `Call.retellCallId` is UNIQUE. FakeRetell's default generator is a
  // per-instance counter that restarts at 1 every process, so two separately
  // constructed ports used to hand out the same `fake_call_1` and the second
  // worker's first job died on a unique-constraint violation. A restart or a
  // redeploy was enough to break the next call.
  const startInput = {
    payerCode: 'CIGNA_DENTAL',
    idempotencyKey: 'idem-1',
    agentId: 'agent_test',
    toNumberE164: '+15555550100',
    fromNumberE164: '+15555550199',
    agentMetadata: {
      subscriberId: 'SUB-1',
      providerNpi: '9999999999',
      dateOfService: '2026-08-01',
      practiceName: 'Bright Smile Dental',
    },
  };

  it('does not reuse ids between two independently created ports', async () => {
    const a = createRetellPort({ apiKey: '' });
    const b = createRetellPort({ apiKey: '' });

    const first = await a.port.startCall(startInput);
    const second = await b.port.startCall(startInput);

    expect(first.retellCallId).not.toBe(second.retellCallId);
  });

  it('still increments within a single port', async () => {
    const { port } = createRetellPort({ apiKey: '' });
    const first = await port.startCall(startInput);
    const second = await port.startCall({ ...startInput, idempotencyKey: 'idem-2' });

    expect(first.retellCallId).not.toBe(second.retellCallId);
  });

  it('keeps idempotency within a port — same key returns the same id', async () => {
    const { port } = createRetellPort({ apiKey: '' });
    const first = await port.startCall(startInput);
    const repeat = await port.startCall(startInput);

    expect(repeat.retellCallId).toBe(first.retellCallId);
  });
});
