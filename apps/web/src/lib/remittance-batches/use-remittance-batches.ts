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

export type BatchList =
  paths['/v1/remittance-batches']['get']['responses'][200]['content']['application/json'];
export type BatchEvidence = BatchList['items'][number];
export type BatchPreview =
  paths['/v1/remittance-batches/{id}/preview']['get']['responses'][200]['content']['application/json'];
export type BatchInput =
  paths['/v1/remittance-batches']['post']['requestBody']['content']['application/json'];
export type BatchReview =
  paths['/v1/remittance-batches/{id}/review']['post']['requestBody']['content']['application/json'];
export type BatchScope = readonly [userId: string, orgId: string | null];
export type BatchResult<T> =
  | { kind: 'OK'; data: T }
  | { kind: 'STALE' | 'INVALID' | 'DENIED' | 'UNCERTAIN' | 'INACTIVE' };
export interface BatchReviewCommand {
  readonly evidenceId: string;
  readonly body: BatchReview;
}

function failure(status: number): BatchResult<never> {
  if (status === 409) return { kind: 'STALE' };
  if ([400, 413, 422].includes(status)) return { kind: 'INVALID' };
  if ([401, 403, 404].includes(status)) return { kind: 'DENIED' };
  return { kind: 'UNCERTAIN' };
}

export function useRemittanceBatches(scope: BatchScope): {
  list: UseInfiniteQueryResult<InfiniteData<BatchList>>;
  preview: (id: string) => Promise<BatchResult<BatchPreview>>;
  importEvidence: (body: unknown) => Promise<BatchResult<BatchEvidence>>;
  review: (command: BatchReviewCommand) => Promise<BatchResult<BatchEvidence>>;
  refresh: () => Promise<void>;
  isActive: () => boolean;
} {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const active = useRef(true);
  const isActive = (): boolean => active.current;
  const scopeKey = ['remittance-batches', ...scope];
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const list = useInfiniteQuery({
    queryKey: [...scopeKey, 'list'],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<BatchList> => {
      const isCancelled = (): boolean => !isActive() || signal.aborted;
      const headers = await withAuthHeaders();
      if (isCancelled()) throw new Error('Batch view changed.');
      const result = await client.GET('/v1/remittance-batches', {
        headers,
        signal,
        params: { query: { limit: 10, ...(pageParam ? { cursor: pageParam } : {}) } },
      });
      if (isCancelled() || !result.response.ok || !result.data)
        throw new Error('Batch evidence could not be loaded.');
      return result.data;
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    retry: false,
    throwOnError: false,
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: scopeKey });
  };
  const preview = async (id: string): Promise<BatchResult<BatchPreview>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.GET('/v1/remittance-batches/{id}/preview', {
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
  const importEvidence = async (body: unknown): Promise<BatchResult<BatchEvidence>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      // The server validates the full source, sign and status contract before persistence.
      const result = await client.POST('/v1/remittance-batches', {
        headers,
        body: body as BatchInput,
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
  const review = async (command: BatchReviewCommand): Promise<BatchResult<BatchEvidence>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/remittance-batches/{id}/review', {
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
  return { list, preview, importEvidence, review, refresh, isActive };
}

export async function readBatchFile(file: File): Promise<unknown> {
  if (!file.size || file.size > 256 * 1024)
    throw new Error('Choose one nonempty JSON file up to 256 KiB.');
  if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json')
    throw new Error('Choose a custom remittance batch JSON file.');
  try {
    const body: unknown = JSON.parse(await file.text());
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !('schemaVersion' in body) ||
      body.schemaVersion !== 1 ||
      !('evidenceBasis' in body) ||
      body.evidenceBasis !== 'PAYER_REMITTANCE_BATCH'
    )
      throw new Error('invalid');
    return body;
  } catch {
    throw new Error(
      'This is not a valid version 1 payer remittance batch JSON object. Check the export and choose it again.',
    );
  }
}
