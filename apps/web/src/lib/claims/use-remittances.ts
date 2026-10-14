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

export type RemittanceList =
  paths['/v1/claims/{id}/remittances']['get']['responses'][200]['content']['application/json'];
export type RemittanceEvidence = RemittanceList['items'][number];
export type RemittancePreview =
  paths['/v1/claims/{claimId}/remittances/{id}/preview']['get']['responses'][200]['content']['application/json'];
export type RemittanceReview =
  paths['/v1/claims/{claimId}/remittances/{id}/review']['post']['requestBody']['content']['application/json'];
type RemittanceInput =
  paths['/v1/claims/{id}/remittances']['post']['requestBody']['content']['application/json'];
export type RemittanceScope = readonly [claimId: string, userId: string, orgId: string | null];
export type RemittanceResult<T> =
  | { kind: 'OK'; data: T }
  | { kind: 'STALE' | 'INVALID' | 'DENIED' | 'UNCERTAIN' | 'INACTIVE' };
export interface ReviewCommand {
  readonly evidenceId: string;
  readonly body: RemittanceReview;
}

function failure(status: number): RemittanceResult<never> {
  if (status === 409) return { kind: 'STALE' };
  if (status === 400 || status === 413 || status === 422) return { kind: 'INVALID' };
  if (status === 401 || status === 403 || status === 404) return { kind: 'DENIED' };
  return { kind: 'UNCERTAIN' };
}

export function useRemittances(scope: RemittanceScope): {
  query: UseInfiniteQueryResult<InfiniteData<RemittanceList>>;
  preview: (evidenceId: string) => Promise<RemittanceResult<RemittancePreview>>;
  importEvidence: (body: unknown) => Promise<RemittanceResult<RemittanceEvidence>>;
  review: (command: ReviewCommand) => Promise<RemittanceResult<RemittanceEvidence>>;
  refresh: () => Promise<void>;
  isActive: () => boolean;
} {
  const [claimId] = scope;
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const active = useRef(true);
  const queryKey = ['remittances', ...scope];
  const isActive = (): boolean => active.current;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<RemittanceList> => {
      const headers = await withAuthHeaders();
      if (!isActive() || signal.aborted) throw new Error('Remittance view changed.');
      const result = await client.GET('/v1/claims/{id}/remittances', {
        params: {
          path: { id: claimId },
          query: { limit: 25, ...(pageParam ? { cursor: pageParam } : {}) },
        },
        headers,
        signal,
      });
      if (!isActive() || !result.response.ok || !result.data)
        throw new Error('Remittance evidence could not be loaded. Try again.');
      return result.data;
    },
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    retry: false,
    throwOnError: false,
  });
  const refresh = async (): Promise<void> => {
    // The scope is captured by the initiating render, including after unmount.
    await queryClient.invalidateQueries({ queryKey });
  };
  const preview = async (evidenceId: string): Promise<RemittanceResult<RemittancePreview>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.GET('/v1/claims/{claimId}/remittances/{id}/preview', {
        params: { path: { claimId, id: evidenceId } },
        headers,
      });
      if (!isActive()) return { kind: 'INACTIVE' };
      if (!result.response.ok) return failure(result.response.status);
      return result.data ? { kind: 'OK', data: result.data } : { kind: 'UNCERTAIN' };
    } catch {
      return { kind: isActive() ? 'UNCERTAIN' : 'INACTIVE' };
    }
  };
  const importEvidence = async (body: unknown): Promise<RemittanceResult<RemittanceEvidence>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      // The server validates the complete custom JSON contract before persistence.
      const result = await client.POST('/v1/claims/{id}/remittances', {
        params: { path: { id: claimId } },
        headers,
        body: body as RemittanceInput,
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
  const review = async (command: ReviewCommand): Promise<RemittanceResult<RemittanceEvidence>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/claims/{claimId}/remittances/{id}/review', {
        params: { path: { claimId, id: command.evidenceId } },
        headers,
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
  return { query, preview, importEvidence, review, refresh, isActive };
}

export async function readRemittanceFile(file: File): Promise<unknown> {
  if (file.size === 0 || file.size > 1024 * 1024)
    throw new Error('Choose one nonempty JSON file up to 1 MiB.');
  if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json')
    throw new Error('Choose a custom remittance JSON file.');
  try {
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !('schemaVersion' in parsed) ||
      parsed.schemaVersion !== 1
    )
      throw new Error('invalid');
    return parsed;
  } catch {
    throw new Error(
      'This file is not a valid version 1 remittance JSON object. Check the export and choose it again.',
    );
  }
}
