'use client';

import type { paths } from '@dentabill/api-sdk/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { useDentaBillApi } from '../../../lib/api-client.js';

type Preview =
  paths['/v1/observations/{id}/regeneration-preview']['get']['responses'][200]['content']['application/json'];
type Status = NonNullable<Preview['activeAuthorization']>;
type Approval =
  paths['/v1/observations/{id}/regenerate']['post']['requestBody']['content']['application/json'];

const buttonClass =
  'min-h-11 rounded-standard border border-border-light px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50';
const blockedLabels = {
  CONFIGURATION_UNAVAILABLE: 'New analysis is not configured for this practice.',
  RELEASE_UNAVAILABLE: 'No approved model release is available for this analysis.',
  SOURCE_UNAVAILABLE: 'A final source transcript is required before generating another finding.',
  WORK_NOT_READY: 'Earlier analysis needs attention before another request can be approved.',
};
const statusLabels: Record<Status['state'], string> = {
  READY: 'Your approval is saved. The analysis has not finished.',
  RUNNING: 'The saved request is in progress. Check its status before taking another action.',
  RESULT_SAVED: 'The model response is saved. Resume this request to finish the finding.',
  PUBLISHED: 'The new finding is available in the evidence history.',
  REVIEW_REQUIRED: 'The request needs investigation. Its result or token usage may be unknown.',
  PROVEN_UNSENT_FAILED: 'This request ended before a model request was sent.',
  FAILED: 'This analysis did not produce a usable finding.',
  EXPIRED: 'The approval expired. A saved response may still be recoverable.',
  UNAVAILABLE: 'This saved request cannot be continued right now.',
};

class PreviewFailure extends Error {
  public constructor(readonly ownerRequired: boolean) {
    super(
      ownerRequired
        ? 'A practice owner or administrator must approve new analysis.'
        : 'The analysis preview could not be loaded. Try again.',
    );
  }
}

