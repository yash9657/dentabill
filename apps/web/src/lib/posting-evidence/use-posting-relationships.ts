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

import type { PostingScope, PostingResult } from './use-posting-evidence.js';

export type RelationshipList =
  paths['/v1/posting-relationships']['get']['responses'][200]['content']['application/json'];
export type PostingRelationship = RelationshipList['items'][number];
export type RelationshipTargets =
  paths['/v1/posting-evidence/{id}/relationship-targets']['get']['responses'][200]['content']['application/json'];
export type RelationshipTarget = RelationshipTargets['items'][number];
export type RelationshipCandidate =
  paths['/v1/posting-relationships/preview']['post']['requestBody']['content']['application/json'];
export type RelationshipPreview =
  paths['/v1/posting-relationships/preview']['post']['responses'][200]['content']['application/json'];
export type RelationshipDecision =
  paths['/v1/posting-relationships']['post']['requestBody']['content']['application/json'];
export type RelationshipReceipt =
  paths['/v1/posting-relationships']['post']['responses'][201]['content']['application/json'];
export type RelationshipReleasePreview =
  paths['/v1/posting-relationships/{id}/release/preview']['post']['responses'][200]['content']['application/json'];
export type RelationshipReleaseCandidate =
  paths['/v1/posting-relationships/{id}/release/preview']['post']['requestBody']['content']['application/json'];
export type RelationshipReleaseDecision =
  paths['/v1/posting-relationships/{id}/release']['post']['requestBody']['content']['application/json'];
export type RelationshipReleaseReceipt =
  paths['/v1/posting-relationships/{id}/release']['post']['responses'][201]['content']['application/json'];
export interface RelationshipReleaseCommand {
  readonly relationshipId: string;
  readonly body: RelationshipReleaseDecision;
}

function failure(status: number): PostingResult<never> {
  if (status === 409) return { kind: 'STALE' };
  if ([400, 413, 422].includes(status)) return { kind: 'INVALID' };
  if ([401, 403, 404].includes(status)) return { kind: 'DENIED' };
  return { kind: 'UNCERTAIN' };
}

export function usePostingRelationships(scope: PostingScope): {
  list: UseInfiniteQueryResult<InfiniteData<RelationshipList>>;
  targets: (id: string) => Promise<PostingResult<RelationshipTargets>>;
  preview: (body: RelationshipCandidate) => Promise<PostingResult<RelationshipPreview>>;
  create: (body: RelationshipDecision) => Promise<PostingResult<RelationshipReceipt>>;
  previewRelease: (
    id: string,
    body: RelationshipReleaseCandidate,
  ) => Promise<PostingResult<RelationshipReleasePreview>>;
  release: (
    command: RelationshipReleaseCommand,
  ) => Promise<PostingResult<RelationshipReleaseReceipt>>;
  refresh: () => Promise<void>;
  isActive: () => boolean;
} {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const active = useRef(true);
  const isActive = (): boolean => active.current;
  const scopeKey = ['posting-relationships', ...scope];
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const list = useInfiniteQuery({
    queryKey: [...scopeKey, 'list'],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<RelationshipList> => {
      const isCancelled = (): boolean => !isActive() || signal.aborted;
      const headers = await withAuthHeaders();
      if (isCancelled()) throw new Error('Association view changed.');
      const result = await client.GET('/v1/posting-relationships', {
        headers,
        signal,
        params: { query: { limit: 10, ...(pageParam ? { cursor: pageParam } : {}) } },
      });
      if (isCancelled() || !result.response.ok || !result.data)
        throw new Error('Claim associations could not be loaded.');
      return result.data;
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    retry: false,
    throwOnError: false,
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: scopeKey });
  };
  const targets = async (id: string): Promise<PostingResult<RelationshipTargets>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.GET('/v1/posting-evidence/{id}/relationship-targets', {
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
  const preview = async (
    body: RelationshipCandidate,
  ): Promise<PostingResult<RelationshipPreview>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/posting-relationships/preview', { headers, body });
      if (!isActive()) return { kind: 'INACTIVE' };
      if (!result.response.ok) return failure(result.response.status);
      return result.data ? { kind: 'OK', data: result.data } : { kind: 'UNCERTAIN' };
    } catch {
      return { kind: isActive() ? 'UNCERTAIN' : 'INACTIVE' };
    }
  };
  const create = async (
    body: RelationshipDecision,
  ): Promise<PostingResult<RelationshipReceipt>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/posting-relationships', { headers, body });
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
    body: RelationshipReleaseCandidate,
  ): Promise<PostingResult<RelationshipReleasePreview>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/posting-relationships/{id}/release/preview', {
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
  const release = async (
    command: RelationshipReleaseCommand,
  ): Promise<PostingResult<RelationshipReleaseReceipt>> => {
    try {
      const headers = await withAuthHeaders();
      if (!isActive()) return { kind: 'INACTIVE' };
      const result = await client.POST('/v1/posting-relationships/{id}/release', {
        headers,
        params: { path: { id: command.relationshipId } },
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
  return { list, targets, preview, create, previewRelease, release, refresh, isActive };
}
