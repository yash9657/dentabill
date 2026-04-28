'use client';

import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';
import type { PayerCode } from '../claims/types.js';

import { isLiveCallStatus, type CallsListResponse, type CallStatus } from './types.js';

const DEFAULT_PAGE_SIZE = 25;

/**
 * Polling cadence per ADR-034: when any visible call is in a live
 * status (anything other than COMPLETED / FAILED / VOICEMAIL), poll
 * every 5s so the operator sees state transitions land. Otherwise
 * fall back to 30s — enough to pick up new rows without burning the
 * battery on an idle dashboard.
 */
const LIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 30000;

export interface CallsFilters {
  readonly status?: CallStatus;
  readonly payer?: PayerCode;
}

export const callsQueryKey = (filters: CallsFilters): readonly unknown[] => [
  'calls',
  'list',
  { status: filters.status ?? null, payer: filters.payer ?? null },
];

export type UseCallsListResult = UseInfiniteQueryResult<{
  readonly pages: readonly CallsListResponse[];
  readonly pageParams: readonly (string | undefined)[];
}>;

export function useCallsList(filters: CallsFilters): UseCallsListResult {
  const { client, withAuthHeaders } = useDentaBillApi();

  return useInfiniteQuery({
    queryKey: callsQueryKey(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<CallsListResponse> => {
      const headers = await withAuthHeaders();
      const query: Record<string, string | number> = { limit: DEFAULT_PAGE_SIZE };
      if (filters.status) query.status = filters.status;
      if (filters.payer) query.payer = filters.payer;
      if (pageParam) query.cursor = pageParam;

      const result = (await client.GET('/v1/calls', {
        params: { query },
        headers,
        signal,
      })) as {
        data?: CallsListResponse;
        error?: { message?: string; code?: string };
      };
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to load calls.');
      }
      if (!result.data) throw new Error('Empty response from /v1/calls.');
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return IDLE_POLL_MS;
      const items = data.pages.flatMap((p: CallsListResponse) => p.items);
      const anyLive = items.some((row) => isLiveCallStatus(row.status));
      return anyLive ? LIVE_POLL_MS : IDLE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}
