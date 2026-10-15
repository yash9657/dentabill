'use client';

import { useAuth } from '@clerk/nextjs';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import { isLiveCallStatus, type CallDetailResponse } from './types.js';

export const callQueryKey = (
  id: string,
  organizationId: string | null | undefined,
  userId: string | null | undefined,
): readonly unknown[] => ['calls', 'detail', id, organizationId ?? null, userId ?? null];

const LIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 30000;

interface ApiErrorBody {
  message?: string;
  code?: string;
}

/**
 * `GET /v1/calls/:id` (P3-T19). Polls 5s while the call is live,
 * 30s otherwise — same cadence as the list page so the two surfaces
 * stay coherent if the user opens both in adjacent tabs.
 */
export function useCall(id: string): UseQueryResult<CallDetailResponse> {
  const { orgId, userId, isLoaded } = useAuth();
  const admitted = isLoaded && Boolean(orgId && userId);
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: callQueryKey(id, admitted ? orgId : null, admitted ? userId : null),
    enabled: admitted,
    throwOnError: false,
    retry: false,
    queryFn: async ({ signal }): Promise<CallDetailResponse> => {
      const headers = await withAuthHeaders();
      const result = (await client.GET('/v1/calls/{id}', {
        params: { path: { id } },
        headers,
        signal,
      })) as { data?: CallDetailResponse; error?: ApiErrorBody };
      if (result.error) throw new Error(result.error.message ?? 'Failed to load call.');
      if (!result.data) throw new Error('Empty response from /v1/calls/:id.');
      return result.data;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return IDLE_POLL_MS;
      return isLiveCallStatus(data.status) ? LIVE_POLL_MS : IDLE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}
