'use client';

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { createDentaBillQueryClient } from './client.js';

/**
 * `<QueryProvider>` — wraps a subtree (typically the entire app shell)
 * with a stable `QueryClient`. Two construction modes:
 *
 *   1. Caller passes `client` — they own its lifecycle. Useful in tests
 *      and when SSR-streaming a hydrated client.
 *   2. Caller passes nothing — we lazy-initialise a client *inside* a
 *      `useState` so it's created exactly once per tab. Re-creating on
 *      every render would burn the cache; recreating on every navigation
 *      would also defeat client-side caching.
 *
 * Devtools are imported lazily and only rendered in development, so
 * production bundles don't pay their ~30 KB cost. The lazy import makes
 * the devtools chunk tree-shake cleanly under the bundle budget gate.
 */
export interface QueryProviderProps {
  readonly children: React.ReactNode;
  readonly client?: QueryClient;
  /**
   * Force-enable devtools in non-development environments. Default is
   * `process.env.NODE_ENV !== 'production'`. Useful for staging.
   */
  readonly enableDevtools?: boolean;
}

const LazyDevtools = React.lazy(async () => {
  const mod = await import('@tanstack/react-query-devtools');
  return { default: mod.ReactQueryDevtools };
});

export function QueryProvider({
  children,
  client,
  enableDevtools,
}: QueryProviderProps): React.ReactElement {
  /**
   * `useState` with a factory ensures the client is created exactly
   * once per component instance. Passing `client` directly bypasses the
   * lazy-init path entirely.
   */
  const [internalClient] = React.useState(() => client ?? createDentaBillQueryClient());

  const showDevtools = enableDevtools ?? process.env.NODE_ENV !== 'production';

  return (
    <QueryClientProvider client={internalClient}>
      {children}
      {showDevtools ? (
        <React.Suspense fallback={null}>
          <LazyDevtools initialIsOpen={false} buttonPosition="bottom-right" />
        </React.Suspense>
      ) : null}
    </QueryClientProvider>
  );
}
