import { z } from 'zod';

import { SUPPORTED_PAYER_CODES } from '../payer-codes.js';

/**
 * Retell event schemas (ADR-033).
 *
 * The discriminated union is the source of truth shared between:
 *
 *   - the **Fastify webhook route** (`apps/api`, P3-T17), which parses
 *     raw inbound bodies after HMAC verification;
 *   - the **call-worker subscriber** (`apps/call-worker`, P3-T10/T11/T12),
 *     which reacts to the parsed events;
 *   - the **FakeRetell adapter** (P3-T6), which emits exactly these
 *     shapes during in-process tests.
 *
 * The schemas intentionally accept a superset of fields and forward only
 * the ones our domain needs — Retell may add fields in future releases
 * without breaking the contract. Strict/passthrough is set per-event.
 */

/**
 * Reasons a Retell call ended. Covers the SDK-emitted set we have seen in
 * the docs plus our own escalation reasons surfaced by the FakeRetell
 * adapter so tests can assert on the same enum the live adapter produces.
 */
export const RetellCallEndReason = {
  COMPLETED: 'completed',
  AGENT_HANGUP: 'agent_hangup',
  USER_HANGUP: 'user_hangup',
  NO_ANSWER: 'no_answer',
  BUSY: 'busy',
  VOICEMAIL: 'voicemail',
  ERROR: 'error',
} as const;

export type RetellCallEndReason = (typeof RetellCallEndReason)[keyof typeof RetellCallEndReason];

const isoDateTime = z.string().datetime();

export const RetellTranscriptSchema = z.object({
  text: z.string().max(1_000_000).nullable(),
  turns: z
    .array(
      z.object({
        role: z.enum(['agent', 'user']),
        text: z.string().max(100_000),
        startOffsetSeconds: z.number().finite().nonnegative().nullable(),
      }),
    )
    .max(20_000)
    .nullable(),
});

const retellCallTranscriptSnapshotSchema = z.object({
  type: z.literal('call.transcript_snapshot'),
  retellCallId: z.string().min(1),
  transcript: RetellTranscriptSchema,
});

const retellCallStartedEventSchema = z.object({
  type: z.literal('call.started'),
  retellCallId: z.string().min(1),
  agentId: z.string().min(1),
  /** E.164 phone number we dialled. */
  toNumberE164: z.string().regex(/^\+?[0-9]+$/),
  startedAt: isoDateTime,
  /** Echoed metadata the worker stamped on `startCall`. */
  metadata: z.record(z.string()).optional(),
});

const retellCallTranscriptEventSchema = z.object({
  type: z.literal('call.transcript'),
  retellCallId: z.string().min(1),
  role: z.enum(['agent', 'user', 'system']),
  /** Verbatim transcript chunk. PHI-bearing — never log unredacted. */
  text: z.string(),
  timestamp: isoDateTime,
});

const retellCallEndedEventSchema = z.object({
  type: z.literal('call.ended'),
  retellCallId: z.string().min(1),
  endedAt: isoDateTime.nullable(),
  durationSeconds: z.number().int().min(0).nullable(),
  endReason: z.enum([
    RetellCallEndReason.COMPLETED,
    RetellCallEndReason.AGENT_HANGUP,
    RetellCallEndReason.USER_HANGUP,
    RetellCallEndReason.NO_ANSWER,
    RetellCallEndReason.BUSY,
    RetellCallEndReason.VOICEMAIL,
    RetellCallEndReason.ERROR,
  ]),
  /** Optional structured outcome the agent extracted (claim status etc). */
  collectedInfo: z.record(z.unknown()).optional(),
  providerEndReason: z.string().max(128).optional(),
  startedAt: isoDateTime.optional(),
  transcript: RetellTranscriptSchema.optional(),
});

const retellCallErrorEventSchema = z.object({
  type: z.literal('call.error'),
  retellCallId: z.string().min(1),
  /** Stable code we can branch on; messages are human-readable only. */
  code: z.string().min(1),
  message: z.string().min(1),
  occurredAt: isoDateTime,
});

export const RetellEventSchema = z.discriminatedUnion('type', [
  retellCallStartedEventSchema,
  retellCallTranscriptEventSchema,
  retellCallTranscriptSnapshotSchema,
  retellCallEndedEventSchema,
  retellCallErrorEventSchema,
]);

export type RetellEvent = z.infer<typeof RetellEventSchema>;
export type RetellCallStartedEvent = z.infer<typeof retellCallStartedEventSchema>;
export type RetellCallTranscriptEvent = z.infer<typeof retellCallTranscriptEventSchema>;
export type RetellCallEndedEvent = z.infer<typeof retellCallEndedEventSchema>;
export type RetellCallErrorEvent = z.infer<typeof retellCallErrorEventSchema>;

/**
 * Internal simulation envelope only. Retell's HTTP wire format is
 * {event: string, call: {...}} and does not provide a delivery event ID.
 */
export const RetellWebhookEnvelopeSchema = z.object({
  /** Unique per delivered webhook; index column for replay protection. */
  eventId: z.string().min(1),
  deliveredAt: isoDateTime,
  event: RetellEventSchema,
});

export type RetellWebhookEnvelope = z.infer<typeof RetellWebhookEnvelopeSchema>;

/**
 * Input the call worker sends to `RetellPort.startCall`.
 *
 * `agentMetadata` is the substitution dictionary the prompt references
 * via `{{var}}` placeholders (see `agents/types.ts`). Phase 3 always
 * passes the four PRD §6 essentials; LiveRetell forwards them to Retell
 * as `metadata` so the agent prompt can interpolate.
 */
export const StartCallInputSchema = z.object({
  payerCode: z.enum(SUPPORTED_PAYER_CODES as readonly [string, ...string[]]),
  agentId: z.string().min(1),
  fromNumberE164: z.string().regex(/^\+[0-9]{8,15}$/),
  toNumberE164: z.string().regex(/^\+[0-9]{8,15}$/),
  agentMetadata: z.object({
    practiceName: z.string().min(1),
    providerNpi: z.string().regex(/^[0-9]{10}$/, 'NPI must be 10 digits'),
    subscriberId: z.string().min(1),
    dateOfService: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  }),
  /**
   * Opaque durable call-intent ID supplied by the dial runtime. LiveRetell
   * sends it as the provider's `idempotency_key` body field and correlation
   * metadata. Retell documents a one-hour deduplication window; the runtime
   * must retain unresolved intents and must not infer that a timeout is safe
   * to retry. FakeRetell's in-memory deduplication is only a test convenience.
   */
  idempotencyKey: z.string().min(1),
  /** Optional provider-enforced cap, in ms. Keep appended for historical request hashes. */
  maxDurationMs: z.number().int().min(60_000).max(7_200_000).optional(),
});

export type StartCallInput = z.infer<typeof StartCallInputSchema>;

export const StartCallResultSchema = z.object({
  retellCallId: z.string().min(1),
  queuedAt: isoDateTime,
});

export type StartCallResult = z.infer<typeof StartCallResultSchema>;

export const EndCallInputSchema = z.object({
  retellCallId: z.string().min(1),
  reason: z.enum(['operator_cancel', 'duration_cap_exceeded', 'hold_cap_exceeded']),
});

export type EndCallInput = z.infer<typeof EndCallInputSchema>;
