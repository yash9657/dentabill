import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';

/**
 * DentaBill defaults for TanStack Query v5 (per ADR-019 — server-state on
 * the client uses TanStack Query; RSC fetch is the server side).
 *
 * Defaults are deliberate, not lifted from generic examples:
 *
 *   - **`staleTime: 30_000`** — most dashboard data is read-mostly with
 *     low fan-out. Thirty seconds means the user can navigate around the
 *     app without re-fetching per click; mutations explicitly invalidate
 *     when something genuinely changed.
 *   - **`gcTime: 5 * 60_000`** — keep cache around for 5 min after last
 *     observer detaches, so back-button feels instant.
 *   - **`refetchOnWindowFocus: false`** — billers leave the dashboard
 *     open all day; the constant refetches on tab switches were noisy
 *     and burned API budget without measurable freshness wins. Realtime
 *     updates land separately in Phase 4 via SSE.
 *   - **`retry`** — three retries on idempotent reads (`GET`/`HEAD`),
 *     none on mutations. Mutations either succeed or surface to the
 *     user — silent retries can double-send dental claims, which is the
 *     literal failure mode this product exists to prevent.
 *   - **`retryDelay`** — exponential 1s → 2s → 4s, capped at 30s. The
 *     cap matters because at the network edge a stuck 30s timeout is
 *     better than a 60s one before the user gives up.
 *   - **`throwOnError`** — true for queries so render-time fetch
 *     failures bubble up to the nearest `<ErrorBoundary>` (P2-T16).
 *     Without this, components have to handle `query.isError` in every
 *     render path; with it, the boundary catches once and we report
 *     the error through the existing observability pipeline.
 */
export const DENTABILL_QUERY_DEFAULTS: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000),
      throwOnError: true,
    },
    mutations: {
      retry: false,
      // Mutation errors stay local to the calling component so a failed
      // status edit can be surfaced inline (toast, form-level message)
      // rather than tearing down the whole subtree via the boundary.
      throwOnError: false,
    },
  },
};

/**
 * Factory for a fresh `QueryClient`. Each browser tab / SSR pass gets
 * its own instance — sharing across the server boundary leaks state
 * across requests, which is why Next 15 RSC docs are emphatic about
 * "always create a new client per request."
 */
export function createDentaBillQueryClient(overrides: QueryClientConfig = {}): QueryClient {
  return new QueryClient({
    ...DENTABILL_QUERY_DEFAULTS,
    ...overrides,
    defaultOptions: {
      queries: {
        ...DENTABILL_QUERY_DEFAULTS.defaultOptions?.queries,
        ...overrides.defaultOptions?.queries,
      },
      mutations: {
        ...DENTABILL_QUERY_DEFAULTS.defaultOptions?.mutations,
        ...overrides.defaultOptions?.mutations,
      },
    },
  });
}
