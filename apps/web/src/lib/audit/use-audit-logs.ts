'use client';

import { useAuth } from '@clerk/nextjs';
import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import type { AuditLogsFilters, AuditLogsListQuery, AuditLogsListResponse } from './types.js';

const DEFAULT_PAGE_SIZE = 25;

/**
 * Query key factory for audit logs. Includes filters so changing a
 * filter resets pagination to page 1 automatically.
 */
export function auditLogsQueryKey(
  filters: AuditLogsFilters,
  organizationId: string | null | undefined,
  userId: string | null | undefined,
): readonly unknown[] {
  return [
    'auditLogs',
    'list',
    organizationId ?? null,
    userId ?? null,
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
  const { isLoaded, orgId, userId } = useAuth();
  const admitted = isLoaded && Boolean(orgId && userId);
  const { client, withAuthHeaders } = useDentaBillApi();

  return useInfiniteQuery({
    queryKey: auditLogsQueryKey(filters, admitted ? orgId : null, admitted ? userId : null),
    enabled: admitted,
    retry: false,
    throwOnError: false,
    refetchOnWindowFocus: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<AuditLogsListResponse> => {
      const query: AuditLogsListQuery = { limit: DEFAULT_PAGE_SIZE };

      if (filters.resourceType) query.resourceType = filters.resourceType;
      if (filters.from) query.from = filters.from;
      if (filters.to) query.to = filters.to;
      if (pageParam) query.cursor = pageParam;

      try {
        const result = await client.GET('/v1/audit-logs', {
          params: { query },
          headers: await withAuthHeaders(),
          signal,
        });
        if (!result.data) throw new Error();
        return result.data;
      } catch {
        throw new Error('Audit logs could not be loaded. Reload the page to try again.');
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
