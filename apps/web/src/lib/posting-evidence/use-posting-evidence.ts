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

export type PostingList =
  paths['/v1/posting-evidence']['get']['responses'][200]['content']['application/json'];
export type PostingReceipt = PostingList['items'][number];
export type PostingEvidence = PostingReceipt['latestEvidence'];
export type PostingHistory =
  paths['/v1/posting-evidence/receipts/{id}']['get']['responses'][200]['content']['application/json'];
export type PostingPreview =
  paths['/v1/posting-evidence/{id}/preview']['get']['responses'][200]['content']['application/json'];
export type PostingInput =
  paths['/v1/posting-evidence']['post']['requestBody']['content']['application/json'];
export type PostingReview =
  paths['/v1/posting-evidence/{id}/review']['post']['requestBody']['content']['application/json'];
export type PostingScope = readonly [userId: string, orgId: string | null];
export type PostingResult<T> =
  | { kind: 'OK'; data: T }
  | { kind: 'STALE' | 'INVALID' | 'DENIED' | 'UNCERTAIN' | 'INACTIVE' };
export interface PostingReviewCommand {
  readonly evidenceId: string;
  readonly body: PostingReview;
}

function failure(status: number): PostingResult<never> {
  if (status === 409) return { kind: 'STALE' };
  if ([400, 413, 422].includes(status)) return { kind: 'INVALID' };
  if ([401, 403, 404].includes(status)) return { kind: 'DENIED' };
  return { kind: 'UNCERTAIN' };
}

export function usePostingEvidence(
  scope: PostingScope,
  receiptId: string | null,
): {
  list: UseInfiniteQueryResult<InfiniteData<PostingList>>;
  history: UseInfiniteQueryResult<InfiniteData<PostingHistory>>;
  preview: (id: string) => Promise<PostingResult<PostingPreview>>;
  importEvidence: (body: unknown) => Promise<PostingResult<PostingEvidence>>;
  review: (command: PostingReviewCommand) => Promise<PostingResult<PostingEvidence>>;
  refresh: () => Promise<void>;
  isActive: () => boolean;
} {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const active = useRef(true);
  const isActive = (): boolean => active.current;
  const scopeKey = ['posting-evidence', ...scope];
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const list = useInfiniteQuery({
    queryKey: [...scopeKey, 'list'],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<PostingList> => {
      const isCancelled = (): boolean => !isActive() || signal.aborted;
      const headers = await withAuthHeaders();
      if (isCancelled()) throw new Error('Posting evidence view changed.');
      const result = await client.GET('/v1/posting-evidence', {
        headers,
        signal,
        params: { query: { limit: 10, ...(pageParam ? { cursor: pageParam } : {}) } },
      });
      if (isCancelled() || !result.response.ok || !result.data)
        throw new Error('Posting evidence could not be loaded.');
      return result.data;
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    retry: false,
    throwOnError: false,
  });
  const history = useInfiniteQuery({
    queryKey: [...scopeKey, 'history', receiptId],
    enabled: receiptId !== null,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<PostingHistory> => {
      const isCancelled = (): boolean => !isActive() || signal.aborted;
      const headers = await withAuthHeaders();
      if (!receiptId || isCancelled()) throw new Error('Posting evidence view changed.');
      const result = await client.GET('/v1/posting-evidence/receipts/{id}', {
        headers,
        signal,
        params: {
          path: { id: receiptId },
          query: { limit: 10, ...(pageParam ? { cursor: pageParam } : {}) },
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
  const preview = async (id: string): Promise<PostingResult<PostingPreview>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.GET('/v1/posting-evidence/{id}/preview', {
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
  const importEvidence = async (body: unknown): Promise<PostingResult<PostingEvidence>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      // The server validates the full source, sign and status contract before persistence.
      const result = await client.POST('/v1/posting-evidence', {
        headers,
        body: body as PostingInput,
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
  const review = async (command: PostingReviewCommand): Promise<PostingResult<PostingEvidence>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/posting-evidence/{id}/review', {
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

export async function readPostingFile(file: File): Promise<unknown> {
  if (!file.size || file.size > 256 * 1024)
    throw new Error('Choose one nonempty JSON file up to 256 KiB.');
  if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json')
    throw new Error('Choose a custom PMS payment receipt JSON file.');
  try {
    const body: unknown = JSON.parse(await file.text());
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !('schemaVersion' in body) ||
      body.schemaVersion !== 1 ||
      !('evidenceBasis' in body) ||
      body.evidenceBasis !== 'PMS_PAYMENT_RECEIPT'
    )
      throw new Error('invalid');
    return body;
  } catch {
    throw new Error(
      'This is not a valid version 1 PMS payment receipt JSON object. Check the export and choose it again.',
    );
  }
}