export function ObservationRegenerationControls({
  observationId,
  scope,
}: {
  readonly observationId: string;
  readonly scope: string;
}): React.ReactElement {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Status | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [savedRequestMissing, setSavedRequestMissing] = React.useState(false);
  const [approval, setApproval] = React.useState<Approval | null>(null);
  const [dismissedAuthorizationId, setDismissedAuthorizationId] = React.useState<string | null>(
    null,
  );
  // The frozen intent survives errors and panel toggles. Only a new explicit approval creates a key.
  const approvalRef = React.useRef<Approval | null>(null);
  const previewKey = ['observation-regeneration-preview', scope, observationId];
  const panelId = React.useId();
  const preview = useQuery({
    queryKey: previewKey,
    enabled: expanded,
    retry: false,
    throwOnError: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<Preview> => {
      try {
        const response = await client.GET('/v1/observations/{id}/regeneration-preview', {
          params: { path: { id: observationId } },
          headers: await withAuthHeaders(),
          signal,
        });
        if (!response.response.ok || response.data === undefined)
          throw new PreviewFailure(response.response.status === 403);
        return response.data;
      } catch (error) {
        throw error instanceof PreviewFailure ? error : new PreviewFailure(false);
      }
    },
  });
  const execute = useMutation({
    retry: false,
    throwOnError: false,
    mutationFn: async (
      action: { kind: 'APPROVE'; body: Approval } | { kind: 'RESUME'; id: string },
    ): Promise<Status> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, 35_000);
      try {
        const headers = await withAuthHeaders();
        const response =
          action.kind === 'APPROVE'
            ? await client.POST('/v1/observations/{id}/regenerate', {
                params: { path: { id: observationId } },
                headers,
                body: action.body,
                signal: controller.signal,
              })
            : await client.POST('/v1/observation-regenerations/{id}/resume', {
                params: { path: { id: action.id } },
                headers,
                body: {},
                signal: controller.signal,
              });
        if (!response.response.ok || response.data === undefined) throw new Error();
        return response.data;
      } catch {
        throw new Error(
          'The request could not be confirmed. Check the saved request before trying again.',
        );
      } finally {
        clearTimeout(timeout);
      }
    },
    onSuccess: async (result) => {
      setStatus(result);
      setDismissedAuthorizationId(null);
      setMessage(null);
      setSavedRequestMissing(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['claim-observations', scope] }),
        queryClient.invalidateQueries({ queryKey: previewKey }),
      ]);
    },
    onError: () => {
      setMessage(
        'The request could not be confirmed. Check the saved request before trying again.',
      );
      setSavedRequestMissing(false);
    },
  });
  React.useEffect(() => {
    if (preview.data?.activeAuthorization) setStatus(preview.data.activeAuthorization);
  }, [preview.data]);
  const currentStatus = status ?? preview.data?.activeAuthorization ?? null;
  const pending = execute.isPending || checking;
  const hasSavedWork =
    approval !== null || (currentStatus !== null && currentStatus.id !== dismissedAuthorizationId);
  const canStartAnother =
    preview.data?.canRegenerate &&
    currentStatus !== null &&
    currentStatus.id !== dismissedAuthorizationId &&
    !currentStatus.canResume &&
    ['PUBLISHED', 'PROVEN_UNSENT_FAILED', 'FAILED', 'EXPIRED'].includes(currentStatus.state);

  const approve = (): void => {
    const data = preview.data;
    if (pending || hasSavedWork || !data?.canRegenerate || !data.previewDigest) return;
    if (!reason.trim()) {
      setMessage('Add a reason for generating another finding.');
      return;
    }
    try {
      const body = approvalRef.current ?? {
        expectedPreviewDigest: data.previewDigest,
        idempotencyKey: crypto.randomUUID(),
        reason: reason.trim(),
      };
      approvalRef.current = body;
      setApproval(body);
      setMessage(null);
      execute.mutate({ kind: 'APPROVE', body });
    } catch {
      setMessage('The approval could not be prepared. Refresh and try again.');
    }
  };
  const checkSaved = async (): Promise<void> => {
    if (pending) return;
    setChecking(true);
    setMessage(null);
    try {
      const result = await preview.refetch();
      if (result.error || !result.data) {
        setMessage('The saved request could not be checked. Try again.');
        return;
      }
      const found = result.data.activeAuthorization;
      if (found) setStatus(found);
      setSavedRequestMissing(found === null && approvalRef.current !== null && status === null);
      await queryClient.invalidateQueries({ queryKey: ['claim-observations', scope] });
    } finally {
      setChecking(false);
    }
  };
  const reviewAnother = async (): Promise<void> => {
    if (pending || !canStartAnother) return;
    setChecking(true);
    setMessage(null);
    try {
      const refreshed = await preview.refetch();
      const previous = refreshed.data?.activeAuthorization ?? currentStatus;
      if (
        refreshed.error ||
        !refreshed.data?.canRegenerate ||
        previous.canResume ||
        !['PUBLISHED', 'PROVEN_UNSENT_FAILED', 'FAILED', 'EXPIRED'].includes(previous.state)
      ) {
        setMessage('A new approval is not available. Check the saved request first.');
        return;
      }
      approvalRef.current = null;
      setApproval(null);
      setReason('');
      setSavedRequestMissing(false);
      setDismissedAuthorizationId(previous.id);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="border-border-subtle border-t pt-4">
      <button
        type="button"
        className={buttonClass}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => {
          setExpanded((value) => !value);
        }}
      >
        New analysis
      </button>
      {expanded ? (
        <div id={panelId} className="mt-4 flex max-w-prose flex-col gap-4 text-sm">
          <p className="text-gray-dark">
            An owner or administrator can approve a new finding from the saved transcript. This uses
            model tokens; it does not verify payment or change claim finances.
          </p>
          {preview.isPending ? <p role="status">Loading analysis preview…</p> : null}
          {preview.error ? (
            <div className="space-y-3">
              <p role="alert" className="text-danger">
                {preview.error.message}
              </p>
              {!(preview.error instanceof PreviewFailure && preview.error.ownerRequired) ? (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={pending}
                  onClick={() => {
                    void preview.refetch();
                  }}
                >
                  Retry preview
                </button>
              ) : null}
            </div>
          ) : null}
          {preview.data && !preview.isError ? (
            <>
              {preview.data.dataClass === 'SYNTHETIC' ? (
                <p className="text-warning font-medium">Synthetic test data</p>
              ) : null}
              <dl className="space-y-3">
                <div>
                  <dt className="text-gray-warm">Claim snapshot</dt>
                  <dd className="mt-1 break-words">
                    <time dateTime={preview.data.claimVersion}>{preview.data.claimVersion}</time>
                  </dd>
                </div>
                {preview.data.nextGeneration !== null ? (
                  <div>
                    <dt className="text-gray-warm">Next analysis</dt>
                    <dd className="mt-1">Generation {preview.data.nextGeneration}</dd>
                  </div>
                ) : null}
                {preview.data.release ? (
                  <>
                    <div>
                      <dt className="text-gray-warm">Model release</dt>
                      <dd className="mt-1 break-all">
                        {preview.data.release.model}
                        <br />
                        {preview.data.release.id}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-warm">Token allowance</dt>
                      <dd className="mt-1">
                        {preview.data.release.tokenAllowance.toLocaleString()} tokens per attempt ·
                        up to {preview.data.release.maxAttempts} attempts
                        <p className="text-gray-dark mt-1">
                          This is an operational token allowance, not a price estimate.
                        </p>
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>
              {preview.data.source ? (
                <details>
                  <summary className="text-brand focus-visible:outline-brand rounded-standard w-fit cursor-pointer py-2 underline underline-offset-4 focus-visible:outline focus-visible:outline-2">
                    Exact source for this analysis
                  </summary>
                  <p className="text-gray-warm mt-3 break-all">
                    Transcript version {preview.data.source.version}
                  </p>
                  <p className="text-gray-dark mt-3 whitespace-pre-wrap break-words">
                    {preview.data.source.text}
                  </p>
                </details>
              ) : null}
              {!preview.data.canRegenerate && preview.data.blockedReason ? (
                <p className="text-warning">{blockedLabels[preview.data.blockedReason]}</p>
              ) : null}
              {!hasSavedWork &&
              preview.data.canRegenerate &&
              preview.data.previewDigest &&
              preview.data.source &&
              preview.data.release ? (
                <div className="space-y-3">
                  <label htmlFor={`${panelId}-reason`} className="text-gray-dark block">
                    Reason for new analysis (required)
                  </label>
                  <textarea
                    id={`${panelId}-reason`}
                    value={reason}
                    maxLength={1000}
                    rows={3}
                    disabled={pending}
                    onChange={(event) => {
                      setReason(event.target.value);
                    }}
                    className="border-border-light rounded-standard focus-visible:outline-brand w-full border bg-white px-3 py-2 text-sm text-black focus-visible:outline focus-visible:outline-2"
                  />
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={pending || preview.isFetching}
                    onClick={approve}
                  >
                    Approve and generate
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          {execute.isPending ? (
            <p role="status">
              The request may take about 30 seconds. If it is interrupted, check the saved request
              before trying again.
            </p>
          ) : null}
          {currentStatus ? (
            <div className="space-y-3">
              <p role="status">{statusLabels[currentStatus.state]}</p>
              <p className="text-gray-warm">
                Approval valid until{' '}
                <time dateTime={currentStatus.expiresAt}>{currentStatus.expiresAt}</time>. Checking
                this request does not create another generation.
              </p>
              {currentStatus.canResume ? (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={pending}
                  onClick={() => {
                    execute.mutate({ kind: 'RESUME', id: currentStatus.id });
                  }}
                >
                  Resume saved request
                </button>
              ) : null}
            </div>
          ) : null}
          {hasSavedWork ? (
            <button
              type="button"
              className={`${buttonClass} self-start`}
              disabled={pending}
              onClick={() => {
                void checkSaved();
              }}
            >
              {checking ? 'Checking saved request…' : 'Check saved request'}
            </button>
          ) : null}
          {canStartAnother ? (
            <button
              type="button"
              className={`${buttonClass} self-start`}
              disabled={pending || preview.isFetching}
              onClick={() => {
                void reviewAnother();
              }}
            >
              Review another request
            </button>
          ) : null}
          {savedRequestMissing && approval ? (
            <div className="space-y-3">
              <p className="text-gray-dark">
                No saved authorization was found. You can retry the same approval; its request
                identity and evidence remain unchanged.
              </p>
              <button
                type="button"
                className={buttonClass}
                disabled={pending}
                onClick={() => {
                  execute.mutate({ kind: 'APPROVE', body: approval });
                }}
              >
                Retry saved approval
              </button>
            </div>
          ) : null}
          {message ? (
            <p role="alert" className="text-danger">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
