'use client';

import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

export interface BillingUsageItem {
  readonly id: string;
  readonly claimId: string;
  readonly billingPeriodStart: string;
  readonly amountCents: number;
  readonly stripeUsageRecordId: string | null;
  readonly postedAt: string | null;
  readonly createdAt: string;
}

export interface BillingUsageResponse {
  readonly currentMonthCents: number;
  readonly last90DaysCents: number;
  readonly items: readonly BillingUsageItem[];
}

interface ApiErrorBody {
  message?: string;
  code?: string;
}

const BILLING_USAGE_QUERY_KEY = ['billing', 'usage'] as const;

export function useBillingUsage(): UseQueryResult<BillingUsageResponse> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: BILLING_USAGE_QUERY_KEY,
    queryFn: async (): Promise<BillingUsageResponse> => {
      const headers = await withAuthHeaders();
      const result = (await client.GET('/v1/billing/usage', { headers })) as {
        data?: BillingUsageResponse;
        error?: ApiErrorBody;
      };
      if (result.error) {
        const err = new Error(result.error.message ?? 'Failed to load billing usage.');
        if (result.error.code) (err as Error & { code?: string }).code = result.error.code;
        throw err;
      }
      if (!result.data) throw new Error('Empty response from GET /v1/billing/usage.');
      return result.data;
    },
    staleTime: 60_000,
  });
}

export interface BillingPortalResponse {
  readonly url: string;
}

export function useOpenBillingPortal(): UseMutationResult<BillingPortalResponse, Error, void> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useMutation({
    mutationFn: async (): Promise<BillingPortalResponse> => {
      const headers = await withAuthHeaders();
      const result = (await client.POST('/v1/billing/portal', { headers })) as {
        data?: BillingPortalResponse;
        error?: ApiErrorBody;
      };
      if (result.error) {
        const err = new Error(result.error.message ?? 'Failed to open billing portal.');
        if (result.error.code) (err as Error & { code?: string }).code = result.error.code;
        throw err;
      }
      if (!result.data) throw new Error('Empty response from POST /v1/billing/portal.');
      return result.data;
    },
  });
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
