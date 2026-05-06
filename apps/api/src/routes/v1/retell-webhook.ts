import { prisma } from '@dentabill/db';
import {
  parseRetellWebhookEnvelope,
  RetellCallEndReason,
  RetellWebhookParseError,
  verifyRetellWebhookSignature,
} from '@dentabill/payer-ivr';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';

import { getEnv } from '../../lib/env.js';

/**
 * `POST /v1/webhooks/retell` — inbound Retell call events (P3-T17).
 *
 * Three load-bearing security properties:
 *
 *   1. **HMAC-SHA256 verification on the raw body** — the signature
 *      header is checked against `createHmac('sha256', secret)
 *      .update(rawBody)`. The route ALWAYS reads `request.rawBody`
 *      (registered by the raw-body plugin) so the bytes match what
 *      Retell signed. Re-serialising `request.body` (the parsed
 *      JSON) would not.
 *
 *   2. **Constant-time compare** — delegated to
 *      `crypto.timingSafeEqual` in `verifyRetellWebhookSignature`.
 *      Length mismatches are short-circuited to a constant-time
 *      mismatch with a same-length filler so the leaked time does
 *      not reveal the actual signature length.
 *
 *   3. **Replay protection via `RetellWebhookEvent.eventId`** — the
 *      route INSERTs the eventId BEFORE writing CallEvent / Call
 *      side-effects. The unique-constraint failure on duplicate
 *      delivery is the signal — caught and translated to a 200
 *      idempotent no-op so Retell does not infinitely retry.
 *
 * The route is public (no auth) — Retell does not have access to a
 * Clerk JWT. The HMAC is the only authentication; an attacker without
 * the shared secret cannot forge a signed envelope.
 *
 * Side-effects on a verified, non-replay event:
 *   - Find the Call by `retellCallId` (events for unknown calls are
 *     logged + ignored — likely arrive before the worker has finished
 *     persisting the Call row).
 *   - Append a CallEvent row mirroring the event payload.
 *   - For terminal `call.ended` and `call.error` events, stamp the
 *     final Call.status. Phase 3 deliberately does not also flip
 *     Claim.status from the webhook path — that lives in the worker
 *     (`handler.ts` finalisation) for `call.ended`, or in the DLQ
 *     consumer for terminal failures, so the writes do not race.
 */

interface WebhookSuccessResponse {
  ok: true;
  replayed?: true;
  ignored?: 'unknown_call';
}

