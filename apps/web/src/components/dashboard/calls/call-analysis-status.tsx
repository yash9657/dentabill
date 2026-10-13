'use client';

import { useAuth } from '@clerk/nextjs';
import type { paths } from '@dentabill/api-sdk/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import * as React from 'react';

import { useDentaBillApi } from '../../../lib/api-client.js';
import { isLiveCallStatus, type CallDetailResponse } from '../../../lib/calls/types.js';

type AnalysisStatus =
  paths['/v1/calls/{id}/summary/status']['get']['responses'][200]['content']['application/json'];
const buttonClass =
  'min-h-11 rounded-standard border border-border-light px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50';
const pendingStates = new Set<AnalysisStatus['state']>([
  'NOT_REQUESTED',
  'RESERVED',
  'SUBMITTING',
  'RESPONDED',
]);

class RetryPermissionError extends Error {
  constructor() {
    super('Only a practice owner or administrator can retry processing.');
  }
}

function hasLegacySummary(status: AnalysisStatus): boolean {
  return status.provider !== 'FIREWORKS' && status.summaryId !== null;
}

function statusLabel(status: AnalysisStatus): string {
  if (status.observationId) return 'Findings are ready for review.';
  if (hasLegacySummary(status)) return 'The earlier call summary is saved.';
  if (status.reviewRequired) return 'This analysis needs attention from an owner or administrator.';
  switch (status.state) {
    case 'NOT_REQUESTED':
      return 'No analysis is available yet.';
    case 'RESERVED':
      return 'Analysis is waiting to finish.';
    case 'SUBMITTING':
      return 'Analysis is in progress.';
    case 'RESPONDED':
      return 'The response is saved. Findings are not yet available.';
    case 'UNKNOWN':
      return 'A saved response is available. An owner or administrator can finish processing.';
    case 'REJECTED':
      return 'This analysis did not produce usable findings.';
    case 'APPLIED':
      return 'Analysis processing has finished.';
  }
}

export function CallAnalysisStatus({
  call,
}: {
  readonly call: Pick<CallDetailResponse, 'id' | 'claimId' | 'status'>;
}): React.ReactElement | null {
  const auth = useAuth();
  if (!auth.isLoaded || !auth.orgId || !auth.userId || isLiveCallStatus(call.status)) return null;
  const scope = `${auth.orgId}:${auth.userId}:${call.id}`;
  const findingsScope = `${auth.orgId}:${auth.userId}:${call.claimId}`;
  return (
    <ScopedAnalysisStatus
      key={scope}
      callId={call.id}
      claimId={call.claimId}
      scope={scope}
      findingsScope={findingsScope}
    />
  );
}

