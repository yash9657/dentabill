'use client';

import type { paths } from '@dentabill/api-sdk/types';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { useDentaBillApi } from '../../../lib/api-client.js';

type SavedSummary =
  paths['/v1/calls/{id}/summary']['get']['responses'][200]['content']['application/json'];

const nextActionLabels: Record<SavedSummary['nextAction'], string> = {
  RESUBMIT: 'Resubmit the claim',
  APPEAL: 'Appeal the decision',
  SUBMIT_DOCS: 'Submit supporting documents',
  CALL_BACK: 'Call back',
  WRITE_OFF: 'Review a write-off',
  RESOLVED: 'Marked resolved in the summary',
  MANUAL_REVIEW: 'Review manually',
};

export function SavedCallSummary({
  callId,
  summaryId,
  scope,
}: {
  readonly callId: string;
  readonly summaryId: string;
  readonly scope: string;
}): React.ReactElement {
  const { client, withAuthHeaders } = useDentaBillApi();
  const query = useQuery({
    queryKey: ['call-saved-summary', scope, summaryId],
    retry: false,
    throwOnError: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<SavedSummary> => {
      try {
        const result = await client.GET('/v1/calls/{id}/summary', {
          params: { path: { id: callId } },
          headers: await withAuthHeaders(),
          signal,
        });
        if (!result.response.ok || result.data?.callId !== callId || result.data.id !== summaryId)
          throw new Error();
        return result.data;
      } catch {
        throw new Error('The saved call summary could not be loaded. Reload it to try again.');
      }
    },
  });
  const summary = query.data;
  return (
    <div className="border-border-subtle flex flex-col gap-4 border-t pt-4">
      <h3 className="text-base font-medium text-black">Collected call details</h3>
      {query.isPending ? (
        <p role="status" className="text-gray-warm text-sm">
          Loading the saved call summary…
        </p>
      ) : null}
      {summary ? (
        <>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <SummaryField
              label="Reported outcome"
              value={summary.claimStatus.replaceAll('_', ' ')}
            />
            <SummaryField
              label="Reference number"
              value={summary.referenceNumber ?? 'Not recorded'}
            />
            <SummaryField label="Representative" value={summary.repName ?? 'Not recorded'} />
            <SummaryField
              label="Suggested next action"
              value={nextActionLabels[summary.nextAction]}
            />
            {summary.denialReason ? (
              <SummaryField label="Reported denial reason" value={summary.denialReason} />
            ) : null}
            {summary.denialCode ? (
              <SummaryField label="Reported denial code" value={summary.denialCode} />
            ) : null}
          </dl>
          {summary.notes ? (
            <p className="text-gray-dark max-w-prose whitespace-pre-wrap break-words text-sm leading-6">
              {summary.notes}
            </p>
          ) : null}
        </>
      ) : null}
      {query.isError ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-danger text-sm">
            {query.error.message}
          </p>
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
            className="border-border-light rounded-standard hover:bg-gray-light focus-visible:outline-brand min-h-11 border px-4 py-2 text-sm font-medium text-black transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            {query.isFetching ? 'Reloading summary…' : 'Reload saved summary'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SummaryField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-gray-warm">{label}</dt>
      <dd className="whitespace-pre-wrap break-words font-medium text-black">{value}</dd>
    </div>
  );
}
