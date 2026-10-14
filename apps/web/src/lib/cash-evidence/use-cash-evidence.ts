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

export type CashList =
  paths['/v1/cash-evidence']['get']['responses'][200]['content']['application/json'];
export type CashTransaction = CashList['items'][number];
export type CashEvidence = CashTransaction['latestEvidence'];
export type CashHistory =
  paths['/v1/cash-evidence/transactions/{id}']['get']['responses'][200]['content']['application/json'];
export type CashPreview =
  paths['/v1/cash-evidence/{id}/preview']['get']['responses'][200]['content']['application/json'];
export type CashInput =
  paths['/v1/cash-evidence']['post']['requestBody']['content']['application/json'];
export type CashReview =
  paths['/v1/cash-evidence/{id}/review']['post']['requestBody']['content']['application/json'];
export type CashScope = readonly [userId: string, orgId: string | null];
export type CashResult<T> =
  | { kind: 'OK'; data: T }
  | { kind: 'STALE' | 'INVALID' | 'DENIED' | 'UNCERTAIN' | 'INACTIVE' };
export interface CashReviewCommand {
  readonly evidenceId: string;
  readonly body: CashReview;
}

function failure(status: number): CashResult<never> {
  if (status === 409) return { kind: 'STALE' };
  if ([400, 413, 422].includes(status)) return { kind: 'INVALID' };
  if ([401, 403, 404].includes(status)) return { kind: 'DENIED' };
  return { kind: 'UNCERTAIN' };
}

export function useCashEvidence(
  scope: CashScope,
  transactionId: string | null,
): {
  list: UseInfiniteQueryResult<InfiniteData<CashList>>;
  history: UseInfiniteQueryResult<InfiniteData<CashHistory>>;
  preview: (id: string) => Promise<CashResult<CashPreview>>;
  importEvidence: (body: unknown) => Promise<CashResult<CashEvidence>>;
  review: (command: CashReviewCommand) => Promise<CashResult<CashEvidence>>;
  refresh: () => Promise<void>;
  isActive: () => boolean;
} {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const active = useRef(true);
  const isActive = (): boolean => active.current;
  const scopeKey = ['cash-evidence', ...scope];
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const list = useInfiniteQuery({
    queryKey: [...scopeKey, 'list'],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<CashList> => {
      const isCancelled = (): boolean => !isActive() || signal.aborted;
      const headers = await withAuthHeaders();
      if (isCancelled()) throw new Error('Cash evidence view changed.');
      const result = await client.GET('/v1/cash-evidence', {
        headers,
        signal,
        params: { query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
      });
      if (isCancelled() || !result.response.ok || !result.data)
        throw new Error('Cash evidence could not be loaded.');
      return result.data;
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    retry: false,
    throwOnError: false,
  });
  const history = useInfiniteQuery({
    queryKey: [...scopeKey, 'history', transactionId],
    enabled: transactionId !== null,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<CashHistory> => {
      const isCancelled = (): boolean => !isActive() || signal.aborted;
      const headers = await withAuthHeaders();
      if (!transactionId || isCancelled()) throw new Error('Cash evidence view changed.');
      const result = await client.GET('/v1/cash-evidence/transactions/{id}', {
        headers,
        signal,
        params: {
          path: { id: transactionId },
          query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
        },
      });
      if (isCancelled() || !result.response.ok || !result.data)
        throw new Error('Source revision history could not be loaded.');
      return result.data;
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    retry: false,
    throwOnError: false,
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: scopeKey });
  };
  const preview = async (id: string): Promise<CashResult<CashPreview>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.GET('/v1/cash-evidence/{id}/preview', {
        headers,
        params: { path: { id } },
      });
      if (!isActive()) return { kind: 'INACTIVE' };
      if (!result.response.ok) return failure(result.response.status);
      return result.data ? { kind: 'OK', data: result.data } : { kind: 'UNCERTAIN' };
    } catch {
      return { kind: isActive() ? 'UNCERTAIN' : 'INACTIVE' };
    }
  };
  const importEvidence = async (body: unknown): Promise<CashResult<CashEvidence>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      // The server validates the full source, sign and status contract before persistence.
      const result = await client.POST('/v1/cash-evidence', { headers, body: body as CashInput });
      if (!isActive()) return { kind: 'INACTIVE' };
      if (!result.response.ok) return failure(result.response.status);
      if (!result.data) return { kind: 'UNCERTAIN' };
      void refresh();
      return { kind: 'OK', data: result.data };
    } catch {
      return { kind: isActive() ? 'UNCERTAIN' : 'INACTIVE' };
    }
  };
  const review = async (command: CashReviewCommand): Promise<CashResult<CashEvidence>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/cash-evidence/{id}/review', {
        headers,
        params: { path: { id: command.evidenceId } },
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
  return { list, history, preview, importEvidence, review, refresh, isActive };
}

export async function readCashFile(file: File): Promise<unknown> {
  if (!file.size || file.size > 64 * 1024)
    throw new Error('Choose one nonempty JSON file up to 64 KiB.');
  if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json')
    throw new Error('Choose a custom bank-account JSON file.');
  try {
    const body: unknown = JSON.parse(await file.text());
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !('schemaVersion' in body) ||
      body.schemaVersion !== 1 ||
      !('evidenceBasis' in body) ||
      body.evidenceBasis !== 'BANK_ACCOUNT_TRANSACTION'
    )
      throw new Error('invalid');
    return body;
  } catch {
    throw new Error(
      'This is not a valid version 1 bank-account transaction JSON object. Check the export and choose it again.',
    );
  }
}
