'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import type { EnqueueCallResponse } from './types.js';

/**
 * Mutation hook for `POST /v1/claims/:id/calls` (P3-T16).
 *
 * Why this lives in the SDK consumer and not in `claims/use-claim.ts`:
 * the call-enqueue endpoint is hung off the claim resource but the
 * TanStack cache it invalidates is the *claims* list+detail (the
 * Claim's status flips to `IN_QUEUE` server-side). Keeping the call
 * mutations under `lib/calls/` makes T22's surface area small and
 * keeps the claim hooks untouched.
 *
 * On success we patch the cached claim detail to `IN_QUEUE` and
 * invalidate the list so the row re-renders with the live status
 * indicator.
 */
export interface EnqueueCallVars {
  readonly claimId: string;
}

interface ApiErrorBody {
  message?: string;
  code?: string;
}

/**
 * Server returns 202 with the queued call session id; we treat its
 * arrival as the moment to flip the cached claim status optimistically.
 */
const IN_QUEUE_PATCH = { status: 'IN_QUEUE' as const };

export function useEnqueueCall(): UseMutationResult<EnqueueCallResponse, Error, EnqueueCallVars> {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ claimId }: EnqueueCallVars): Promise<EnqueueCallResponse> => {
      const headers = await withAuthHeaders();
      const result = (await client.POST('/v1/claims/{id}/calls', {
        params: { path: { id: claimId } },
        headers,
        // Body is optional server-side (`priorityOverride?`) but the SDK
        // marks it required because Zod doesn't emit `nullable` properties
        // for optional shapes. Explicit empty object keeps both happy.
        body: {},
      })) as { data?: EnqueueCallResponse; error?: ApiErrorBody };
      if (result.error) {
        const code = result.error.code;
        const friendly =
          code === 'PAYER_HOURS_CLOSED'
            ? (result.error.message ??
              'Payer line is closed right now. Try again during business hours.')
            : code === 'UNSUPPORTED_PAYER'
              ? (result.error.message ?? 'This payer is not yet supported by the call worker.')
              : code === 'INVALID_STATE_TRANSITION'
                ? (result.error.message ?? 'This claim cannot be queued from its current status.')
                : (result.error.message ?? 'Failed to queue the call.');
        const err = new Error(friendly);
        if (code) (err as Error & { code?: string }).code = code;
        throw err;
      }
      if (!result.data) throw new Error('Empty response from POST /v1/claims/:id/calls.');
      return result.data;
    },
    onSuccess: async (_response, vars) => {
      const detailKey = ['claims', 'detail', vars.claimId] as const;
      queryClient.setQueryData<{ status: 'IN_QUEUE' } & Record<string, unknown>>(
        detailKey,
        (existing) => (existing ? { ...existing, ...IN_QUEUE_PATCH } : existing),
      );
      await queryClient.invalidateQueries({ queryKey: ['claims', 'list'] });
    },
  });
}