function ScopedAnalysisStatus({
  callId,
  claimId,
  scope,
  findingsScope,
}: {
  readonly callId: string;
  readonly claimId: string;
  readonly scope: string;
  readonly findingsScope: string;
}): React.ReactElement {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const queryKey = ['call-analysis', scope];
  const poll = React.useRef({ reads: 0, until: Date.now() + 60_000 });
  const [retryNeedsRefresh, setRetryNeedsRefresh] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const query = useQuery({
    queryKey,
    retry: false,
    throwOnError: false,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }): Promise<AnalysisStatus> => {
      poll.current.reads++;
      try {
        const result = await client.GET('/v1/calls/{id}/summary/status', {
          params: { path: { id: callId } },
          headers: await withAuthHeaders(),
          signal,
        });
        if (!result.response.ok || result.data?.callId !== callId) throw new Error();
        return result.data;
      } catch {
        throw new Error('Analysis status could not be checked. Refresh to try again.');
      }
    },
    refetchInterval: (current) => {
      const status = current.state.data;
      if (
        current.state.error ||
        !status ||
        status.observationId ||
        hasLegacySummary(status) ||
        status.reviewRequired ||
        !pendingStates.has(status.state) ||
        Date.now() >= poll.current.until ||
        poll.current.reads >= (status.state === 'NOT_REQUESTED' ? 3 : 12)
      )
        return false;
      return 5000;
    },
  });
  const observationId = query.data?.observationId;
  React.useEffect(() => {
    if (observationId)
      void queryClient.invalidateQueries({
        queryKey: ['claim-observations', findingsScope],
        exact: true,
      });
  }, [findingsScope, observationId, queryClient]);

  const resetPolling = (): void => {
    poll.current = { reads: 0, until: Date.now() + 60_000 };
  };
  const retry = useMutation({
    retry: false,
    throwOnError: false,
    mutationFn: async (): Promise<void> => {
      setRetryNeedsRefresh(true);
      try {
        const result = await client.POST('/v1/calls/{id}/summary/retry', {
          params: { path: { id: callId } },
          headers: await withAuthHeaders(),
        });
        if (result.response.status === 403) throw new RetryPermissionError();
        if (!result.response.ok || result.data?.callId !== callId) throw new Error();
      } catch (error) {
        if (error instanceof RetryPermissionError) throw error;
        throw new Error('The retry could not be confirmed. Refresh status before trying again.');
      }
    },
    onSuccess: async () => {
      resetPolling();
      await queryClient.invalidateQueries({ queryKey, exact: true });
    },
  });
  const refresh = async (): Promise<void> => {
    if (checking || retry.isPending) return;
    setChecking(true);
    resetPolling();
    try {
      const result = await query.refetch();
      if (!result.error) {
        setRetryNeedsRefresh(false);
        retry.reset();
      }
    } finally {
      setChecking(false);
    }
  };
  return (
    <section
      aria-labelledby="call-analysis-heading"
      className="hairline-edge rounded-card flex flex-col gap-4 bg-white p-6"
    >
      <div>
        <h2 id="call-analysis-heading" className="text-xl font-medium text-black">
          Post-call analysis
        </h2>
        <p className="text-gray-dark mt-2 max-w-prose text-sm">
          Findings describe what the payer reported. They do not verify payment or change claim
          finances.
        </p>
      </div>
      {query.isPending ? (
        <p role="status" className="text-gray-warm text-sm">
          Checking analysis status…
        </p>
      ) : null}
      {query.data ? (
        <div className="flex flex-col items-start gap-3">
          <p role="status" className="text-gray-dark text-sm">
            {statusLabel(query.data)}
          </p>
          {query.data.observationId ? (
            <Link
              href={`/dashboard/claims/${claimId}#claim-findings-heading`}
              className="text-brand min-h-11 py-2 text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2"
            >
              Review claim findings
            </Link>
          ) : null}
          {query.data.provider === 'SYNTHETIC' ? (
            <p className="text-gray-warm text-sm">Synthetic analysis</p>
          ) : null}
          {query.data.canRetry && !query.isError && !retryNeedsRefresh ? (
            <button
              type="button"
              className={buttonClass}
              disabled={retry.isPending || checking || query.isFetching}
              onClick={() => {
                retry.mutate();
              }}
            >
              Retry processing
            </button>
          ) : null}
        </div>
      ) : null}
      {query.error ? (
        <p role="alert" className="text-danger text-sm">
          {query.error.message}
        </p>
      ) : null}
      {retry.error ? (
        <p role="alert" className="text-danger text-sm">
          {retry.error.message}
        </p>
      ) : null}
      {retry.isSuccess &&
      !query.data?.observationId &&
      !(query.data && hasLegacySummary(query.data)) &&
      query.data?.state !== 'APPLIED' ? (
        <p role="status" className="text-gray-dark text-sm">
          Processing was requested. Refresh status to check its result.
        </p>
      ) : null}
      <button
        type="button"
        className={`${buttonClass} self-start`}
        disabled={query.isFetching || checking || retry.isPending}
        onClick={() => {
          void refresh();
        }}
      >
        {checking ? 'Refreshing status…' : 'Refresh analysis status'}
      </button>
    </section>
  );
}
