'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import type { Claim, ClaimStatus } from './types.js';

const claimQueryKey = (id: string): readonly unknown[] => ['claims', 'detail', id];

interface ApiErrorBody {
  message?: string;
  code?: string;
}

export function useClaim(id: string): UseQueryResult<Claim> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: claimQueryKey(id),
    // Render the error inline (the page surface owns the empty-state),
    // not via the global ErrorBoundary — a single missing claim
    // shouldn't tear down the dashboard shell.
    throwOnError: false,
    retry: false,
    queryFn: async ({ signal }): Promise<Claim> => {
      const headers = await withAuthHeaders();
      const result = (await client.GET('/v1/claims/{id}', {
        params: { path: { id } },
        headers,
        signal,
      })) as { data?: Claim; error?: ApiErrorBody };
      if (result.error) throw new Error(result.error.message ?? 'Failed to load claim.');
      if (!result.data) throw new Error('Empty response from /v1/claims/:id.');
      return result.data;
    },
  });
}

export interface UpdateClaimStatusVars {
  readonly status: ClaimStatus;
}

export function useUpdateClaimStatus(
  id: string,
): UseMutationResult<Claim, Error, UpdateClaimStatusVars> {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ status }: UpdateClaimStatusVars): Promise<Claim> => {
      const headers = await withAuthHeaders();
      const result = (await client.PATCH('/v1/claims/{id}', {
        params: { path: { id } },
        body: { status },
        headers,
      })) as { data?: Claim; error?: ApiErrorBody };
      if (result.error) {
        const code = result.error.code;
        const friendly =
          code === 'INVALID_STATE_TRANSITION'
            ? (result.error.message ?? 'That status change is not allowed from the current state.')
            : (result.error.message ?? 'Failed to update claim status.');
        throw new Error(friendly);
      }
      if (!result.data) throw new Error('Empty response from PATCH /v1/claims/:id.');
      return result.data;
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(claimQueryKey(id), updated);
      await queryClient.invalidateQueries({ queryKey: ['claims', 'list'] });
    },
  });
}
