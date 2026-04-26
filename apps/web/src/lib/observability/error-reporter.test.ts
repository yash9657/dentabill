import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildErrorReport, reportError } from './error-reporter.js';

describe('buildErrorReport()', () => {
  it('captures name + message + stack + source + path', () => {
    const err = new Error('boom');
    err.name = 'CustomError';
    const payload = buildErrorReport(err, { source: 'errorBoundary' });
    expect(payload.name).toBe('CustomError');
    expect(payload.message).toBe('boom');
    expect(typeof payload.stack).toBe('string');
    expect(payload.source).toBe('errorBoundary');
    expect(payload.path).toBe('/');
  });

  it('passes through a digest when provided (Next.js error.digest)', () => {
    const err = new Error('x');
    const payload = buildErrorReport(err, { source: 'routeError', digest: 'abc-123' });
    expect(payload.digest).toBe('abc-123');
  });

  it('omits digest when not provided (no `digest: undefined` leak in JSON)', () => {
    const err = new Error('x');
    const payload = buildErrorReport(err, { source: 'errorBoundary' });
    expect('digest' in payload).toBe(false);
  });
});

describe('reportError()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses sendBeacon when available for fire-and-forget delivery', () => {
    const sendBeacon = vi.fn((_url: string, _data?: BodyInit) => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });

    reportError(new Error('boom'), { source: 'window' });

    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(sendBeacon).toHaveBeenCalledWith('/v1/errors', expect.any(Blob));
  });

  it('falls back to fetch when sendBeacon refuses', () => {
    const sendBeacon = vi.fn((_url: string, _data?: BodyInit) => false);
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    vi.stubGlobal('fetch', fetchMock);

    reportError(new Error('boom'), { source: 'unhandledRejection' });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/errors',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    );
  });
});
