'use client';

import { useAuth } from '@clerk/nextjs';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import { isLiveCallStatus, type CallDetailResponse, type CancelCallResponse } from './types.js';
import { callQueryKey } from './use-call.js';

interface CancelCallContext {
  readonly detailKey: readonly unknown[];
}

export function useCancelCall(
  callId: string,
): UseMutationResult<CancelCallResponse, Error, void, CancelCallContext> {
  const { orgId, userId } = useAuth();
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();

  return useMutation({
    onMutate: () => ({ detailKey: callQueryKey(callId, orgId, userId) }),
    mutationFn: async (): Promise<CancelCallResponse> => {
      const headers = await withAuthHeaders();
      const result = (await client.POST('/v1/calls/{id}/cancel', {
        params: { path: { id: callId } },
        headers,
      })) as { data?: CancelCallResponse; error?: unknown };
      if (result.error || !result.data) {
        throw new Error('Couldn’t request cancellation. Try again.');
      }
      return result.data;
    },
    onSuccess: async (response, _variables, { detailKey }) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      queryClient.setQueryData<CallDetailResponse>(detailKey, (existing) => {
        // Polling can observe terminal evidence before an older cancellation response arrives.
        if (!existing || !isLiveCallStatus(existing.status)) return existing;
        return { ...existing, ...response };
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calls'] }),
        queryClient.invalidateQueries({ queryKey: ['claims'] }),
      ]);
    },
  });
}
