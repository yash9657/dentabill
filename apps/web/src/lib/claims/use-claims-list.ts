'use client';

import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import type { ClaimsFilters, ClaimsListResponse } from './types.js';

const DEFAULT_PAGE_SIZE = 25;

export const claimsQueryKey = (filters: ClaimsFilters): readonly unknown[] => [
  'claims',
  'list',
  { status: filters.status ?? null, payer: filters.payer ?? null, search: filters.search ?? null },
];

/**
 * Drives the `/dashboard/claims` table. Wraps `useInfiniteQuery` over
 * the SDK's typed `GET /v1/claims` so paging is just `fetchNextPage()`
 * and `hasNextPage` is derived from the cursor returned by the API.
 *
 * Filters are part of the queryKey so toggling a status chip resets
 * the cursor and starts a fresh page-1 fetch — no manual reset needed.
 */
export type UseClaimsListResult = UseInfiniteQueryResult<{
  readonly pages: readonly ClaimsListResponse[];
  readonly pageParams: readonly (string | undefined)[];
}>;

export function useClaimsList(filters: ClaimsFilters): UseClaimsListResult {
  const { client, withAuthHeaders } = useDentaBillApi();

  return useInfiniteQuery({
    queryKey: claimsQueryKey(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<ClaimsListResponse> => {
      const headers = await withAuthHeaders();
      const query: Record<string, string | number> = { limit: DEFAULT_PAGE_SIZE };
      if (filters.status) query.status = filters.status;
      if (filters.payer) query.payer = filters.payer;
      if (filters.search && filters.search.trim().length > 0) query.search = filters.search.trim();
      if (pageParam) query.cursor = pageParam;

      const result = (await client.GET('/v1/claims', {
        params: { query },
        headers,
        signal,
      })) as {
        data?: ClaimsListResponse;
        error?: { message?: string; code?: string };
      };
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to load claims.');
      }
      if (!result.data) throw new Error('Empty response from /v1/claims.');
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
