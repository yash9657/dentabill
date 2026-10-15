'use client';

import type { paths } from '@dentabill/api-sdk/types';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

type RecoveryPath = paths['/v1/claims/{id}/call-recovery']['get'];
type ReconcilePath = paths['/v1/call-intents/{id}/reconcile']['post'];
export type CallRecoveryResponse = RecoveryPath['responses'][200]['content']['application/json'];
export type CallReconcileResponse = ReconcilePath['responses'][200]['content']['application/json'];

interface ReconcileCallResult {
  readonly claimId: string;
  readonly recovery: CallReconcileResponse;
}

export const callRecoveryQueryKey = (claimId: string): readonly string[] => [
  'calls',
  'recovery',
  claimId,
];

export function useCallRecovery(claimId: string): UseQueryResult<CallRecoveryResponse> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: callRecoveryQueryKey(claimId),
    queryFn: async ({ signal }): Promise<CallRecoveryResponse> => {
      const result = (await client.GET('/v1/claims/{id}/call-recovery', {
        params: { path: { id: claimId } },
        headers: await withAuthHeaders(),
        signal,
      })) as { data?: CallRecoveryResponse; error?: unknown };
      if (result.error || !result.data)
        throw new Error('Couldn’t confirm the existing call status.');
      return result.data;
    },
    retry: false,
    throwOnError: false,
    refetchInterval: (query) => (query.state.data?.intent ? 5_000 : 30_000),
  });
}

export function useReconcileCall(
  claimId: string,
): UseMutationResult<ReconcileCallResult, Error, string> {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['calls', 'reconcile', claimId],
    mutationFn: async (intentId: string): Promise<ReconcileCallResult> => {
      const result = (await client.POST('/v1/call-intents/{id}/reconcile', {
        params: { path: { id: intentId } },
        headers: await withAuthHeaders(),
        body: {},
      })) as { data?: CallReconcileResponse; error?: unknown };
      if (result.error || !result.data) {
        throw new Error('The existing call could not be checked. Keep this claim in review.');
      }
      return { claimId, recovery: result.data };
    },
    onSuccess: async (result) => {
      // The provider may finish while the lookup is in flight. Refresh authoritative
      // state instead of writing an earlier lookup response over a newer status.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calls'] }),
        queryClient.invalidateQueries({ queryKey: ['claims', 'detail', result.claimId] }),
        queryClient.invalidateQueries({ queryKey: ['claims', 'list'] }),
      ]);
    },
  });
}
