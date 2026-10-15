'use client';

import { useAuth } from '@clerk/nextjs';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import type { Claim, ClaimStatus, DetailClaim } from './types.js';

const claimQueryKey = (
  id: string,
  organizationId: string | null | undefined,
  userId: string | null | undefined,
): readonly unknown[] => ['claims', 'detail', id, organizationId ?? null, userId ?? null];

interface ApiErrorBody {
  message?: string;
  code?: string;
}

export function useClaim(id: string): UseQueryResult<DetailClaim> {
  const { orgId, userId, isLoaded } = useAuth();
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: claimQueryKey(id, orgId, userId),
    enabled: isLoaded && Boolean(userId),
    // Render the error inline (the page surface owns the empty-state),
    // not via the global ErrorBoundary — a single missing claim
    // shouldn't tear down the dashboard shell.
    throwOnError: false,
    retry: false,
    queryFn: async ({ signal }): Promise<DetailClaim> => {
      const headers = await withAuthHeaders();
      const result = (await client.GET('/v1/claims/{id}', {
        params: { path: { id } },
        headers,
        signal,
      })) as { data?: DetailClaim; error?: ApiErrorBody };
      if (result.error) throw new Error(result.error.message ?? 'Failed to load claim.');
      if (!result.data) throw new Error('Empty response from /v1/claims/:id.');
      return result.data;
    },
  });
}

export interface UpdateClaimStatusVars {
  readonly status: ClaimStatus;
}
interface UpdateClaimStatusContext {
  readonly detailKey: readonly unknown[];
}

export function useUpdateClaimStatus(
  id: string,
): UseMutationResult<Claim, Error, UpdateClaimStatusVars, UpdateClaimStatusContext> {
  const { orgId, userId } = useAuth();
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  return useMutation({
    onMutate: () => ({ detailKey: claimQueryKey(id, orgId, userId) }),
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
    onSuccess: async (updated, _variables, context) => {
      queryClient.setQueryData<DetailClaim>(context.detailKey, (previous) =>
        previous ? { ...previous, ...updated, sourceDetails: previous.sourceDetails } : undefined,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: context.detailKey }),
        queryClient.invalidateQueries({ queryKey: ['claims', 'list'] }),
      ]);
    },
  });
}
