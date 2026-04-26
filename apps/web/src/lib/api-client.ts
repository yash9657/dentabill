'use client';

import { useAuth } from '@clerk/nextjs';
import { createApiClient, type DentaBillApiClient } from '@dentabill/api-sdk';
import * as React from 'react';

import { getClientRequestId } from './observability/request-id.js';

/**
 * Returns a memoised `@dentabill/api-sdk` client wired with the
 * current Clerk session token (when present) and the request-id
 * stamped into the page-load `<meta>` tag.
 *
 * The SDK is a thin `openapi-fetch` wrapper, so creating a client is
 * cheap — but we still memoise it so React Query can hash queryKeys
 * and queryFns deterministically across renders.
 *
 * Auth model: Clerk's `getToken()` is async (it may need to refresh).
 * The hook below returns a *plain* client without a token, plus a
 * helper that returns a fresh per-request token getter. Callers wrap
 * fetches in `withAuth(async (token) => client.GET(...))` so the
 * token is reread on every call. This keeps the QueryClient cache
 * keyed only on inputs (filters, cursor) — the bearer token is not
 * part of the cache key.
 *
 * In CI / dev without Clerk keys mounted, `useAuth` returns a no-op
 * `getToken` and the client falls back to anonymous. The Fastify
 * server-side bypass header is **never** sent from the browser; it
 * is intended only for vitest integration tests.
 */
export interface ClaimsApi {
  readonly client: DentaBillApiClient;
  readonly withAuthHeaders: () => Promise<Record<string, string>>;
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? (typeof window === 'undefined' ? 'http://localhost:3001' : '');

export function useDentaBillApi(): ClaimsApi {
  const auth = useAuth();
  const client = React.useMemo(() => {
    const requestId = getClientRequestId();
    return createApiClient({
      baseUrl: API_BASE_URL,
      ...(requestId ? { requestId } : {}),
    });
  }, []);

  const withAuthHeaders = React.useCallback(async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {};
    const requestId = getClientRequestId();
    if (requestId) headers['x-request-id'] = requestId;
    if (typeof auth.getToken === 'function') {
      try {
        const token = await auth.getToken();
        if (token) headers.authorization = `Bearer ${token}`;
      } catch {
        // Clerk may throw if the session is gone. Surface as anonymous.
      }
    }
    return headers;
  }, [auth]);

  return { client, withAuthHeaders };
}
