'use client';

import { useAuth } from '@clerk/nextjs';
import { Button, Select, Skeleton } from '@dentabill/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import * as React from 'react';

import {
  deliveryErrorLabel,
  deliveryKindLabel,
  deliveryStateLabel,
  operationDate,
} from '../../../../lib/operations/labels.js';
import type {
  DeliveryState,
  OperationsCallKind,
  OperationsOverview,
} from '../../../../lib/operations/types.js';
import {
  useOperationsAccess,
  type OperationsScope,
} from '../../../../lib/operations/use-notifications.js';
import {
  operationsKey,
  useOperationCalls,
  useOperationDeliveries,
  useOperationsOverview,
} from '../../../../lib/operations/use-operations.js';

import { RecoveryDialog } from './recovery-dialog.js';
import { ReviewNotifications } from './review-notifications.js';

export function OperationsPage(): React.ReactElement {
  const { userId, orgId, isLoaded } = useAuth();
  if (!isLoaded) return <WorkSkeleton label="Loading operations access" />;
  if (!userId) return <p>Sign in to view operations.</p>;
  const scope: OperationsScope = [userId, orgId ?? null];
  return <OperationsAccess key={JSON.stringify(scope)} scope={scope} />;
}

function OperationsAccess({ scope }: { readonly scope: OperationsScope }): React.ReactElement {
  const profile = useOperationsAccess(scope);
  if (profile.isPending) return <WorkSkeleton label="Loading operations access" />;
  if (profile.isError)
    return (
      <p role="alert" className="text-danger">
        Couldn’t confirm your access. Refresh the page to try again.
      </p>
    );
  if (profile.data.user.role !== 'OWNER' && profile.data.user.role !== 'ADMIN')
    return (
      <section>
        <h1 className="text-2xl font-medium">Operations</h1>
        <p className="text-gray-dark mt-3">
          Operations is available to practice owners and admins.
        </p>
      </section>
    );
  return (
    <OperationsWorkspace
      key={profile.data.organization.id}
      organizationId={profile.data.organization.id}
      scope={scope}
    />
  );
}

function OperationsWorkspace({
  organizationId,
  scope,
}: {
  readonly organizationId: string;
  readonly scope: OperationsScope;
}): React.ReactElement {
  const overview = useOperationsOverview(organizationId);
  const client = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);
  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await client.invalidateQueries({ queryKey: operationsKey(organizationId) });
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <section className="flex min-w-0 flex-col gap-8" aria-labelledby="operations-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            id="operations-title"
            className="font-body text-[28px] font-medium leading-tight tracking-[-0.01em] sm:text-[32px]"
          >
            Operations
          </h1>
          <p className="text-gray-dark mt-3 max-w-prose text-sm">
            Review delivery problems and calls that need attention. Counts describe saved work, not
            service health.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={refreshing}
          onClick={() => {
            void refresh();
          }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh work'}
        </Button>
      </header>
      {overview.isPending ? (
        <WorkSkeleton label="Loading work counts" />
      ) : overview.isError ? (
        <p role="alert" className="text-danger text-sm">
          {overview.error.message}
        </p>
      ) : (
        <WorkOverview data={overview.data} />
      )}
      <ReviewNotifications organizationId={organizationId} scope={scope} />
      <DeliveryWorklist organizationId={organizationId} />
      <CallWorklist organizationId={organizationId} />
    </section>
  );
}

function WorkOverview({ data }: { readonly data: OperationsOverview }): React.ReactElement {
  const entries: [string, number][] = [
    ['Awaiting delivery', data.counts.pending],
    [
      `Waiting over ${String(data.thresholds.deliveryAgeSeconds / 60)} minutes`,
      data.counts.agedPending,
    ],
    ['Delivery review needed', data.counts.quarantined],
    ['Calls past deadline', data.counts.acceptedOverdue],
    ['Call status needs review', data.counts.observationReview],
    ['Uncertain call submissions', data.counts.uncertainCalls],
    ['Queued calls missing delivery', data.counts.legacyReadyWithoutDelivery],
  ];
  return (
    <div className="border-border-subtle border-y py-5">
      <dl className="grid gap-x-12 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map(([label, count]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="text-gray-dark">{label}</dt>
            <dd className="font-medium tabular-nums">{String(count)}</dd>
          </div>
        ))}
      </dl>
      <div className="text-gray-warm mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <span>Sampled {operationDate(data.sampledAt)}</span>
        <span>Oldest due delivery: {operationDate(data.oldestPendingAt)}</span>
        <span>Oldest request needing review: {operationDate(data.oldestQuarantinedAt)}</span>
      </div>
    </div>
  );
}

