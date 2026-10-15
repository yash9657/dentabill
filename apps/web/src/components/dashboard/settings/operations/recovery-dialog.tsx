'use client';

import { Button, Skeleton } from '@dentabill/ui';
import Link from 'next/link';
import * as React from 'react';

import {
  deliveryErrorLabel,
  deliveryKindLabel,
  deliveryStateLabel,
  operationDate,
  recoveryExplanation,
} from '../../../../lib/operations/labels.js';
import {
  useRecoverDelivery,
  useRecoveryPreview,
} from '../../../../lib/operations/use-operations.js';

export function RecoveryDialog({
  organizationId,
  id,
  onClose,
}: {
  readonly organizationId: string;
  readonly id: string;
  readonly onClose: () => void;
}): React.ReactElement {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const query = useRecoveryPreview(organizationId, id);
  const mutation = useRecoverDelivery(organizationId, id);
  const [approvedVersion, setApprovedVersion] = React.useState<string | null>(null);
  const preview = query.data;
  React.useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = (): void => {
    dialog.current?.close();
    onClose();
  };
  const refresh = async (): Promise<void> => {
    setApprovedVersion(null);
    await query.refetch();
  };
  const submit = async (): Promise<void> => {
    if (
      !preview ||
      preview.action === 'BLOCKED' ||
      approvedVersion !== preview.reviewVersion ||
      mutation.isPending ||
      query.isFetching
    )
      return;
    setApprovedVersion(null);
    try {
      await mutation.mutateAsync({ action: preview.action, reviewVersion: approvedVersion });
    } catch {
      await refresh();
    }
  };
  const canApprove = preview && preview.action !== 'BLOCKED' && !query.isError;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="delivery-review-title"
      onCancel={(event) => {
        if (mutation.isPending) event.preventDefault();
        else onClose();
      }}
      className="rounded-card fixed inset-auto left-1/2 top-1/2 max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto border-0 bg-white p-6 text-black backdrop:bg-black/40"
    >
      <h2 id="delivery-review-title" className="text-xl font-medium">
        Review delivery
      </h2>
      <p className="text-gray-warm mt-2 break-all font-mono text-xs">{id}</p>
      {query.isPending ? (
        <Skeleton className="mt-6 h-48 w-full" aria-label="Loading delivery review" />
      ) : null}
      {query.isError ? (
        <p role="alert" className="text-danger mt-4 text-sm">
          {query.error.message}
        </p>
      ) : null}
      {preview ? (
        <>
          <dl className="border-border-subtle my-5 grid grid-cols-2 gap-x-6 gap-y-4 border-y py-5 text-sm">
            <Fact label="Request" value={deliveryKindLabel(preview.kind)} />
            <Fact label="Delivery status" value={deliveryStateLabel(preview.state)} />
            <Fact
              label="Attempts used"
              value={`${String(preview.deliveryAttempts)} of ${String(preview.deliveryAttemptLimit)}`}
            />
            <Fact label="Previous recoveries" value={String(preview.recoveryCount)} />
            <Fact label="Created" value={operationDate(preview.createdAt)} />
            <Fact label="Last changed" value={operationDate(preview.updatedAt)} />
            <Fact label="Available for delivery" value={operationDate(preview.availableAt)} />
            <Fact label="Attempt reserved until" value={operationDate(preview.leaseExpiresAt)} />
            <Fact label="Delivery received" value={operationDate(preview.deliveredAt)} />
            <Fact label="Closed after review" value={operationDate(preview.closedAt)} />
            <Fact
              className="col-span-2"
              label="Last delivery issue"
              value={deliveryErrorLabel(preview.lastErrorCode)}
            />
          </dl>
          <p className="text-gray-dark text-sm leading-relaxed">{recoveryExplanation(preview)}</p>
          {preview.followUp ? (
            <Link
              className="text-brand mt-4 inline-flex min-h-11 items-center font-medium underline underline-offset-4"
              href={
                preview.followUp.kind === 'CALL_OBSERVATION' && preview.followUp.callId
                  ? `/dashboard/calls/${encodeURIComponent(preview.followUp.callId)}`
                  : `/dashboard/claims/${encodeURIComponent(preview.followUp.claimId)}`
              }
            >
              {preview.followUp.kind === 'CALL_OBSERVATION' && preview.followUp.callId
                ? 'Open call status'
                : 'Open claim to check existing call'}
            </Link>
          ) : null}
          {canApprove ? (
            <label className="mt-5 flex items-start gap-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                className="accent-brand mt-1 h-4 w-4 shrink-0"
                checked={approvedVersion === preview.reviewVersion}
                disabled={mutation.isPending || query.isFetching}
                onChange={(event) => {
                  mutation.reset();
                  setApprovedVersion(event.target.checked ? preview.reviewVersion : null);
                }}
              />
              <span>I reviewed this delivery and the action described above.</span>
            </label>
          ) : null}
        </>
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="text-danger mt-4 text-sm">
          {mutation.error.message}
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <p role="status" className="text-gray-dark mt-4 text-sm">
          {mutation.variables.action === 'RETRY'
            ? 'Retry approved. The same request is awaiting delivery.'
            : 'Closed after review. No delivery was sent.'}
        </p>
      ) : null}
      <footer className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={mutation.isPending} onClick={close}>
          Done
        </Button>
        <Button
          variant="secondary"
          disabled={query.isFetching || mutation.isPending}
          onClick={() => {
            mutation.reset();
            void refresh();
          }}
        >
          {query.isFetching ? 'Refreshing…' : 'Refresh details'}
        </Button>
        {canApprove ? (
          <Button
            disabled={
              approvedVersion !== preview.reviewVersion || mutation.isPending || query.isFetching
            }
            onClick={() => {
              void submit();
            }}
          >
            {mutation.isPending
              ? 'Saving…'
              : preview.action === 'RETRY'
                ? 'Allow three more attempts'
                : 'Close after review'}
          </Button>
        ) : null}
      </footer>
    </dialog>
  );
}
function Fact({
  label,
  value,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly className?: string;
}): React.ReactElement {
  return (
    <div className={className}>
      <dt className="text-gray-warm text-xs">{label}</dt>
      <dd className="mt-1 break-words tabular-nums">{value}</dd>
    </div>
  );
}
