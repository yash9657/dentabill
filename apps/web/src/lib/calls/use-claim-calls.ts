'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import { isLiveCallStatus, type CallsListResponse } from './types.js';

/**
 * Polling cadence mirrors `useCallsList` (ADR-034): 5s while any call
 * for this claim is in a live phase, 30s when everything is settled.
 *
 * Bounded to a single claim so pagination isn't worth the ceremony —
 * we ask for the max page size in one shot. Phase 3 caps attempts at
 * 2 per claim per day (ADR-039), so the practical row count stays
 * tiny even across long-lived claims.
 */
const LIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 30000;
const PAGE_SIZE = 50;

export const claimCallsQueryKey = (claimId: string): readonly unknown[] => [
  'calls',
  'list',
  { claimId },
];

export function useClaimCalls(claimId: string): UseQueryResult<CallsListResponse> {
  const { client, withAuthHeaders } = useDentaBillApi();

  return useQuery({
    queryKey: claimCallsQueryKey(claimId),
    queryFn: async ({ signal }): Promise<CallsListResponse> => {
      const headers = await withAuthHeaders();
      const result = (await client.GET('/v1/calls', {
        params: { query: { claimId, limit: PAGE_SIZE } },
        headers,
        signal,
      })) as {
        data?: CallsListResponse;
        error?: { message?: string; code?: string };
      };
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to load calls for claim.');
      }
      if (!result.data) throw new Error('Empty response from /v1/calls.');
      return result.data;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return IDLE_POLL_MS;
      return data.items.some((row) => isLiveCallStatus(row.status)) ? LIVE_POLL_MS : IDLE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}
