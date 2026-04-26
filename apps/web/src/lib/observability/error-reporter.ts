import { getClientRequestId, REQUEST_ID_HEADER } from './request-id.js';

/**
 * Unhandled-error reporter. Posts to `/v1/errors`. Used by the React
 * `<ErrorBoundary>` (render-time errors), the App Router `error.tsx`
 * boundary (route-time errors), and a `window.onerror` /
 * `unhandledrejection` listener wired up at module import.
 *
 * The endpoint doesn't exist yet (Phase 2 API surface lands across
 * P2-T12 → T16); the reporter is a no-op delivery-wise but the call
 * sites are real, so when the route ships it's a one-line change to
 * start receiving errors.
 *
 * **PHI rules.** This reporter ships `error.message` and `stack` to the
 * server. Front-end code authors MUST avoid putting PHI into thrown
 * error messages — keep PHI in state, surface a redacted message to
 * the user. The server-side `/v1/errors` route will additionally pass
 * incoming payloads through `@dentabill/logger`'s redaction stack.
 */
const ENDPOINT = '/v1/errors';

export interface ErrorReportPayload {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly digest?: string;
  readonly path: string;
  readonly userAgent: string;
  readonly requestId: string | null;
  readonly source: 'errorBoundary' | 'routeError' | 'window' | 'unhandledRejection';
}

export interface ReportErrorOptions {
  readonly source: ErrorReportPayload['source'];
  readonly digest?: string | undefined;
}

export function buildErrorReport(
  err: Error,
  { source, digest }: ReportErrorOptions,
): ErrorReportPayload {
  return {
    name: err.name,
    message: err.message,
    ...(err.stack !== undefined ? { stack: err.stack } : {}),
    ...(digest !== undefined ? { digest } : {}),
    path: typeof location === 'undefined' ? '' : location.pathname,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    requestId: getClientRequestId(),
    source,
  };
}

export function reportError(err: Error, opts: ReportErrorOptions): void {
  if (typeof window === 'undefined') return;
  const payload = buildErrorReport(err, opts);
  const body = JSON.stringify(payload);
  if (typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' });
    const ok = navigator.sendBeacon(ENDPOINT, blob);
    if (ok) return;
  }
  void fetch(ENDPOINT, {
    method: 'POST',
    body,
    keepalive: true,
    headers: {
      'content-type': 'application/json',
      ...(payload.requestId ? { [REQUEST_ID_HEADER]: payload.requestId } : {}),
    },
  }).catch(() => {
    /* fire-and-forget */
  });
}

/**
 * Attaches `window.onerror` + `unhandledrejection` listeners so synchronous
 * runtime errors and rejected promises are reported even if the React
 * error boundary doesn't see them (e.g., errors in a setTimeout, errors in
 * a non-React event handler).
 *
 * Idempotent — multiple calls are safe; repeated registration is a no-op.
 */
let attached = false;
export function attachGlobalErrorListeners(): void {
  if (attached) return;
  if (typeof window === 'undefined') return;
  attached = true;

  window.addEventListener('error', (event) => {
    const err = event.error instanceof Error ? event.error : new Error(event.message);
    reportError(err, { source: 'window' });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const err =
      event.reason instanceof Error
        ? event.reason
        : new Error(typeof event.reason === 'string' ? event.reason : 'Unhandled rejection');
    reportError(err, { source: 'unhandledRejection' });
  });
}
