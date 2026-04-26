import { describe, expect, it } from 'vitest';

import { createDentaBillQueryClient, DENTABILL_QUERY_DEFAULTS } from './client.js';

describe('DENTABILL_QUERY_DEFAULTS', () => {
  const queryDefaults = DENTABILL_QUERY_DEFAULTS.defaultOptions?.queries;
  const mutationDefaults = DENTABILL_QUERY_DEFAULTS.defaultOptions?.mutations;

  it('queries: 30s staleTime and 5min gcTime', () => {
    expect(queryDefaults?.staleTime).toBe(30_000);
    expect(queryDefaults?.gcTime).toBe(5 * 60_000);
  });

  it('queries: refetchOnWindowFocus is OFF (billers leave dashboards open all day)', () => {
    expect(queryDefaults?.refetchOnWindowFocus).toBe(false);
  });

  it('queries: 3 retries with exponential backoff capped at 30s', () => {
    expect(queryDefaults?.retry).toBe(3);
    const retryDelay = queryDefaults?.retryDelay;
    expect(typeof retryDelay).toBe('function');
    if (typeof retryDelay !== 'function') return;
    expect(retryDelay(0, new Error())).toBe(1000);
    expect(retryDelay(1, new Error())).toBe(2000);
    expect(retryDelay(2, new Error())).toBe(4000);
    // Cap: attempt 10 would be 1024s; clamp to 30s.
    expect(retryDelay(10, new Error())).toBe(30_000);
  });

  it('queries: throwOnError is true (boundary catches; ADR-019)', () => {
    expect(queryDefaults?.throwOnError).toBe(true);
  });

  it('mutations: zero retries (avoid double-sending dental claims)', () => {
    expect(mutationDefaults?.retry).toBe(false);
  });

  it('mutations: throwOnError is false (callers handle inline)', () => {
    expect(mutationDefaults?.throwOnError).toBe(false);
  });
});

describe('createDentaBillQueryClient()', () => {
  it('returns a QueryClient instance with the DentaBill defaults applied', () => {
    const client = createDentaBillQueryClient();
    const opts = client.getDefaultOptions();
    expect(opts.queries?.staleTime).toBe(30_000);
    expect(opts.queries?.refetchOnWindowFocus).toBe(false);
    expect(opts.mutations?.retry).toBe(false);
  });

  it('respects per-call overrides without dropping the unset defaults', () => {
    const client = createDentaBillQueryClient({
      defaultOptions: {
        queries: { staleTime: 0 },
      },
    });
    const opts = client.getDefaultOptions();
    expect(opts.queries?.staleTime).toBe(0); // overridden
    expect(opts.queries?.gcTime).toBe(5 * 60_000); // preserved
    expect(opts.queries?.refetchOnWindowFocus).toBe(false); // preserved
  });
});
