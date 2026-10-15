import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { RetellCallEndReason, RetellEventSchema, type RetellEvent } from './events.js';

export interface VerifyRetellWebhookSignatureInput {
  rawBody: Buffer | string;
  signature: string;
  /** Account API key designated for webhook signing in the Retell dashboard. */
  secret: string;
}

export interface VerifyOptions {
  readonly now?: number;
}

export function verifyRetellWebhookSignature(
  input: VerifyRetellWebhookSignatureInput,
  options: VerifyOptions = {},
): boolean {
  if (!input.secret) return false;
  const match = /^v=(0|[1-9]\d*),d=([0-9a-fA-F]{64})$/.exec(input.signature);
  if (!match?.[1] || !match[2]) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp)) return false;
  if (Math.abs((options.now ?? Date.now()) - timestamp) > 5 * 60 * 1000) return false;
  const expected = createHmac('sha256', input.secret)
    .update(input.rawBody)
    .update(match[1])
    .digest();
  return timingSafeEqual(expected, Buffer.from(match[2], 'hex'));
}

const id = z.string().min(1).max(256);
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
const wireEnvelope = z.object({
  event: z.string().min(1).max(128),
  call: z.object({ call_id: id }).passthrough(),
});
const transcriptFields = {
  transcript: z.string().max(1_000_000).optional(),
  transcript_object: z
    .array(
      z.object({
        role: z.enum(['agent', 'user']),
        content: z.string().max(100_000),
        words: z
          .array(
            z
              .object({
                start: z.number().finite().nonnegative(),
              })
              .passthrough(),
          )
          .optional(),
      }),
    )
    .max(20_000)
    .optional(),
};
const startedCall = z.object({
  call_id: id,
  agent_id: id,
  direction: z.literal('outbound'),
  to_number: z.string().regex(/^\+[0-9]{8,15}$/),
  start_timestamp: timestamp,
});
const endedCall = z
  .object({
    call_id: id,
    direction: z.literal('outbound'),
    call_status: z.enum(['ended', 'error', 'not_connected']),
    start_timestamp: timestamp.optional(),
    end_timestamp: timestamp.optional(),
    duration_ms: z.number().finite().nonnegative().max(2_147_483_647_000).optional(),
    disconnection_reason: z.string().min(1).max(128),
    ...transcriptFields,
  })
  .refine(
    (call) =>
      call.end_timestamp === undefined ||
      call.start_timestamp === undefined ||
      call.end_timestamp >= call.start_timestamp,
  );
const transcriptCall = z.object({
  call_id: id,
  direction: z.literal('outbound'),
  ...transcriptFields,
});

/** Only normalized source evidence is retained; call_analysis and tool outputs are excluded. */
export const RetellWebhookDeliverySchema = z.object({
  eventId: z.string().min(1),
  retellCallId: id,
  eventType: z.string().min(1).max(128),
  event: RetellEventSchema.nullable(),
});
export type RetellWebhookDelivery = z.infer<typeof RetellWebhookDeliverySchema>;

export class RetellWebhookParseError extends Error {
  override readonly name = 'RetellWebhookParseError';
}

export function parseRetellWebhookEnvelope(rawBody: Buffer | string): RetellWebhookDelivery {
  try {
    const wire = wireEnvelope.parse(JSON.parse(rawBody.toString()) as unknown);
    const retellCallId = wire.call.call_id;
    let event: RetellEvent | null = null;
    if (wire.event === 'call_started') {
      const call = startedCall.parse(wire.call);
      event = {
        type: 'call.started',
        retellCallId,
        agentId: call.agent_id,
        toNumberE164: call.to_number,
        startedAt: new Date(call.start_timestamp).toISOString(),
      };
    } else if (wire.event === 'call_ended') {
      const call = endedCall.parse(wire.call);
      const durationMs =
        call.duration_ms ??
        (call.end_timestamp !== undefined && call.start_timestamp !== undefined
          ? call.end_timestamp - call.start_timestamp
          : null);
      event = {
        type: 'call.ended',
        retellCallId,
        endedAt:
          call.end_timestamp === undefined ? null : new Date(call.end_timestamp).toISOString(),
        durationSeconds: durationMs === null ? null : Math.floor(durationMs / 1000),
        endReason: normalizeEndReason(call.disconnection_reason, call.call_status),
        providerEndReason: call.disconnection_reason,
        ...(call.start_timestamp === undefined
          ? {}
          : { startedAt: new Date(call.start_timestamp).toISOString() }),
        ...(hasTranscript(call) ? { transcript: normalizeTranscript(call) } : {}),
      };
    } else if (wire.event === 'transcript_updated') {
      const call = transcriptCall.parse(wire.call);
      if (!hasTranscript(call)) throw new RetellWebhookParseError('Transcript is unavailable.');
      event = {
        type: 'call.transcript_snapshot',
        retellCallId,
        transcript: normalizeTranscript(call),
      };
    }
    // Lifecycle events occur once per call. Snapshots are cumulative, not transcript deltas.
    const suffix =
      wire.event === 'transcript_updated'
        ? `:${createHash('sha256').update(JSON.stringify(event)).digest('hex')}`
        : '';
    return RetellWebhookDeliverySchema.parse({
      eventId: `retell:${wire.event}:${retellCallId}${suffix}`,
      retellCallId,
      eventType: wire.event,
      event,
    });
  } catch {
    // Zod/JSON errors can echo transcript text or attacker-controlled field values.
    throw new RetellWebhookParseError('Invalid Retell webhook payload.');
  }
}

type TranscriptFields = z.infer<typeof transcriptCall>;
function hasTranscript(call: TranscriptFields): boolean {
  return call.transcript !== undefined || call.transcript_object !== undefined;
}
function normalizeTranscript(call: TranscriptFields): {
  text: string | null;
  turns: { role: 'agent' | 'user'; text: string; startOffsetSeconds: number | null }[] | null;
} {
  return {
    text: call.transcript ?? null,
    turns:
      call.transcript_object?.map((turn) => ({
        role: turn.role,
        text: turn.content,
        startOffsetSeconds: turn.words?.[0]?.start ?? null,
      })) ?? null,
  };
}
function normalizeEndReason(reason: string, status: string): RetellCallEndReason {
  if (status === 'error') return RetellCallEndReason.ERROR;
  switch (reason) {
    case 'agent_hangup':
      return RetellCallEndReason.AGENT_HANGUP;
    case 'user_hangup':
      return RetellCallEndReason.USER_HANGUP;
    case 'dial_no_answer':
      return RetellCallEndReason.NO_ANSWER;
    case 'dial_busy':
      return RetellCallEndReason.BUSY;
    case 'voicemail_reached':
      return RetellCallEndReason.VOICEMAIL;
    default:
      return RetellCallEndReason.ERROR;
  }
}
