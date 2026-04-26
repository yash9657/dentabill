import { NextResponse } from 'next/server';

/**
 * `POST /v1/errors` — same-origin sink for the client-side
 * `<ErrorBoundary>` and the unhandled-error listener
 * (`lib/observability/error-reporter.ts`).
 *
 * Same rationale as `/v1/metrics/web`: the client posts via
 * `keepalive: true` fetch / sendBeacon, and a 404 surfaces a console
 * error that's correct to fail e2e on. Until the real API is wired,
 * this is a 204 sink so the client side can ship without the server
 * side blocking it.
 */
export function POST(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export const runtime = 'edge';
