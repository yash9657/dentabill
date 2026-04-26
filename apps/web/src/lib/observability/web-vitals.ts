import type { Metric } from 'web-vitals';

import { getClientRequestId, REQUEST_ID_HEADER } from './request-id.js';

/**
 * Web-vitals reporter. Posts each Core Web Vital sample to the API at
 * `/v1/metrics/web` so the team can correlate field perf to the
 * Lighthouse-CI lab numbers (ADR-020).
 *
 * Why `sendBeacon` (with a `fetch` fallback): Beacons are guaranteed to
 * fire even on `pagehide` / unload, which is exactly when the last
 * `INP` / `CLS` samples land. The fallback handles browsers without
 * sendBeacon — those still get delivery on most events, just not the
 * unload-time one.
 *
 * The endpoint itself doesn't exist yet (Phase 2 API surface lives at
 * P2-T12 → T13 → T16). This reporter is a no-op until the route lands;
 * we build the client side first so the migration to a real endpoint is
 * a config-flag flip, not new code.
 */
const ENDPOINT = '/v1/metrics/web';

export interface WebVitalPayload {
  readonly id: string;
  readonly name: Metric['name'];
  readonly value: number;
  readonly rating: Metric['rating'];
  readonly delta: number;
  readonly navigationType: Metric['navigationType'];
  readonly path: string;
  readonly userAgent: string;
  readonly requestId: string | null;
}

export function buildWebVitalPayload(metric: Metric): WebVitalPayload {
  return {
    id: metric.id,
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    navigationType: metric.navigationType,
    path: typeof location === 'undefined' ? '' : location.pathname,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    requestId: getClientRequestId(),
  };
}

export function reportWebVital(metric: Metric): void {
  if (typeof window === 'undefined') return;
  const payload = buildWebVitalPayload(metric);
  const body = JSON.stringify(payload);
  // sendBeacon doesn't accept custom headers, so the request id flows
  // inside the body for beacon delivery. The fetch fallback also sets it
  // as a header so the server-side router can correlate without parsing.
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
    /* fire-and-forget; observability failures must never crash the app */
  });
}
