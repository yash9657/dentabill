import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metric } from 'web-vitals';

import { buildWebVitalPayload, reportWebVital } from './web-vitals.js';

const sampleMetric: Metric = {
  id: 'v3-12345',
  name: 'LCP',
  value: 2100,
  rating: 'good',
  delta: 2100,
  navigationType: 'navigate',
  entries: [],
};

describe('buildWebVitalPayload()', () => {
  it('flattens a Metric to the wire shape we POST to /v1/metrics/web', () => {
    const payload = buildWebVitalPayload(sampleMetric);
    expect(payload).toMatchObject({
      id: 'v3-12345',
      name: 'LCP',
      value: 2100,
      rating: 'good',
      delta: 2100,
      navigationType: 'navigate',
      path: expect.any(String),
      userAgent: expect.any(String),
    });
    // requestId is null in jsdom because no meta tag is present.
    expect(payload.requestId).toBeNull();
  });
});

describe('reportWebVital()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.innerHTML = '';
  });

  it('prefers navigator.sendBeacon for fire-and-forget delivery', () => {
    const sendBeacon = vi.fn((_url: string, _data?: BodyInit) => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });

    reportWebVital(sampleMetric);

    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(sendBeacon).toHaveBeenCalledWith('/v1/metrics/web', expect.any(Blob));
  });

  it('falls back to fetch when sendBeacon refuses', () => {
    const sendBeacon = vi.fn((_url: string, _data?: BodyInit) => false);
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    vi.stubGlobal('fetch', fetchMock);

    reportWebVital(sampleMetric);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/metrics/web',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    );
  });
});
