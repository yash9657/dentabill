import { NextResponse } from 'next/server';

/**
 * `POST /v1/metrics/web` — same-origin sink for the web-vitals
 * reporter (`reportWebVital()` in `lib/observability/web-vitals.ts`).
 *
 * The reporter posts via `navigator.sendBeacon`, which dispatches at
 * `pagehide` / `unload` and cannot be cancelled by the page. If the
 * endpoint 404s, the browser surfaces a "Failed to load resource"
 * console error that leaks into our Playwright `consoleErrors`
 * fixture, which is correct: a 404 here is a real bug visible to a
 * real user.
 *
 * Until the API surface in `apps/api` is wired up to consume these
 * metrics (Phase 2 plan T16/T13 wired the client side; the server
 * side ingestion is queued for after T37 lands the auth middleware),
 * this route is a 204-no-content sink. The body is intentionally
 * dropped — we don't want to risk caching, logging, or otherwise
 * persisting unauthenticated client-supplied metric payloads on the
 * Next.js edge runtime.
 */
export function POST(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export const runtime = 'edge';
