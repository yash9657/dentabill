'use client';

import { useAuth } from '@clerk/nextjs';
import type { paths } from '@dentabill/api-sdk/types';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import * as React from 'react';

import { useDentaBillApi } from '../../../lib/api-client.js';

import { ObservationRegenerationControls } from './observation-regeneration-controls.js';

type ObservationList =
  paths['/v1/claims/{id}/observations']['get']['responses'][200]['content']['application/json'];
type Observation = ObservationList['items'][number];
type ReviewBody =
  paths['/v1/observations/{id}/review']['post']['requestBody']['content']['application/json'];

const actionLabels: Record<Observation['output']['proposedAction'], string> = {
  REVIEW_PAYMENT: 'Review payment evidence',
  REVIEW_DENIAL: 'Review denial',
  FOLLOW_UP: 'Follow up',
  REQUEST_INFORMATION: 'Request information',
  MANUAL_REVIEW: 'Manual review',
};
const statusLabels: Record<Observation['output']['status']['value'], string> = {
  PAID_REPORTED: 'Payment reported by payer',
  DENIED_REPORTED: 'Denial reported by payer',
  PENDING_REPORTED: 'Pending with payer',
  UNKNOWN: 'Status unclear',
};
const staleLabels = {
  CLAIM_CHANGED:
    'The claim changed after this finding was generated. Review fresh evidence before acting.',
  SUPERSEDED: 'A newer finding is available. This version is preserved for reference.',
  NEWER_CALL: 'A newer call exists. Review its evidence before acting.',
  TRANSCRIPT_CHANGED: 'The source transcript changed. Review fresh evidence before acting.',
  NEWER_GENERATION: 'A newer analysis was approved. Check its saved request before acting.',
  ALREADY_REVIEWED: 'Review recorded.',
};
const buttonClass =
  'min-h-11 rounded-standard border border-border-light px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50';

export function ClaimObservations({ claimId }: { readonly claimId: string }): React.ReactElement {
  const auth = useAuth();
  if (!auth.isLoaded)
    return (
      <p role="status" className="text-gray-warm text-sm">
        Loading findings…
      </p>
    );
  if (!auth.orgId || !auth.userId)
    return <p className="text-gray-dark text-sm">Select your practice to see findings.</p>;
  const scope = `${auth.orgId}:${auth.userId}:${claimId}`;
  return <ObservationHistory key={scope} claimId={claimId} scope={scope} />;
}

