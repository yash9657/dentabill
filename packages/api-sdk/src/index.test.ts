import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './index.js';

describe('createApiClient()', () => {
  it('returns an openapi-fetch instance with GET/POST/PUT/PATCH/DELETE', () => {
    const client = createApiClient({ baseUrl: 'http://localhost:3001' });
    expect(typeof client.GET).toBe('function');
    expect(typeof client.POST).toBe('function');
    expect(typeof client.PUT).toBe('function');
    expect(typeof client.PATCH).toBe('function');
    expect(typeof client.DELETE).toBe('function');
  });

  it('accepts a fetch override and routes calls through it', async () => {
    /**
     * openapi-fetch invokes the fetch override with a single `Request`
     * argument (Web Fetch API style), not with `(input, init)`.
     * The Request object carries the merged headers / method / body.
     */
    const fetchMock = vi.fn(
      async (_req: Request) =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const client = createApiClient({
      baseUrl: 'http://localhost:3001',
      fetch: fetchMock as unknown as typeof fetch,
    });

    // The SDK is typed against generated paths; the cast lets us exercise
    // the wiring even when /v1/healthz isn't in the current paths union.
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */
    const { data } = await (client.GET as any)('/v1/healthz', {});
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(data).toEqual({ ok: true });
  });

  it('attaches the request-id header when supplied', async () => {
    const fetchMock = vi.fn(
      async (_req: Request) =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const client = createApiClient({
      baseUrl: 'http://localhost:3001',
      requestId: 'abc-123',
      fetch: fetchMock as unknown as typeof fetch,
    });

    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */
    await (client.GET as any)('/v1/healthz', {});
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */

    const req = fetchMock.mock.calls[0]?.[0];
    expect(req).toBeInstanceOf(Request);
    expect(req?.headers.get('x-request-id')).toBe('abc-123');
  });

  it('attaches the bearer token when supplied', async () => {
    const fetchMock = vi.fn(
      async (_req: Request) =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const client = createApiClient({
      baseUrl: 'http://localhost:3001',
      bearerToken: 'jwt.payload.signature',
      fetch: fetchMock as unknown as typeof fetch,
    });

    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */
    await (client.GET as any)('/v1/healthz', {});
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */

    const req = fetchMock.mock.calls[0]?.[0];
    expect(req?.headers.get('authorization')).toBe('Bearer jwt.payload.signature');
  });
});
