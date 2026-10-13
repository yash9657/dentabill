'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

import type {
  DeliveryList,
  DeliveryState,
  OperationsCallKind,
  OperationsCallList,
  OperationsOverview,
  RecoveryAction,
  RecoveryPreview,
} from './types.js';

interface ApiResult<T> {
  data?: T;
  error?: { code?: string };
  response?: { status: number };
}
function dataOrThrow<T>(result: ApiResult<T>): T {
  if (result.error || !result.data) {
    if (result.response?.status === 403)
      throw new Error('Operations is available to practice owners and admins.');
    if (result.response?.status === 409)
      throw new Error(
        'This delivery changed. Review the refreshed details before approving again.',
      );
    throw new Error('Couldn’t load or update this work. Refresh the details and try again.');
  }
  return result.data;
}
export const operationsKey = (organizationId: string): readonly string[] => [
  'operations',
  organizationId,
];
export const recoveryPreviewKey = (organizationId: string, id: string): readonly string[] => [
  ...operationsKey(organizationId),
  'delivery',
  id,
];

export function useOperationsOverview(organizationId: string): UseQueryResult<OperationsOverview> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: [...operationsKey(organizationId), 'overview'],
    queryFn: async ({ signal }): Promise<OperationsOverview> =>
      dataOrThrow(
        (await client.GET('/v1/operations', {
          headers: await withAuthHeaders(),
          signal,
        })) as ApiResult<OperationsOverview>,
      ),
    retry: false,
    refetchInterval: 30_000,
  });
}

interface Pages<T> {
  pages: T[];
  pageParams: (string | undefined)[];
}
export function useOperationDeliveries(
  organizationId: string,
  state: DeliveryState,
): UseInfiniteQueryResult<Pages<DeliveryList>> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useInfiniteQuery({
    queryKey: [...operationsKey(organizationId), 'deliveries', state],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<DeliveryList> =>
      dataOrThrow(
        (await client.GET('/v1/operations/outbox', {
          params: { query: { state, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
          headers: await withAuthHeaders(),
          signal,
        })) as ApiResult<DeliveryList>,
      ),
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
    retry: false,
  });
}

export function useOperationCalls(
  organizationId: string,
  kind: OperationsCallKind,
): UseInfiniteQueryResult<Pages<OperationsCallList>> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useInfiniteQuery({
    queryKey: [...operationsKey(organizationId), 'calls', kind],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<OperationsCallList> =>
      dataOrThrow(
        (await client.GET('/v1/operations/calls', {
          params: { query: { kind, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
          headers: await withAuthHeaders(),
          signal,
        })) as ApiResult<OperationsCallList>,
      ),
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
    retry: false,
  });
}

export function useRecoveryPreview(
  organizationId: string,
  id: string,
): UseQueryResult<RecoveryPreview> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: recoveryPreviewKey(organizationId, id),
    queryFn: async ({ signal }): Promise<RecoveryPreview> =>
      dataOrThrow(
        (await client.GET('/v1/operations/outbox/{id}', {
          params: { path: { id } },
          headers: await withAuthHeaders(),
          signal,
        })) as ApiResult<RecoveryPreview>,
      ),
    retry: false,
    staleTime: 0,
  });
}

export function useRecoverDelivery(
  organizationId: string,
  id: string,
): UseMutationResult<RecoveryPreview, Error, { action: RecoveryAction; reviewVersion: string }> {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...operationsKey(organizationId), 'recover', id],
    mutationFn: async (body): Promise<RecoveryPreview> =>
      dataOrThrow(
        (await client.POST('/v1/operations/outbox/{id}/recover', {
          params: { path: { id } },
          headers: await withAuthHeaders(),
          body,
        })) as ApiResult<RecoveryPreview>,
      ),
    onSuccess: async (preview) => {
      queryClient.setQueryData(recoveryPreviewKey(organizationId, id), preview);
      await queryClient.invalidateQueries({ queryKey: operationsKey(organizationId) });
    },
  });
}
