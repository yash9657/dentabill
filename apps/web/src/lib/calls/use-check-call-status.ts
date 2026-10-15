'use client';

import type { paths } from '@dentabill/api-sdk/types';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

type CheckStatusPath = paths['/v1/calls/{id}/check-status']['post'];
export type CheckCallStatusResponse =
  CheckStatusPath['responses'][200]['content']['application/json'];

export function useCheckCallStatus(
  callId: string,
): UseMutationResult<CheckCallStatusResponse, Error, void> {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['calls', 'check-status', callId],
    mutationFn: async (): Promise<CheckCallStatusResponse> => {
      const result = (await client.POST('/v1/calls/{id}/check-status', {
        params: { path: { id: callId } },
        headers: await withAuthHeaders(),
        body: {},
      })) as { data?: CheckCallStatusResponse; error?: { code?: string } };
      if (result.error?.code === 'INVALID_STATE_TRANSITION')
        throw new Error('A status check is underway or was just completed. Try again in a minute.');
      if (result.error?.code === 'CALL_RECONCILIATION_UNAVAILABLE')
        throw new Error('Call lookup is not configured. Contact your administrator.');
      if (result.error || !result.data)
        throw new Error('Couldn’t check call status. Keep the claim in review and try again.');
      return result.data;
    },
    onSuccess: async () => {
      // An older lookup response must never overwrite terminal evidence from polling.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calls'] }),
        queryClient.invalidateQueries({ queryKey: ['claims'] }),
      ]);
    },
  });
}
