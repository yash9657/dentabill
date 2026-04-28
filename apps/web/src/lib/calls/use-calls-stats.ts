'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import type { CallsStatsResponse } from './types.js';

const STATS_POLL_MS = 60000;

interface ApiErrorBody {
  message?: string;
  code?: string;
}

/**
 * `GET /v1/calls/stats` (P3-T25). The four overview KPI tiles share
 * one fetch: callsToday / queueDepth / avgCallSeconds /
 * recoveredThisWeekCents. Polls every 60s — slower than the calls
 * list (5s/30s) because the dashboard is a glance surface, not a
 * live screen, and the aggregates churn slower than individual rows.
 */
export function useCallsStats(): UseQueryResult<CallsStatsResponse> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: ['calls', 'stats'],
    throwOnError: false,
    retry: false,
    queryFn: async ({ signal }): Promise<CallsStatsResponse> => {
      const headers = await withAuthHeaders();
      const result = (await client.GET('/v1/calls/stats', { headers, signal })) as {
        data?: CallsStatsResponse;
        error?: ApiErrorBody;
      };
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to load overview stats.');
      }
      if (!result.data) throw new Error('Empty response from /v1/calls/stats.');
      return result.data;
    },
    refetchInterval: STATS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}