export function retellWebhookRoutes(fastify: FastifyInstance): void {
  fastify.post('/webhooks/retell', async (request, reply): Promise<WebhookSuccessResponse> => {
    const rawBody = request.rawBody;
    if (rawBody === undefined || rawBody.length === 0) {
      throw new ApiError('VALIDATION_ERROR', 'Empty webhook body.');
    }

    const headerValue = request.headers['x-retell-signature'];
    const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (typeof signature !== 'string' || signature.length === 0) {
      throw new ApiError('WEBHOOK_SIGNATURE_INVALID', 'Missing X-Retell-Signature header.');
    }

    const env = getEnv();
    const ok = verifyRetellWebhookSignature({
      rawBody,
      signature,
      secret: env.RETELL_WEBHOOK_SECRET,
    });
    if (!ok) {
      throw new ApiError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature did not match.');
    }

    let envelope;
    try {
      envelope = parseRetellWebhookEnvelope(rawBody);
    } catch (err) {
      if (err instanceof RetellWebhookParseError) {
        throw new ApiError('VALIDATION_ERROR', err.message);
      }
      throw err;
    }

    const retellCallId = extractRetellCallId(envelope.event);

    // Replay protection — INSERT-then-handle. A duplicate eventId hits
    // the UNIQUE constraint on `eventId`, which we map to a 200 no-op.
    try {
      await prisma.retellWebhookEvent.create({
        data: {
          eventId: envelope.eventId,
          retellCallId: retellCallId ?? null,
          eventType: envelope.event.type,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        request.log.info(
          { eventId: envelope.eventId, eventType: envelope.event.type },
          'retell-webhook: replay detected, skipping side-effects',
        );
        reply.code(200);
        return { ok: true, replayed: true };
      }
      throw err;
    }

    if (retellCallId === null) {
      reply.code(200);
      return { ok: true };
    }

    const call = await prisma.call.findUnique({
      where: { retellCallId },
    });
    if (call === null) {
      // Webhook arrived before the worker finished persisting the Call
      // row, OR the call was for a retellCallId we never started (forged
      // body that nonetheless verified — implies leaked secret, but the
      // Replay row is still useful for forensics).
      request.log.warn(
        { retellCallId, eventType: envelope.event.type },
        'retell-webhook: no Call row matching retellCallId — payload ignored',
      );
      reply.code(200);
      return { ok: true, ignored: 'unknown_call' };
    }

    const callEventRow = await prisma.callEvent.create({
      data: {
        callId: call.id,
        eventType: `webhook.${envelope.event.type}`,
        data: envelope.event as object,
      },
    });

    // Best-effort SSE fan-out (ADR-046). Persistence is the durable
    // source of truth; pub/sub is the latency optimisation. A failed
    // publish (Redis hiccup) does not roll back the CallEvent — the
    // SSE handler's next replay catches the missed payload.
    try {
      const publisher = fastify.callEventsPublisher;
      if (publisher !== null) {
        const channel = `call:${retellCallId}:events`;
        await publisher.publish(
          channel,
          JSON.stringify({
            type: envelope.event.type,
            callEventId: callEventRow.id,
            retellCallId,
            timestamp: callEventRow.timestamp.toISOString(),
            data: envelope.event,
          }),
        );
      }
    } catch (err) {
      request.log.warn({ err, retellCallId }, 'sse publish failed; replay will recover');
    }

    if (envelope.event.type === 'call.ended') {
      const finalStatus = endReasonToCallStatus(envelope.event.endReason);
      await prisma.call.updateMany({
        where: { id: call.id, organizationId: call.organizationId },
        data: {
          status: finalStatus,
          endedAt: new Date(envelope.event.endedAt),
          durationSeconds: envelope.event.durationSeconds,
          humanReached:
            envelope.event.endReason === RetellCallEndReason.COMPLETED ||
            envelope.event.endReason === RetellCallEndReason.AGENT_HANGUP,
        },
      });
    } else if (envelope.event.type === 'call.error') {
      await prisma.call.updateMany({
        where: { id: call.id, organizationId: call.organizationId },
        data: { status: 'FAILED' },
      });
    }

    reply.code(200);
    return { ok: true };
  });
}

function extractRetellCallId(event: { type: string; retellCallId?: string }): string | null {
  // Every Retell event in the discriminated union carries `retellCallId`,
  // but the type system doesn't surface that without a narrower switch —
  // keep this defensive in case a future event type omits it.
  return typeof event.retellCallId === 'string' && event.retellCallId.length > 0
    ? event.retellCallId
    : null;
}

function endReasonToCallStatus(reason: string): 'COMPLETED' | 'FAILED' | 'VOICEMAIL' {
  switch (reason) {
    case RetellCallEndReason.COMPLETED:
    case RetellCallEndReason.AGENT_HANGUP:
    case RetellCallEndReason.USER_HANGUP:
      return 'COMPLETED';
    case RetellCallEndReason.NO_ANSWER:
    case RetellCallEndReason.BUSY:
      return 'VOICEMAIL';
    default:
      return 'FAILED';
  }
}

function isUniqueViolation(err: unknown): boolean {
  // Prisma's known-request error code for unique constraint violation.
  // Imported as a string check to avoid pulling the Prisma class into
  // this file (see Prisma docs: P2002).
  if (err === null || err === undefined || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code === 'P2002';
}
