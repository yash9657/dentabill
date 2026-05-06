import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies a Svix-signed Clerk webhook (ADR-044).
 *
 * The Clerk dashboard delivers webhooks via Svix, which uses three
 * headers:
 *   - `svix-id`        — opaque event id, replay-protection key
 *   - `svix-timestamp` — Unix seconds the body was signed at
 *   - `svix-signature` — space-separated list of `v1,<base64>` pairs
 *
 * The signed content is `${svix-id}.${svix-timestamp}.${rawBody}`
 * (Svix signs the bytes; do not re-serialise). HMAC-SHA256 with the
 * webhook secret produces the digest, which is base64-encoded and
 * compared in constant time. Multiple v1 signatures rotate during
 * key roll — accept any match.
 *
 * The secret string carried in the Clerk dashboard is prefixed
 * `whsec_` followed by the base64-encoded raw secret. We strip the
 * prefix and base64-decode before HMAC-ing.
 */
export interface ClerkWebhookSignatureInput {
  readonly svixId: string;
  readonly svixTimestamp: string;
  readonly svixSignature: string;
  readonly rawBody: Buffer;
  readonly secret: string;
  readonly nowSeconds?: number;
  readonly toleranceSeconds?: number;
}

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export function verifyClerkWebhookSignature(input: ClerkWebhookSignatureInput): boolean {
  if (input.secret.length === 0) return false;
  if (input.svixId.length === 0) return false;

  const timestampSeconds = Number.parseInt(input.svixTimestamp, 10);
  if (!Number.isFinite(timestampSeconds)) return false;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestampSeconds) > tolerance) return false;

  const decoded = decodeSecret(input.secret);
  if (decoded === null) return false;

  const signedContent = Buffer.concat([
    Buffer.from(`${input.svixId}.${input.svixTimestamp}.`, 'utf8'),
    input.rawBody,
  ]);
  const expected = createHmac('sha256', decoded).update(signedContent).digest('base64');
  const expectedBytes = Buffer.from(expected, 'base64');

  for (const candidate of input.svixSignature.split(' ')) {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith('v1,')) continue;
    const provided = trimmed.slice(3);
    let providedBytes: Buffer;
    try {
      providedBytes = Buffer.from(provided, 'base64');
    } catch {
      continue;
    }
    if (providedBytes.length !== expectedBytes.length) continue;
    if (timingSafeEqual(providedBytes, expectedBytes)) return true;
  }
  return false;
}

function decodeSecret(secret: string): Buffer | null {
  const stripped = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  try {
    return Buffer.from(stripped, 'base64');
  } catch {
    return null;
  }
}
