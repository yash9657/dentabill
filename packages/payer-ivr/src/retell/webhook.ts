import { createHmac, timingSafeEqual } from 'node:crypto';

import { RetellWebhookEnvelopeSchema, type RetellWebhookEnvelope } from './events.js';

/**
 * HMAC-SHA256 webhook signature verification (ADR-036).
 *
 *   - Operates on the **raw body** the framework received, not on the
 *     parsed JSON. Re-serialising the parsed object produces a
 *     different byte-for-byte representation than what the sender
 *     signed; the Fastify route in `apps/api` (P3-T17) registers a
 *     content-type parser that exposes the raw `Buffer` for exactly
 *     this reason.
 *   - **Constant-time compare** via `crypto.timingSafeEqual`. Length
 *     mismatches (which `timingSafeEqual` cannot accept) are short-
 *     circuited to a constant-time mismatch with a same-length filler;
 *     a leaked length-mismatch signal is a typical timing-attack
 *     amplifier.
 *   - The function returns `boolean` only; route-level error
 *     handling distinguishes `invalid_signature` vs `replayed_event_id`
 *     vs `malformed_payload` and emits the right `ApiError`.
 *
 * The signature header is the lowercase hex digest. LiveRetell adapter
 * (P3-T7) reads `X-Retell-Signature` and passes the hex value here;
 * future header formats (e.g., `t=…,v1=…`) get parsed by the route
 * before calling this helper.
 */
export interface VerifyRetellWebhookSignatureInput {
  /** Raw HTTP body (Buffer or string) — pre-JSON-parse. */
  rawBody: Buffer | string;
  /** Hex digest the sender claimed. */
  signature: string;
  /** `RETELL_WEBHOOK_SECRET` env var. */
  secret: string;
}

export function verifyRetellWebhookSignature({
  rawBody,
  signature,
  secret,
}: VerifyRetellWebhookSignatureInput): boolean {
  if (secret.length === 0) return false;
  if (signature.length === 0) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected.length !== signature.length) {
    // Length mismatch is a guaranteed mismatch. Run a same-length compare
    // anyway so the time taken does not leak the actual signature length.
    timingSafeEqual(Buffer.from(expected), Buffer.from(expected));
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
}

/**
 * Parse the (already verified) raw body into a typed
 * `RetellWebhookEnvelope`. Throws `RetellWebhookParseError` on shape
 * mismatch — the route catches and returns a structured `ApiError`.
 */
export class RetellWebhookParseError extends Error {
  override readonly name = 'RetellWebhookParseError';
}

export function parseRetellWebhookEnvelope(rawBody: Buffer | string): RetellWebhookEnvelope {
  const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new RetellWebhookParseError(
      `Body is not valid JSON: ${cause instanceof Error ? cause.message : 'unknown'}`,
    );
  }
  const result = RetellWebhookEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new RetellWebhookParseError(`Envelope failed schema: ${issues}`);
  }
  return result.data;
}
