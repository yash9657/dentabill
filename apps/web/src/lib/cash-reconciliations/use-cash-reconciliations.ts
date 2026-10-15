'use client';

import type { paths } from '@dentabill/api-sdk/types';
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useDentaBillApi } from '../api-client.js';
import type { CashList } from '../cash-evidence/use-cash-evidence.js';
import type { BatchList } from '../remittance-batches/use-remittance-batches.js';

export type MatchList =
  paths['/v1/cash-reconciliations']['get']['responses'][200]['content']['application/json'];
export type CashMatch = MatchList['items'][number];
export type MatchCandidate =
  paths['/v1/cash-reconciliations/preview']['post']['requestBody']['content']['application/json'];
export type MatchPreview =
  paths['/v1/cash-reconciliations/preview']['post']['responses'][200]['content']['application/json'];
export type MatchDecision =
  paths['/v1/cash-reconciliations']['post']['requestBody']['content']['application/json'];
export type MatchReceipt =
  paths['/v1/cash-reconciliations']['post']['responses'][201]['content']['application/json'];
export type ReleasePreview =
  paths['/v1/cash-reconciliations/{id}/release/preview']['post']['responses'][200]['content']['application/json'];
export type ReleaseCandidate =
  paths['/v1/cash-reconciliations/{id}/release/preview']['post']['requestBody']['content']['application/json'];
export type ReleaseDecision =
  paths['/v1/cash-reconciliations/{id}/release']['post']['requestBody']['content']['application/json'];
export type ReleaseReceipt =
  paths['/v1/cash-reconciliations/{id}/release']['post']['responses'][201]['content']['application/json'];
export type ReconciliationScope = readonly [userId: string, orgId: string | null];
export type Result<T> =
  | { kind: 'OK'; data: T }
  | { kind: 'STALE' | 'INVALID' | 'DENIED' | 'UNCERTAIN' | 'INACTIVE' };
export interface ReleaseCommand {
  readonly matchId: string;
  readonly body: ReleaseDecision;
}

function failure(status: number): Result<never> {
  if (status === 409) return { kind: 'STALE' };
  if ([400, 413, 422].includes(status)) return { kind: 'INVALID' };
  if ([401, 403, 404].includes(status)) return { kind: 'DENIED' };
  return { kind: 'UNCERTAIN' };
}

export function useCashReconciliations(scope: ReconciliationScope): {
  cash: UseInfiniteQueryResult<InfiniteData<CashList>>;
  batches: UseInfiniteQueryResult<InfiniteData<BatchList>>;
  matches: UseInfiniteQueryResult<InfiniteData<MatchList>>;
  preview: (body: MatchCandidate) => Promise<Result<MatchPreview>>;
  match: (body: MatchDecision) => Promise<Result<MatchReceipt>>;
  previewRelease: (id: string, body: ReleaseCandidate) => Promise<Result<ReleasePreview>>;
  release: (command: ReleaseCommand) => Promise<Result<ReleaseReceipt>>;
  refresh: () => Promise<void>;
  isActive: () => boolean;
} {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const active = useRef(true);
  const isActive = (): boolean => active.current;
  const scopeKey = ['cash-reconciliations', ...scope];
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const cash = useInfiniteQuery({
    queryKey: [...scopeKey, 'cash-sources'],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<CashList> => {
      const isCancelled = (): boolean => !isActive() || signal.aborted;
      const headers = await withAuthHeaders();
      if (isCancelled()) throw new Error('Reconciliation view changed.');
      const result = await client.GET('/v1/cash-evidence', {
        headers,
        signal,
        params: { query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
      });
      if (isCancelled() || !result.response.ok || !result.data)
        throw new Error('Cash sources could not be loaded.');
      return result.data;
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    retry: false,
    throwOnError: false,
  });
  const batches = useInfiniteQuery({
    queryKey: [...scopeKey, 'batch-sources'],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<BatchList> => {
      const isCancelled = (): boolean => !isActive() || signal.aborted;
      const headers = await withAuthHeaders();
      if (isCancelled()) throw new Error('Reconciliation view changed.');
      const result = await client.GET('/v1/remittance-batches', {
        headers,
        signal,
        params: { query: { limit: 10, ...(pageParam ? { cursor: pageParam } : {}) } },
      });
      if (isCancelled() || !result.response.ok || !result.data)
        throw new Error('Batch sources could not be loaded.');
      return result.data;
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    retry: false,
    throwOnError: false,
  });
  const matches = useInfiniteQuery({
    queryKey: [...scopeKey, 'matches'],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<MatchList> => {
      const isCancelled = (): boolean => !isActive() || signal.aborted;
      const headers = await withAuthHeaders();
      if (isCancelled()) throw new Error('Reconciliation view changed.');
      const result = await client.GET('/v1/cash-reconciliations', {
        headers,
        signal,
        params: { query: { limit: 10, ...(pageParam ? { cursor: pageParam } : {}) } },
      });
      if (isCancelled() || !result.response.ok || !result.data)
        throw new Error('Reconciliations could not be loaded.');
      return result.data;
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    retry: false,
    throwOnError: false,
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: scopeKey });
  };
  const preview = async (body: MatchCandidate): Promise<Result<MatchPreview>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/cash-reconciliations/preview', { headers, body });
      if (!isActive()) return { kind: 'INACTIVE' };
      if (!result.response.ok) return failure(result.response.status);
      return result.data ? { kind: 'OK', data: result.data } : { kind: 'UNCERTAIN' };
    } catch {
      return { kind: isActive() ? 'UNCERTAIN' : 'INACTIVE' };
    }
  };
  const match = async (body: MatchDecision): Promise<Result<MatchReceipt>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/cash-reconciliations', { headers, body });
      if (!isActive()) return { kind: 'INACTIVE' };
      if (!result.response.ok) return failure(result.response.status);
      if (!result.data) return { kind: 'UNCERTAIN' };
      void refresh();
      return { kind: 'OK', data: result.data };
    } catch {
      return { kind: isActive() ? 'UNCERTAIN' : 'INACTIVE' };
    }
  };
  const previewRelease = async (
    id: string,
    body: ReleaseCandidate,
  ): Promise<Result<ReleasePreview>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/cash-reconciliations/{id}/release/preview', {
        headers,
        params: { path: { id } },
        body,
      });
      if (!isActive()) return { kind: 'INACTIVE' };
      if (!result.response.ok) return failure(result.response.status);
      return result.data ? { kind: 'OK', data: result.data } : { kind: 'UNCERTAIN' };
    } catch {
      return { kind: isActive() ? 'UNCERTAIN' : 'INACTIVE' };
    }
  };
  const release = async (command: ReleaseCommand): Promise<Result<ReleaseReceipt>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/cash-reconciliations/{id}/release', {
        headers,
        params: { path: { id: command.matchId } },
        body: command.body,
      });
      if (!isActive()) return { kind: 'INACTIVE' };
      if (!result.response.ok) return failure(result.response.status);
      if (!result.data) return { kind: 'UNCERTAIN' };
      void refresh();
      return { kind: 'OK', data: result.data };
    } catch {
      return { kind: isActive() ? 'UNCERTAIN' : 'INACTIVE' };
    }
  };
  return { cash, batches, matches, preview, match, previewRelease, release, refresh, isActive };
}

export function validMatchAmount(value: string): boolean {
  return /^-?(?:0|[1-9][0-9]{0,7})\.[0-9]{2}$/.test(value) && value !== '0.00' && value !== '-0.00';
}
