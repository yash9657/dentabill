'use client';

import type { paths } from '@dentabill/api-sdk/types';
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import { operationsKey } from './use-operations.js';

export type OperationsScope = readonly [userId: string, orgId: string | null];
export type NotificationList =
  paths['/v1/operations/notifications']['get']['responses'][200]['content']['application/json'];
export type NotificationRow = NotificationList['items'][number];
export type NotificationDetail =
  paths['/v1/operations/notifications/{id}']['get']['responses'][200]['content']['application/json'];
export type NotificationState = NotificationRow['state'] | 'ALL';
type OperationsProfile = paths['/v1/me']['get']['responses'][200]['content']['application/json'];

export const notificationKey = (
  organizationId: string,
  scope: OperationsScope,
): readonly (string | null)[] =>
  [...operationsKey(organizationId), 'notifications', ...scope] as const;

function readData<T>(result: { data?: T; response?: { ok: boolean } }, message: string): T {
  if (result.response?.ok === false || !result.data) throw new Error(message);
  return result.data;
}

export function useOperationsAccess(scope: OperationsScope): UseQueryResult<OperationsProfile> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: ['operations-access', ...scope],
    queryFn: async ({ signal }): Promise<OperationsProfile> => {
      const cancelled = (): boolean => signal.aborted;
      const headers = await withAuthHeaders().catch(() => {
        throw new Error('Operations access could not be confirmed. Refresh the page to try again.');
      });
      if (cancelled()) throw new Error('Operations access changed.');
      const result = await client.GET('/v1/me', { headers, signal }).catch(() => {
        throw new Error('Couldn’t confirm your access. Refresh the page to try again.');
      });
      if (cancelled()) throw new Error('Operations access changed.');
      return readData(result, 'Couldn’t confirm your access. Refresh the page to try again.');
    },
    retry: false,
    throwOnError: false,
    staleTime: 0,
  });
}

export function useOperationNotifications(
  organizationId: string,
  scope: OperationsScope,
  state: NotificationState,
): UseInfiniteQueryResult<InfiniteData<NotificationList>> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useInfiniteQuery({
    queryKey: [...notificationKey(organizationId, scope), 'list', state],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<NotificationList> => {
      const cancelled = (): boolean => signal.aborted;
      const headers = await withAuthHeaders().catch(() => {
        throw new Error('Operations access could not be confirmed. Refresh the page to try again.');
      });
      if (cancelled()) throw new Error('Notification view changed.');
      const result = await client
        .GET('/v1/operations/notifications', {
          headers,
          signal,
          params: { query: { state, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
        })
        .catch(() => {
          throw new Error('Review notifications could not be loaded. Refresh work to try again.');
        });
      if (cancelled()) throw new Error('Notification view changed.');
      return readData(
        result,
        'Review notifications could not be loaded. Refresh work to try again.',
      );
    },
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
    retry: false,
    throwOnError: false,
  });
}

export function useOperationNotificationDetail(
  organizationId: string,
  scope: OperationsScope,
  id: string,
): UseQueryResult<NotificationDetail> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: [...notificationKey(organizationId, scope), 'detail', id],
    queryFn: async ({ signal }): Promise<NotificationDetail> => {
      const cancelled = (): boolean => signal.aborted;
      const headers = await withAuthHeaders().catch(() => {
        throw new Error('Operations access could not be confirmed. Refresh the page to try again.');
      });
      if (cancelled()) throw new Error('Notification view changed.');
      const result = await client
        .GET('/v1/operations/notifications/{id}', {
          headers,
          signal,
          params: { path: { id } },
        })
        .catch(() => {
          throw new Error('Notification history could not be loaded. Refresh work to try again.');
        });
      if (cancelled()) throw new Error('Notification view changed.');
      return readData(
        result,
        'Notification history could not be loaded. Refresh work to try again.',
      );
    },
    retry: false,
    throwOnError: false,
    staleTime: 0,
  });
}
