'use client';

import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import type { AuditLogsFilters, AuditLogsListResponse } from './types.js';

const DEFAULT_PAGE_SIZE = 25;

/**
 * Query key factory for audit logs. Includes filters so changing a
 * filter resets pagination to page 1 automatically.
 */
export function auditLogsQueryKey(filters: AuditLogsFilters): readonly unknown[] {
  return [
    'auditLogs',
    'list',
    {
      resourceType: filters.resourceType ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
    },
  ];
}

/**
 * Drives the `/dashboard/settings/audit-log` table. Wraps `useInfiniteQuery`
 * over the SDK's typed `GET /v1/audit-logs` so paging is just `fetchNextPage()`
 * and `hasNextPage` is derived from the cursor returned by the API.
 *
 * Filters are part of the queryKey so toggling a filter resets the cursor
 * and starts a fresh page-1 fetch — no manual reset needed.
 */
export type UseAuditLogsResult = UseInfiniteQueryResult<{
  readonly pages: readonly AuditLogsListResponse[];
  readonly pageParams: readonly (string | undefined)[];
}>;

export function useAuditLogs(filters: AuditLogsFilters): UseAuditLogsResult {
  const { client, withAuthHeaders } = useDentaBillApi();

  return useInfiniteQuery({
    queryKey: auditLogsQueryKey(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<AuditLogsListResponse> => {
      const headers = await withAuthHeaders();
      const query: Record<string, string | number> = { limit: DEFAULT_PAGE_SIZE };

      if (filters.resourceType) query.resourceType = filters.resourceType;
      if (filters.from) query.from = filters.from;
      if (filters.to) query.to = filters.to;
      if (pageParam) query.cursor = pageParam;

      // The route declares only a 200 response, so the generated types give
      // `error` a never-ish shape even though 401/400 are reachable at
      // runtime. Widening the result is the established pattern here — see
      // lib/claims/use-claims-list.ts. The path itself stays typed.
      const result = (await client.GET('/v1/audit-logs', {
        params: { query },
        headers,
        signal,
      })) as {
        data?: AuditLogsListResponse;
        error?: { message?: string; code?: string };
      };

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to load audit logs.');
      }
      if (!result.data) {
        throw new Error('Empty response from /v1/audit-logs.');
      }

      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