function ObservationHistory({
  claimId,
  scope,
}: {
  readonly claimId: string;
  readonly scope: string;
}): React.ReactElement {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const queryKey = ['claim-observations', scope];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<ObservationList> => {
      const result = await client.GET('/v1/claims/{id}/observations', {
        params: {
          path: { id: claimId },
          query: { limit: 10, ...(pageParam ? { cursor: pageParam } : {}) },
        },
        headers: await withAuthHeaders(),
        signal,
      });
      if (!result.response.ok || result.data === undefined)
        throw new Error('Findings could not be loaded. Try again.');
      return result.data;
    },
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    retry: false,
    throwOnError: false,
  });
  const publish = useMutation({
    mutationFn: async (callId: string): Promise<void> => {
      const result = await client.POST('/v1/calls/{id}/observations/publish', {
        params: { path: { id: callId } },
        headers: await withAuthHeaders(),
        body: {},
      });
      if (!result.response.ok)
        throw new Error('Saved findings could not be added. Refresh and try again.');
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  return (
    <section aria-labelledby="claim-findings-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="claim-findings-heading" className="text-xl font-medium text-black">
          Findings and evidence
        </h2>
        <p className="text-gray-dark mt-2 max-w-prose text-sm">
          Review what the payer reported and the transcript behind it. A review records your
          assessment; it does not submit a claim or verify a payment.
        </p>
        <button
          className={`${buttonClass} mt-3`}
          type="button"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          {query.isFetching ? 'Refreshing findings…' : 'Refresh findings'}
        </button>
      </div>
      {query.isPending ? (
        <p role="status" className="text-gray-warm text-sm">
          Loading findings…
        </p>
      ) : null}
      {query.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-danger text-sm">
            {query.error.message}
          </p>
          <button
            className={buttonClass}
            type="button"
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry findings
          </button>
        </div>
      ) : null}
      {query.data ? (
        <>
          {query.data.pages[0]?.publishableCalls.map((call) => (
            <div
              key={call.callId}
              className="border-border-subtle flex flex-wrap items-center gap-3 border-b py-3"
            >
              <p className="text-gray-dark text-sm">Saved analysis is ready for your review.</p>
              <button
                className={buttonClass}
                type="button"
                disabled={publish.isPending}
                onClick={() => {
                  publish.mutate(call.callId);
                }}
              >
                {publish.isPending ? 'Adding findings…' : 'Add saved findings'}
              </button>
              <Link
                className="text-brand text-sm underline underline-offset-4"
                href={`/dashboard/calls/${call.callId}`}
              >
                View call
              </Link>
            </div>
          ))}
          {publish.error ? (
            <p role="alert" className="text-danger text-sm">
              {publish.error.message}
            </p>
          ) : null}
          {query.data.pages.every((page) => page.items.length === 0) ? (
            <p className="text-gray-warm py-4 text-sm">
              No versioned findings yet. Earlier call summaries remain in the call history below.
            </p>
          ) : null}
          <div className="divide-border-subtle divide-y">
            {query.data.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <ObservationEntry key={item.id} item={item} scope={scope} />
              ))}
          </div>
          {query.hasNextPage ? (
            <button
              type="button"
              className={`${buttonClass} self-start`}
              disabled={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              {query.isFetchingNextPage ? 'Loading history…' : 'Load earlier findings'}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ObservationEntry({
  item,
  scope,
}: {
  readonly item: Observation;
  readonly scope: string;
}): React.ReactElement {
  const { client, withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const [note, setNote] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);
  const review = useMutation({
    mutationFn: async (decision: ReviewBody['decision']): Promise<void> => {
      const result = await client.POST('/v1/observations/{id}/review', {
        params: { path: { id: item.id } },
        headers: await withAuthHeaders(),
        body: {
          expectedDigest: item.digest,
          expectedClaimVersion: item.claimVersion,
          decision,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      if (!result.response.ok)
        throw new Error(
          'This finding could not be reviewed. Refresh to check whether the claim or evidence changed.',
        );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['claim-observations', scope] });
    },
  });
  const evidence = [
    ...item.output.status.evidence,
    ...(item.output.payerReportedPayment?.evidence ?? []),
    ...item.output.denialCodes.flatMap((code) => code.evidence),
  ];
  const uniqueEvidence = evidence.filter(
    (entry, index) =>
      evidence.findIndex(
        (other) =>
          other.sourceId === entry.sourceId &&
          other.sourceVersion === entry.sourceVersion &&
          other.start === entry.start &&
          other.end === entry.end,
      ) === index,
  );
  const save = (decision: ReviewBody['decision']): void => {
    if (decision === 'DISMISSED' && !note.trim()) {
      setLocalError('Add a reason before dismissing this finding.');
      return;
    }
    setLocalError(null);
    review.mutate(decision);
  };
  const payment = item.output.payerReportedPayment;
  return (
    <article className="flex flex-col gap-4 py-6" aria-labelledby={`finding-${item.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 id={`finding-${item.id}`} className="text-base font-medium text-black">
          {statusLabels[item.output.status.value]}
        </h3>
        <span className="text-gray-warm text-sm">
          Version {item.version}
          {item.isCurrent ? ' · Current' : ' · Earlier evidence'}
        </span>
      </div>
      {item.dataClass === 'SYNTHETIC' ? (
        <p className="text-warning text-sm font-medium">Synthetic test data</p>
      ) : null}
      {item.output.disposition === 'ABSTAIN' ? (
        <p className="text-gray-dark text-sm">
          The analysis could not establish a finding. Review the source and gather more evidence.
        </p>
      ) : null}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-gray-warm">Proposed next step</dt>
          <dd className="mt-1 text-black">{actionLabels[item.output.proposedAction]}</dd>
        </div>
        {payment ? (
          <div>
            <dt className="text-gray-warm">Payer-reported amount</dt>
            <dd className="mt-1 text-black">
              {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: payment.currency,
              }).format(payment.amountMinorUnits / 100)}
              <span className="text-gray-dark mt-1 block">
                Payment receipt and posting are unverified.
              </span>
            </dd>
          </div>
        ) : null}
        {item.output.denialCodes.length ? (
          <div>
            <dt className="text-gray-warm">Reported codes</dt>
            <dd className="mt-1 text-black">
              {item.output.denialCodes
                .map(
                  (code) =>
                    `${code.system === 'UNKNOWN' ? 'Unclassified' : code.system}: ${code.code}`,
                )
                .join(', ')}
            </dd>
          </div>
        ) : null}
      </dl>
      {uniqueEvidence.length ? (
        <div className="space-y-3">
          <h4 className="text-gray-dark text-sm font-medium">Supporting transcript excerpts</h4>
          {uniqueEvidence.map((entry) => (
            <blockquote
              key={`${entry.sourceId}:${String(entry.start)}:${String(entry.end)}`}
              className="text-gray-dark max-w-prose break-words text-sm"
            >
              <p>“{entry.quote}”</p>
              <footer className="text-gray-warm mt-1 text-xs">
                Transcript {item.sources.findIndex((source) => source.id === entry.sourceId) + 1} ·{' '}
                <span title={entry.sourceVersion}>{entry.sourceVersion.slice(0, 12)}</span>
              </footer>
            </blockquote>
          ))}
        </div>
      ) : (
        <p className="text-gray-warm text-sm">No supporting excerpt was established.</p>
      )}
      <details className="text-sm">
        <summary className="text-brand rounded-standard focus-visible:outline-brand w-fit cursor-pointer py-2 underline underline-offset-4 focus-visible:outline focus-visible:outline-2">
          Source and analysis details
        </summary>
        <p className="text-gray-dark my-3 break-words">
          {item.provenance.kind === 'FIREWORKS' ? 'Fireworks analysis' : 'Synthetic analysis'} ·{' '}
          {item.provenance.releaseId}
        </p>
        {item.sources.map((source, index) => (
          <div key={`${source.id}:${source.version}`} className="mb-4">
            <h4 className="text-gray-dark font-medium">
              Transcript {index + 1} · <span className="break-all">{source.version}</span>
            </h4>
            <p className="text-gray-dark mt-2 max-w-prose whitespace-pre-wrap break-words">
              {source.text}
            </p>
          </div>
        ))}
        <Link
          href={`/dashboard/calls/${item.callId}`}
          className="text-brand underline underline-offset-4"
        >
          View source call
        </Link>
      </details>
      {item.review ? (
        <div className="text-gray-dark text-sm">
          <p role="status">
            {item.review.decision === 'ACKNOWLEDGED' ? 'Marked reviewed' : 'Finding dismissed'}
          </p>
          {item.review.note ? (
            <p className="mt-1 max-w-prose whitespace-pre-wrap break-words">{item.review.note}</p>
          ) : null}
        </div>
      ) : null}
      {item.staleReason && item.staleReason !== 'ALREADY_REVIEWED' ? (
        <p className="text-warning text-sm">{staleLabels[item.staleReason]}</p>
      ) : null}
      {item.canReview && !item.review ? (
        <div className="max-w-prose space-y-3">
          <label htmlFor={`review-note-${item.id}`} className="text-gray-dark block text-sm">
            Review note <span className="text-gray-warm">(required to dismiss)</span>
          </label>
          <textarea
            id={`review-note-${item.id}`}
            value={note}
            maxLength={1000}
            rows={3}
            disabled={review.isPending}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            className="border-border-light rounded-standard focus-visible:outline-brand w-full border bg-white px-3 py-2 text-sm text-black focus-visible:outline focus-visible:outline-2"
          />
          <div className="flex flex-wrap gap-3">
            <button
              className={buttonClass}
              type="button"
              disabled={review.isPending}
              onClick={() => {
                save('ACKNOWLEDGED');
              }}
            >
              {review.isPending ? 'Saving review…' : 'Mark reviewed'}
            </button>
            <button
              className={buttonClass}
              type="button"
              disabled={review.isPending}
              onClick={() => {
                save('DISMISSED');
              }}
            >
              Dismiss finding
            </button>
          </div>
          {localError || review.error ? (
            <p role="alert" className="text-danger text-sm">
              {localError ?? review.error?.message}
            </p>
          ) : null}
        </div>
      ) : null}
      {item.isCurrent ? (
        <ObservationRegenerationControls observationId={item.id} scope={scope} />
      ) : null}
    </article>
  );
}