function DeliveryWorklist({
  organizationId,
}: {
  readonly organizationId: string;
}): React.ReactElement {
  const [state, setState] = React.useState<DeliveryState>('QUARANTINED');
  const [selected, setSelected] = React.useState<string | null>(null);
  const query = useOperationDeliveries(organizationId, state);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="min-w-0" aria-labelledby="deliveries-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="deliveries-heading" className="text-xl font-medium">
            Delivery work
          </h2>
          <p className="text-gray-dark mt-2 max-w-prose text-sm">
            A delivery receipt confirms handoff, not a finished call or summary.
          </p>
        </div>
        <label htmlFor="operations-delivery-state" className="flex flex-col gap-1 text-sm">
          <span className="text-gray-warm">Delivery status</span>
          <Select
            id="operations-delivery-state"
            value={state}
            onChange={(event) => {
              setState(event.target.value as DeliveryState);
            }}
          >
            <option value="QUARANTINED">Needs review</option>
            <option value="PENDING">Awaiting delivery</option>
            <option value="DELIVERED">Delivery received</option>
            <option value="CLOSED">Closed after review</option>
          </Select>
        </label>
      </div>
      {query.isPending ? (
        <WorkSkeleton label="Loading deliveries" />
      ) : query.isError ? (
        <p role="alert" className="text-danger text-sm">
          {query.error.message}
        </p>
      ) : items.length === 0 ? (
        <EmptyWork>No deliveries match this status. Other work may still need attention.</EmptyWork>
      ) : (
        <div className="hairline-edge rounded-card overflow-x-auto bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Delivery work</caption>
            <thead className="bg-gray-light-alt text-gray-warm">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Request
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Attempts
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">
                  Last changed
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Review</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-border-subtle border-t">
                  <td className="px-4 py-4">
                    <span className="font-medium">{deliveryKindLabel(item.kind)}</span>
                    <p className="text-gray-warm mt-1 text-xs">{deliveryStateLabel(item.state)}</p>
                    <p
                      className="text-gray-warm mt-1 max-w-48 truncate font-mono text-xs"
                      title={item.id}
                    >
                      {item.id}
                    </p>
                    <p className="text-gray-dark mt-1 text-xs">
                      {deliveryErrorLabel(item.lastErrorCode)}
                    </p>
                  </td>
                  <td className="px-4 py-4 align-top tabular-nums">
                    {item.deliveryAttempts} / {item.deliveryAttemptLimit}
                  </td>
                  <td className="text-gray-dark hidden px-4 py-4 align-top lg:table-cell">
                    {operationDate(item.updatedAt)}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Review ${deliveryKindLabel(item.kind).toLowerCase()} ${item.id}`}
                      onClick={() => {
                        setSelected(item.id);
                      }}
                    >
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          className="mt-4"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more deliveries'}
        </Button>
      ) : null}
      {selected ? (
        <RecoveryDialog
          key={selected}
          id={selected}
          organizationId={organizationId}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </section>
  );
}

function CallWorklist({ organizationId }: { readonly organizationId: string }): React.ReactElement {
  const [kind, setKind] = React.useState<OperationsCallKind>('OBSERVATION');
  const query = useOperationCalls(organizationId, kind);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const explanation =
    kind === 'UNCERTAIN'
      ? 'A payer call may already exist. Open the claim to check it before requesting another call.'
      : kind === 'LEGACY_READY'
        ? 'These queued requests have no saved delivery. Open the claim and use its queue retry to preserve the existing request.'
        : 'Review calls past their deadline, awaiting a status check, or flagged for manual review.';
  return (
    <section className="min-w-0" aria-labelledby="call-work-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="call-work-heading" className="text-xl font-medium">
            Call follow-up
          </h2>
          <p className="text-gray-dark mt-2 max-w-prose text-sm">{explanation}</p>
        </div>
        <label htmlFor="operations-call-kind" className="flex flex-col gap-1 text-sm">
          <span className="text-gray-warm">Call work</span>
          <Select
            id="operations-call-kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as OperationsCallKind);
            }}
          >
            <option value="OBSERVATION">Status checks</option>
            <option value="UNCERTAIN">Uncertain submissions</option>
            <option value="LEGACY_READY">Missing delivery</option>
          </Select>
        </label>
      </div>
      {query.isPending ? (
        <WorkSkeleton label="Loading call follow-up" />
      ) : query.isError ? (
        <p role="alert" className="text-danger text-sm">
          {query.error.message}
        </p>
      ) : items.length === 0 ? (
        <EmptyWork>
          No calls match this view. This does not confirm provider availability or completion.
        </EmptyWork>
      ) : (
        <ul className="hairline-edge rounded-card divide-border-subtle divide-y bg-white">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {kind === 'UNCERTAIN'
                    ? 'Call submission is uncertain'
                    : kind === 'LEGACY_READY'
                      ? 'Queued request needs delivery'
                      : item.observationReviewAt
                        ? 'Call status needs review'
                        : 'Call status check due'}
                </p>
                <p className="text-gray-warm mt-1 break-all font-mono text-xs">{item.id}</p>
                <p className="text-gray-dark mt-2 text-xs">
                  {kind === 'OBSERVATION'
                    ? `Deadline: ${operationDate(item.callDeadlineAt)} · Last checked: ${operationDate(item.lastObservedAt)}`
                    : `Created ${operationDate(item.createdAt)}`}
                </p>
              </div>
              <Link
                className="text-brand inline-flex min-h-11 shrink-0 items-center text-sm font-medium underline underline-offset-4"
                href={
                  kind === 'OBSERVATION' && item.callId
                    ? `/dashboard/calls/${encodeURIComponent(item.callId)}`
                    : `/dashboard/claims/${encodeURIComponent(item.claimId)}`
                }
              >
                {kind === 'OBSERVATION' && item.callId ? 'Open call status' : 'Open claim'}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          className="mt-4"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more calls'}
        </Button>
      ) : null}
    </section>
  );
}
function WorkSkeleton({ label }: { readonly label: string }): React.ReactElement {
  return (
    <div aria-label={label} role="status">
      <Skeleton className="h-28 w-full" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
function EmptyWork({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <p className="border-border-subtle text-gray-dark rounded-card border border-dashed p-6 text-sm">
      {children}
    </p>
  );
}
