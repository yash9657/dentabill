/**
 * Request-ID propagation between server and client.
 *
 * The flow:
 *   1. The edge middleware (`apps/web/src/middleware.ts`) doesn't set a
 *      request id today — Fastify on the API side does. Until the
 *      middleware also stamps an `x-request-id` header, server-rendered
 *      pages mint one in the root layout via `getServerRequestId()`.
 *   2. The id is rendered into the document as `<meta name="x-request-id">`
 *      so the client can read it without a network round-trip.
 *   3. Every client-side fetch to `/v1/*` includes the same id via
 *      `getClientRequestId()`. The Fastify API reuses it as `req.id` if
 *      present; otherwise it generates its own.
 *
 * This makes browser logs, server logs, and any future Sentry breadcrumbs
 * correlate to the same trace id on a per-page-load basis.
 */

const META_NAME = 'x-request-id';

/**
 * Server-side: reads the `x-request-id` header set by middleware (or
 * mints a fresh one if the header is missing — defensive fallback).
 * Safe to call from any RSC. The `headers()` import is only valid in
 * Server Components, so this file ships a separate client helper below.
 */
export async function getServerRequestId(): Promise<string> {
  const { headers } = await import('next/headers');
  const h = await headers();
  const existing = h.get('x-request-id');
  if (existing) return existing;
  return mintRequestId();
}

/**
 * Client-side: reads the request id from the meta tag embedded by the
 * root layout. Returns `null` if the meta is missing — callers should
 * treat that as "no correlation available" rather than fabricating one,
 * to keep client-only ids out of the server's trace graph.
 */
export function getClientRequestId(): string | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${META_NAME}"]`);
  return meta?.content ?? null;
}

/**
 * 16 random bytes encoded as base64url. Same shape as the CSP nonce
 * generator in `lib/security-headers.ts`. We don't reuse the nonce
 * directly because nonces are per-response-only and rotated aggressively;
 * the request id may live longer (e.g. if a navigation triggers a
 * client-side rerender, the same id correlates the page session).
 */
export function mintRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const REQUEST_ID_META_NAME = META_NAME;
export const REQUEST_ID_HEADER = 'x-request-id';
