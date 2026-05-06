'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import * as React from 'react';

import { useDentaBillApi } from '../api-client.js';

export interface MeOrganization {
  readonly id: string;
  readonly name: string;
  readonly npi: string | null;
  readonly plan: 'TRIAL' | 'STARTER' | 'PRO' | 'ENTERPRISE';
}

export interface MeUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: 'OWNER' | 'ADMIN' | 'BILLING_STAFF';
}

export interface MeResponse {
  readonly user: MeUser;
  readonly organization: MeOrganization;
}

interface ApiErrorBody {
  message?: string;
  code?: string;
}

const ME_QUERY_KEY = ['me'] as const;

export function useMe(): UseQueryResult<MeResponse> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async (): Promise<MeResponse> => {
      const headers = await withAuthHeaders();
      const result = (await client.GET('/v1/me', { headers })) as {
        data?: MeResponse;
        error?: ApiErrorBody;
      };
      if (result.error) {
        const err = new Error(result.error.message ?? 'Failed to load profile.');
        if (result.error.code) (err as Error & { code?: string }).code = result.error.code;
        throw err;
      }
      if (!result.data) throw new Error('Empty response from GET /v1/me.');
      return result.data;
    },
    staleTime: 60_000,
  });
}

export interface UpdateOrganizationVars {
  readonly name?: string;
  readonly npi?: string;
}

export function useUpdateOrganization(): UseMutationResult<
  MeOrganization,
  Error,
  UpdateOrganizationVars
> {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: UpdateOrganizationVars): Promise<MeOrganization> => {
      const headers = await withAuthHeaders();
      const result = (await client.PATCH('/v1/me/organization', {
        headers,
        body: vars,
      })) as { data?: MeOrganization; error?: ApiErrorBody };
      if (result.error) {
        const err = new Error(result.error.message ?? 'Failed to update organization.');
        if (result.error.code) (err as Error & { code?: string }).code = result.error.code;
        throw err;
      }
      if (!result.data) throw new Error('Empty response from PATCH /v1/me/organization.');
      return result.data;
    },
    onSuccess: (organization) => {
      queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, (existing) =>
        existing ? { ...existing, organization } : existing,
      );
    },
  });
}

const NPI_PATTERN = /^\d{10}$/;

export function isValidNpi(value: string): boolean {
  return value === '' || NPI_PATTERN.test(value);
}

export function useMissingNpi(): { readonly isMissing: boolean; readonly isLoading: boolean } {
  const me = useMe();
  return React.useMemo(
    () => ({
      isLoading: me.isPending,
      isMissing: Boolean(
        me.data && (me.data.organization.npi === null || me.data.organization.npi === ''),
      ),
    }),
    [me.data, me.isPending],
  );
}
