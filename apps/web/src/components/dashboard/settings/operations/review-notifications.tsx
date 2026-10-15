'use client';

import { Button, Select, Skeleton } from '@dentabill/ui';
import Link from 'next/link';
import * as React from 'react';

import { operationDate } from '../../../../lib/operations/labels.js';
import {
  notificationAge,
  notificationBindingLabels,
  notificationPurposeLabels,
  notificationReason,
  notificationStateLabels,
} from '../../../../lib/operations/notification-labels.js';
import {
  useOperationNotificationDetail,
  useOperationNotifications,
  type NotificationRow,
  type NotificationState,
  type OperationsScope,
} from '../../../../lib/operations/use-notifications.js';

interface Props {
  readonly organizationId: string;
  readonly scope: OperationsScope;
}

export function ReviewNotifications({ organizationId, scope }: Props): React.ReactElement {
  const [state, setState] = React.useState<NotificationState>('ALL');
  const [selected, setSelected] = React.useState<string | null>(null);
  const inspectButton = React.useRef<HTMLButtonElement | null>(null);
  const query = useOperationNotifications(organizationId, scope, state);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const snapshot = query.data?.pages[0];
  return (
    <section className="min-w-0" aria-labelledby="review-notifications-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="review-notifications-heading" className="text-xl font-medium">
            Review notifications
          </h2>
          <p className="text-gray-dark mt-2 max-w-prose text-sm">
            Review alerts are stored here. External email delivery is unavailable.
          </p>
        </div>
        <label htmlFor="operations-notification-state" className="flex flex-col gap-1 text-sm">
          <span className="text-gray-warm">Notification status</span>
          <Select
            id="operations-notification-state"
            value={state}
            onChange={(event) => {
              setState(event.target.value as NotificationState);
              setSelected(null);
            }}
          >
            <option value="ALL">All statuses</option>
            {Object.entries(notificationStateLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <p className="text-gray-dark mb-5 max-w-prose text-sm">
        Simulated means a test receipt was recorded. Provider accepted means handoff was recorded;
        neither confirms email delivery. No sending, retry, or recipient changes are available here.
      </p>
      {snapshot ? (
        <div className="border-border-subtle mb-5 border-y py-4">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {(
              [
                ['Pending', snapshot.counts.pending],
                ['Sending', snapshot.counts.sending],
                ['Blocked', snapshot.counts.blocked],
                ['Quarantined', snapshot.counts.quarantined],
                ['Simulated', snapshot.counts.simulated],
                ['Provider accepted', snapshot.counts.accepted],
                ['Suppressed', snapshot.counts.suppressed],
                ['Aged pending', snapshot.counts.agedPending],
              ] as const
            ).map(([label, count]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-gray-dark">{label}</dt>
                <dd className="tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
          <p className="text-gray-warm mt-3 text-xs">
            Saved notification counts across all statuses. Sampled{' '}
            {operationDate(snapshot.sampledAt)}. Ages are measured when each page loads.
          </p>
        </div>
      ) : null}
      {query.isPending ? (
        <div role="status" aria-label="Loading review notifications">
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}
      {query.isError ? (
        <p role="alert" className="text-danger mb-4 text-sm">
          {query.error.message}
        </p>
      ) : null}
      {!query.isPending && !query.isError && items.length === 0 ? (
        <p className="border-border-light text-gray-dark rounded-card border border-dashed p-5 text-sm">
          No stored review notifications match this status. This does not confirm email delivery.
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="hairline-edge rounded-card divide-border-subtle divide-y bg-white">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-wrap items-start justify-between gap-4 p-4"
            >
              <div className="min-w-0 flex-1 basis-64">
                <h3 className="font-medium">{notificationPurposeLabels[item.purpose]}</h3>
                <p className="text-gray-dark mt-1 text-sm">
                  {notificationStateLabels[item.state]} ·{' '}
                  {notificationBindingLabels[item.recipientBinding]}
                </p>
                <p className="text-gray-warm mt-2 text-xs tabular-nums">
                  Age {notificationAge(item.ageSeconds)} · {item.attemptCount}{' '}
                  {item.attemptCount === 1 ? 'attempt' : 'attempts'} · Generation {item.generation}
                </p>
                <p className="text-gray-dark mt-2 break-words text-xs">
                  Reason: {notificationReason(item.reason)}
                </p>
                <p className="text-gray-warm mt-1 break-words text-xs">
                  Template: {item.templateVersion}
                </p>
                {item.ambiguous ? (
                  <p className="text-warning mt-2 text-sm">
                    Submission outcome is uncertain. Do not assume delivery.
                  </p>
                ) : null}
                <NotificationLinks item={item} />
              </div>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Inspect notification ${item.id}`}
                aria-expanded={selected === item.id}
                onClick={(event) => {
                  inspectButton.current = event.currentTarget;
                  setSelected(item.id);
                }}
              >
                Inspect
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          className="mt-4"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more notifications'}
        </Button>
      ) : null}
      {selected ? (
        <NotificationHistory
          key={selected}
          organizationId={organizationId}
          scope={scope}
          id={selected}
          onClose={() => {
            setSelected(null);
            inspectButton.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}

function NotificationLinks({ item }: { readonly item: NotificationRow }): React.ReactElement {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {item.claimId ? (
        <Link className="text-link" href={`/dashboard/claims/${encodeURIComponent(item.claimId)}`}>
          Open linked claim
        </Link>
      ) : null}
      {item.callId ? (
        <Link className="text-link" href={`/dashboard/calls/${encodeURIComponent(item.callId)}`}>
          Open linked call
        </Link>
      ) : null}
      {!item.claimId && !item.callId ? (
        <span className="text-gray-warm">No scoped claim or call link available.</span>
      ) : null}
    </div>
  );
}

function NotificationHistory({
  organizationId,
  scope,
  id,
  onClose,
}: Props & {
  readonly id: string;
  readonly onClose: () => void;
}): React.ReactElement {
  const query = useOperationNotificationDetail(organizationId, scope, id);
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    heading.current?.focus();
  }, []);
  const item = query.data?.notification;
  return (
    <section
      className="border-border-subtle mt-6 border-t pt-5"
      aria-labelledby="notification-history-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          ref={heading}
          tabIndex={-1}
          id="notification-history-heading"
          className="text-lg font-medium"
        >
          Notification history
        </h3>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Close history
        </Button>
      </div>
      {query.isPending ? (
        <div role="status" aria-label="Loading notification history">
          <Skeleton className="mt-4 h-28 w-full" />
        </div>
      ) : null}
      {query.isError ? (
        <p role="alert" className="text-danger mt-4 text-sm">
          {query.error.message}
        </p>
      ) : null}
      {item && query.data ? (
        <>
          <p className="text-gray-dark mt-3 text-sm">
            {notificationPurposeLabels[item.purpose]} · {notificationStateLabels[item.state]}
          </p>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {(
              [
                ['Notification ID', item.id],
                ['Purpose', item.purpose],
                ['Recipient binding', notificationBindingLabels[item.recipientBinding]],
                ['Reason code', notificationReason(item.reason)],
                ['Generation', String(item.generation)],
                ['Template', item.templateVersion],
                ['Inference run ID', item.inferenceRunId],
                ['Observation ID', item.observationId ?? 'Unavailable'],
                ['Created', operationDate(item.createdAt)],
                ['Updated', operationDate(item.updatedAt)],
                ['Available since', operationDate(item.availableAt)],
                ['First submission', operationDate(item.firstSubmissionAt)],
                ['Retry deadline', operationDate(item.retryDeadlineAt)],
                ['Lease expiry', operationDate(item.leaseExpiresAt)],
                ['Submission outcome', item.ambiguous ? 'Uncertain' : 'No ambiguity recorded'],
                ['Sampled', operationDate(query.data.sampledAt)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-gray-warm">{label}</dt>
                <dd className="mt-1 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <NotificationLinks item={item} />
          <h4 className="mt-6 font-medium">Attempt receipts</h4>
          <p className="text-gray-dark mt-2 text-sm">
            These saved receipts do not confirm delivery to an inbox.
          </p>
          {query.data.attempts.length === 0 ? (
            <p className="text-gray-warm mt-3 text-sm">No attempts recorded.</p>
          ) : (
            <ol className="divide-border-subtle mt-3 divide-y">
              {query.data.attempts.map((attempt) => (
                <li key={attempt.id} className="py-4 text-sm">
                  <p className="font-medium">Attempt {attempt.attemptNumber} · Synthetic</p>
                  <p className="text-gray-dark mt-1">
                    {attempt.receipt
                      ? `${attempt.receipt.outcome === 'ACCEPTED' ? 'Provider accepted' : attempt.receipt.outcome} · ${notificationReason(attempt.receipt.code)}`
                      : 'No outcome receipt recorded.'}
                  </p>
                  <dl className="text-gray-dark mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt>Started</dt>
                      <dd>{operationDate(attempt.startedAt)}</dd>
                    </div>
                    <div>
                      <dt>Lease expiry</dt>
                      <dd>{operationDate(attempt.leaseExpiresAt)}</dd>
                    </div>
                    {attempt.receipt ? (
                      <>
                        <div>
                          <dt>Completed</dt>
                          <dd>{operationDate(attempt.receipt.completedAt)}</dd>
                        </div>
                        <div>
                          <dt>Provider accepted at</dt>
                          <dd>{operationDate(attempt.receipt.acceptedAt)}</dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </section>
  );
}
