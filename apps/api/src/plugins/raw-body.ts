import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Captures the raw request body alongside the parsed JSON for routes
 * that need to verify a payload signature (P3-T17 — Retell webhook
 * HMAC).
 *
 * Fastify's default JSON parser only exposes `request.body`, the
 * already-parsed object. Re-serialising that object produces a
 * different byte-for-byte representation than what the sender
 * signed: whitespace normalisation, key-order shuffling, and Date
 * coercion all mutate the bytes. The HMAC must be computed over the
 * exact bytes we received.
 *
 * `addContentTypeParser('application/json', { parseAs: 'buffer' })`
 * gives us the raw `Buffer`, which we stash on `request.rawBody` and
 * then JSON.parse for downstream handlers. The override is global —
 * existing routes keep working because they only ever read
 * `request.body`, which is still the parsed object.
 *
 * Bodies above the global Fastify body-limit reject before this
 * parser runs.
 */
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export function registerRawBodyPlugin(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request: FastifyRequest, body: Buffer, done) => {
      // Stash the raw bytes so the webhook route can verify the HMAC.
      request.rawBody = body;
      if (body.length === 0) {
        // Fastify treats `undefined` as "no body" — empty payloads on
        // routes with `body` schemas still go through validation.
        done(null, undefined);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(body.toString('utf8'));
        done(null, parsed);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        // Tag with statusCode so Fastify returns 400, matching the
        // built-in JSON parser behaviour.
        (error as Error & { statusCode?: number }).statusCode = 400;
        done(error, undefined);
      }
    },
  );
}
