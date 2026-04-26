/**
 * `@dentabill/ui/query` — TanStack Query v5 wiring per ADR-019.
 *
 * What lives here:
 *   - `QueryProvider` — the `<QueryClientProvider>` wrapper that
 *     consumers mount near the root of `apps/web`'s tree.
 *   - `createDentaBillQueryClient()` — factory with our defaults.
 *   - `DENTABILL_QUERY_DEFAULTS` — exported for tests + edge cases
 *     where consumers need to extend rather than replace.
 *
 * Why a separate subpath export (`@dentabill/ui/query`) and not the
 * package barrel:
 *   - Keeps the main `@dentabill/ui` import tree-shakeable. A marketing
 *     page rendering `<HeroDisplay>` shouldn't pull TanStack Query into
 *     its bundle just because the dashboard uses it.
 *   - Makes the API contract explicit: import `QueryProvider` from
 *     the dedicated subpath, not from the barrel.
 *
 * Re-exports the types consumers commonly need so they don't have to
 * pin `@tanstack/react-query` themselves.
 */
export { createDentaBillQueryClient, DENTABILL_QUERY_DEFAULTS } from './client.js';
export { QueryProvider, type QueryProviderProps } from './provider.js';
export type {
  QueryClient,
  QueryClientConfig,
  UseQueryOptions,
  UseMutationOptions,
} from '@tanstack/react-query';
