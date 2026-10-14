'use client';

import { useAuth } from '@clerk/nextjs';
import { Badge, Button, Input, Label } from '@dentabill/ui';
import Link from 'next/link';
import * as React from 'react';

import type { CashEvidence } from '../../../lib/cash-evidence/use-cash-evidence.js';
import {
  useCashReconciliations,
  validMatchAmount,
  type CashMatch,
  type MatchDecision,
  type MatchPreview,
  type ReconciliationScope,
  type ReleaseCandidate,
  type ReleaseCommand,
  type ReleasePreview,
} from '../../../lib/cash-reconciliations/use-cash-reconciliations.js';

const BLOCKERS: Record<MatchPreview['blockers'][number], string> = {
  CASH_NOT_ACCEPTED: 'The cash source revision has not been accepted.',
  CASH_NOT_CURRENT: 'The cash source revision is no longer current. Review its source history.',
  CASH_NOT_POSTED: 'Only source-posted cash records can be matched.',
  CASH_ZERO_AMOUNT: 'A zero cash source amount cannot be matched.',
  BATCH_NOT_ACCEPTED: 'The remittance batch has not been accepted.',
  BATCH_ZERO_NET: 'A zero-net batch cannot be matched to cash.',
  DIRECTION_MISMATCH: 'The cash source, batch net and proposed match must have the same sign.',
  CASH_CAPACITY_EXCEEDED: 'This match exceeds the cash source amount still available.',
  BATCH_CAPACITY_EXCEEDED: 'This match exceeds the batch net amount still available.',
  STALE_CASH_RESERVATION:
    'A related cash source revision still has an active reservation. Review and release that match before using a replacement.',
  SOURCE_LINK_LIMIT:
    'The related source history is too large for a new match. Existing matches can still be released.',
  CASH_IDENTITY_CONFLICT:
    'The related cash source identities conflict. Resolve the source relationship before making a new match.',
};
const REASONS: Record<ReleaseCandidate['reason'], string> = {
  WRONG_MATCH: 'Wrong source match',
  SOURCE_CHANGED: 'Source evidence changed',
  OTHER_REVIEWED_ERROR: 'Other reviewed error',
};
const selectClass =
  'border-border-light rounded-standard mt-2 block min-h-11 w-full min-w-0 border bg-white px-3 py-2 text-sm text-black disabled:opacity-50';

export function CashReconciliationsPage(): React.ReactElement {
  const { userId, orgId, isLoaded } = useAuth();
  if (!isLoaded) return <p role="status">Loading cash reconciliation…</p>;
  if (!userId) return <p>Sign in to view cash reconciliation.</p>;
  const scope: ReconciliationScope = [userId, orgId ?? null];
  return <ReconciliationWorkspace key={JSON.stringify(scope)} scope={scope} />;
}

function ReconciliationWorkspace({
  scope,
}: {
  readonly scope: ReconciliationScope;
}): React.ReactElement {
  const api = useCashReconciliations(scope);
  const [cashId, setCashId] = React.useState('');
  const [batchId, setBatchId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [preview, setPreview] = React.useState<MatchPreview | null>(null);
  const [matchCommand, setMatchCommand] = React.useState<MatchDecision | null>(null);
  const [releaseTarget, setReleaseTarget] = React.useState<CashMatch | null>(null);
  const [reason, setReason] = React.useState<ReleaseCandidate['reason'] | ''>('');
  const [releasePreview, setReleasePreview] = React.useState<ReleasePreview | null>(null);
  const [releaseCommand, setReleaseCommand] = React.useState<ReleaseCommand | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const lock = React.useRef(false);
  const previewRef = React.useRef<HTMLHeadingElement>(null);
  const releaseRef = React.useRef<HTMLHeadingElement>(null);
  const formId = React.useId();
  const uncertain = matchCommand !== null || releaseCommand !== null;
  const disabled = busy || uncertain;
  const cashSources = api.cash.data?.pages.flatMap((page) => page.items) ?? [];
  const batchSources = api.batches.data?.pages.flatMap((page) => page.items) ?? [];
  const matches = api.matches.data?.pages.flatMap((page) => page.items) ?? [];
  const selectedCash = cashSources
    .map((item) => item.currentAcceptedEvidence ?? item.latestEvidence)
    .find((item) => item.id === cashId);
  const selectedBatch = batchSources.find((item) => item.id === batchId);
  React.useEffect(() => {
    if (preview) previewRef.current?.focus();
  }, [preview]);
  React.useEffect(() => {
    if (releaseTarget || releasePreview) releaseRef.current?.focus();
  }, [releaseTarget, releasePreview]);
  const begin = (): boolean => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    setNotice(null);
    return true;
  };
  const end = (): void => {
    lock.current = false;
    if (api.isActive()) setBusy(false);
  };
  const editCandidate = (): void => {
    setPreview(null);
    setReleaseTarget(null);
    setReleasePreview(null);
    setMessage(null);
    setNotice(null);
  };
  const openPreview = async (): Promise<void> => {
    if (uncertain || !begin()) return;
    setPreview(null);
    setReleaseTarget(null);
    setReleasePreview(null);
    if (!selectedCash || !selectedBatch || !validMatchAmount(amount)) {
      setMessage(
        'Choose a cash source and a batch, then enter a nonzero signed USD amount with two decimal places, such as 150.00 or -30.00.',
      );
      end();
      return;
    }
    try {
      const result = await api.preview({
        cashEvidenceId: cashId,
        batchEvidenceId: batchId,
        amount,
      });
      if (result.kind === 'OK') setPreview(result.data);
      else if (result.kind !== 'INACTIVE')
        setMessage(
          result.kind === 'DENIED'
            ? 'The selected sources are unavailable to this account. Check your access and reload the source lists.'
            : 'The match preview could not be loaded. Check the selected sources and amount, then open a fresh preview.',
        );
    } finally {
      end();
    }
  };
  const recordMatch = async (): Promise<void> => {
    if (!preview || releaseCommand || !begin()) return;
    if (!matchCommand && preview.blockers.length > 0) {
      end();
      return;
    }
    const pending = matchCommand ?? {
      ...preview.candidate,
      reviewToken: preview.reviewToken,
      idempotencyKey: crypto.randomUUID(),
    };
    setMatchCommand(pending);
    try {
      const result = await api.match(pending);
      if (result.kind === 'INACTIVE') return;
      if (result.kind === 'OK') {
        setMatchCommand(null);
        setPreview(null);
        setNotice(
          'Match recorded. Its amount is reserved against the selected cash source and batch net. No money moved and no claim received a cash allocation. The match list shows current source status.',
        );
      } else if (result.kind === 'UNCERTAIN')
        setMessage(
          'The match could not be confirmed. Retry the same sources, amount, preview token and request key before doing other work.',
        );
      else {
        setMatchCommand(null);
        setPreview(null);
        void api.refresh();
        setMessage(
          result.kind === 'STALE'
            ? 'The sources or reservations changed before this match was recorded. Open a fresh preview and review it again.'
            : 'The match was not recorded. Check your access, sources and amount, then open a fresh preview.',
        );
      }
    } finally {
      end();
    }
  };
  const selectRelease = (item: CashMatch): void => {
    if (lock.current || uncertain) return;
    setReleaseTarget(item);
    setReason('');
    setReleasePreview(null);
    setPreview(null);
    setMessage(null);
    setNotice(null);
  };
  const previewRelease = async (): Promise<void> => {
    if (!releaseTarget || !reason || uncertain || !begin()) return;
    setReleasePreview(null);
    try {
      const result = await api.previewRelease(releaseTarget.id, { reason });
      if (result.kind === 'OK') setReleasePreview(result.data);
      else if (result.kind !== 'INACTIVE')
        setMessage(
          'The release preview could not be loaded. Check your access and open a fresh release preview.',
        );
    } finally {
      end();
    }
  };
  const releaseMatch = async (): Promise<void> => {
    if (!releasePreview || matchCommand || !begin()) return;
    if (!releaseCommand && !releasePreview.canRelease) {
      end();
      return;
    }
    const pending = releaseCommand ?? {
      matchId: releasePreview.match.id,
      body: {
        reason: releasePreview.reason,
        reviewToken: releasePreview.reviewToken,
        idempotencyKey: crypto.randomUUID(),
      },
    };
    setReleaseCommand(pending);
    try {
      const result = await api.release(pending);
      if (result.kind === 'INACTIVE') return;
      if (result.kind === 'OK') {
        setReleaseCommand(null);
        setReleasePreview(null);
        setReleaseTarget(null);
        setNotice(
          'Full match released. Its reservation is removed and its review history is preserved. This is not a refund or a transfer of funds.',
        );
      } else if (result.kind === 'UNCERTAIN')
        setMessage(
          'The release could not be confirmed. Retry the same match, reason, preview token and request key before doing other work.',
        );
      else {
        setReleaseCommand(null);
        setReleasePreview(null);
        void api.refresh();
        setMessage(
          result.kind === 'STALE'
            ? 'The match or reservations changed before this release was recorded. Open a fresh release preview and review it again.'
            : 'The release was not recorded. Check your access and open a fresh release preview.',
        );
      }
    } finally {
      end();
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <header>
        <h1 className="font-body text-[28px] font-semibold leading-[1.15] text-black sm:text-[32px]">
          Cash reconciliation
        </h1>
        <p className="text-gray-dark mt-3 max-w-prose text-sm">
          Review a manual link between accepted cash source evidence and an accepted remittance
          batch. Match only the amount supported by both sources. Bank verification, posting and
          settlement remain unverified; claim cash remains unallocated.
        </p>
      </header>
      <section
        aria-labelledby="match-source-heading"
        className="border-border-subtle border-y py-5"
      >
        <h2 id="match-source-heading" className="text-xl font-medium">
          Choose the source records
        </h2>
        <p className="text-gray-dark mt-2 max-w-prose text-sm">
          Source IDs identify the records. Matching payment traces do not select or verify a match.
          Account capacities stay separate; no combined bank balance is calculated.
        </p>
        <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor={`${formId}-cash`}>Reviewed cash source</Label>
            <select
              id={`${formId}-cash`}
              className={selectClass}
              value={cashId}
              disabled={disabled}
              onChange={(event) => {
                setCashId(event.target.value);
                editCandidate();
              }}
            >
              <option value="">Choose a cash source</option>
              {cashSources.map((item) => {
                const source = item.currentAcceptedEvidence ?? item.latestEvidence;
                return (
                  <option
                    key={item.id}
                    value={source.id}
                    disabled={source.review?.decision !== 'ACCEPT'}
                  >
                    {source.payload.sourceTransactionId} · Account {source.payload.sourceAccountId}{' '}
                    · {source.payload.sourceSystem}/{source.payload.sourceProduct}/
                    {source.payload.sourceNamespace} · {money(source.payload.amount)} ·{' '}
                    {source.payload.status} · {item.freshness}
                  </option>
                );
              })}
            </select>
            {api.cash.isPending ? (
              <p role="status" className="mt-2 text-sm">
                Loading cash sources…
              </p>
            ) : null}
            {api.cash.isError ? (
              <p role="alert" className="text-danger mt-2 text-sm">
                Cash sources could not be loaded. Loaded choices are preserved.
              </p>
            ) : null}
            {api.cash.isSuccess && cashSources.length === 0 ? (
              <p className="text-gray-dark mt-2 text-sm">No cash sources have been imported.</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                disabled={disabled || api.cash.isFetching}
                onClick={() => {
                  void api.cash.refetch();
                }}
              >
                Reload cash sources
              </Button>
              {api.cash.hasNextPage ? (
                <Button
                  variant="ghost"
                  disabled={disabled || api.cash.isFetching}
                  onClick={() => {
                    void api.cash.fetchNextPage();
                  }}
                >
                  Load more cash sources
                </Button>
              ) : null}
            </div>
            <Link
              href="/dashboard/cash-evidence"
              className="text-brand mt-1 inline-flex min-h-11 items-center text-sm underline"
            >
              Import or review cash evidence
            </Link>
            {selectedCash ? <CashSourceSummary evidence={selectedCash} /> : null}
          </div>
          <div className="min-w-0">
            <Label htmlFor={`${formId}-batch`}>Reviewed remittance batch</Label>
            <select
              id={`${formId}-batch`}
              className={selectClass}
              value={batchId}
              disabled={disabled}
              onChange={(event) => {
                setBatchId(event.target.value);
                editCandidate();
              }}
            >
              <option value="">Choose a remittance batch</option>
              {batchSources.map((item) => (
                <option key={item.id} value={item.id} disabled={item.review?.decision !== 'ACCEPT'}>
                  {item.payload.sourceBatchId} · {item.payload.sourceNamespace} ·{' '}
                  {item.payload.payerName} · Net {money(item.payload.reportedNetAmount)} ·{' '}
                  {item.review?.decision ?? 'UNREVIEWED'}
                </option>
              ))}
            </select>
            {api.batches.isPending ? (
              <p role="status" className="mt-2 text-sm">
                Loading batch sources…
              </p>
            ) : null}
            {api.batches.isError ? (
              <p role="alert" className="text-danger mt-2 text-sm">
                Batch sources could not be loaded. Loaded choices are preserved.
              </p>
            ) : null}
            {api.batches.isSuccess && batchSources.length === 0 ? (
              <p className="text-gray-dark mt-2 text-sm">
                No remittance batches have been imported.
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                disabled={disabled || api.batches.isFetching}
                onClick={() => {
                  void api.batches.refetch();
                }}
              >
                Reload batch sources
              </Button>
              {api.batches.hasNextPage ? (
                <Button
                  variant="ghost"
                  disabled={disabled || api.batches.isFetching}
                  onClick={() => {
                    void api.batches.fetchNextPage();
                  }}
                >
                  Load more batch sources
                </Button>
              ) : null}
            </div>
            <Link
              href="/dashboard/remittance-batches"
              className="text-brand mt-1 inline-flex min-h-11 items-center text-sm underline"
            >
              Import or review remittance batches
            </Link>
            {selectedBatch ? (
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <Value
                  label="Selected batch namespace"
                  value={selectedBatch.payload.sourceNamespace}
                />
                <Value
                  label="Selected batch source ID"
                  value={selectedBatch.payload.sourceBatchId}
                />
                <Value
                  label="Claim-reported header amount"
                  value={money(selectedBatch.payload.reportedClaimAmount)}
                />
                <Value
                  label="Provider adjustment header net effect"
                  value={money(selectedBatch.payload.reportedAdjustmentAmount)}
                />
                <Value
                  label="Selected batch net"
                  value={money(selectedBatch.payload.reportedNetAmount)}
                />
                <Value
                  label="Batch review"
                  value={selectedBatch.review?.decision ?? 'Not reviewed'}
                />
              </dl>
            ) : null}
          </div>
        </div>
        <div className="mt-6 max-w-sm">
          <Label htmlFor={`${formId}-amount`}>Signed match amount (USD)</Label>
          <Input
            id={`${formId}-amount`}
            className="mt-2"
            type="text"
            inputMode="text"
            autoComplete="off"
            aria-describedby={`${formId}-amount-help`}
            value={amount}
            disabled={disabled}
            placeholder="150.00 or -30.00"
            onChange={(event) => {
              setAmount(event.target.value);
              editCandidate();
            }}
          />
          <p id={`${formId}-amount-help`} className="text-gray-dark mt-2 text-sm">
            Use two decimal places. Positive matches link credits to positive batch nets; negative
            matches link debits to negative batch nets. Zero cannot be matched.
          </p>
        </div>
        <Button
          className="mt-4"
          disabled={disabled}
          onClick={() => {
            void openPreview();
          }}
        >
          Open fresh match preview
        </Button>
      </section>
      {busy ? (
        <p role="status" className="text-gray-dark text-sm">
          Confirming source and reservation state…
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="text-danger text-sm">
          {message}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-gray-dark text-sm">
          {notice}
        </p>
      ) : null}
      {preview ? (
        <article
          aria-labelledby="match-preview-heading"
          className="hairline-edge rounded-card min-w-0 bg-white p-5 sm:p-6"
        >
          <h2
            id="match-preview-heading"
            ref={previewRef}
            tabIndex={-1}
            className="text-xl font-medium"
          >
            Review proposed source match
          </h2>
          <p className="mt-3 font-medium tabular-nums">
            Proposed signed match: {money(preview.candidate.amount)}
          </p>
          <FinancialState />
          <Bindings cash={preview.cash} batch={preview.batch} />
          <section
            aria-label="Reservation capacity"
            className="border-border-subtle mt-5 border-t pt-5"
          >
            <h3 className="font-medium">Reservations and available amounts</h3>
            <p className="text-gray-dark mt-2 max-w-prose text-sm">
              These values are positive magnitudes before the proposed match. An active reservation
              survives a newer cash revision or a pending-to-posted replacement until explicitly
              released. The batch capacity uses its net after provider adjustments.
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Value
                label="Cash already reserved"
                value={magnitude(preview.capacity.cashReservedMagnitude)}
              />
              <Value
                label="Cash available before this match"
                value={magnitude(preview.capacity.cashAvailableMagnitude)}
              />
              <Value
                label="Batch already reserved"
                value={magnitude(preview.capacity.batchReservedMagnitude)}
              />
              <Value
                label="Batch available before this match"
                value={magnitude(preview.capacity.batchAvailableMagnitude)}
              />
            </dl>
          </section>
          <Blockers items={preview.blockers} />
          {preview.blockers.length === 0 ? (
            <p className="text-gray-dark mt-4 max-w-prose text-sm">
              Source and capacity checks allow this match. Confirm the account, source revisions,
              batch and amount. This records a manual evidence relationship; it does not move money
              or allocate the batch net to claims.
            </p>
          ) : null}
          <Button
            className="mt-4"
            disabled={
              busy || releaseCommand !== null || (!matchCommand && preview.blockers.length > 0)
            }
            onClick={() => {
              void recordMatch();
            }}
          >
            {matchCommand ? 'Retry same match' : 'Record reviewed match'}
          </Button>
        </article>
      ) : null}
      <section aria-labelledby="match-history-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="match-history-heading" className="text-xl font-medium">
            Recorded source matches
          </h2>
          <Button
            variant="ghost"
            disabled={disabled || api.matches.isFetching}
            onClick={() => {
              void api.matches.refetch();
            }}
          >
            Reload matches
          </Button>
        </div>
        <p className="text-gray-dark mt-2 max-w-prose text-sm">
          Currentness reflects the latest source evidence. Stale matches retain their reservations.
          Release the full match to correct an error, then preview a new match separately. Released
          records keep their history.
        </p>
        {api.matches.isPending ? (
          <p role="status" className="mt-3 text-sm">
            Loading recorded matches…
          </p>
        ) : null}
        {api.matches.isError ? (
          <p role="alert" className="text-danger mt-3 text-sm">
            Recorded matches could not be loaded. Use Reload matches; loaded history is preserved.
          </p>
        ) : null}
        {api.matches.isSuccess && matches.length === 0 ? (
          <p className="text-gray-dark mt-3 text-sm">No cash source matches have been recorded.</p>
        ) : null}
        <ol aria-label="Recorded source matches" className="divide-border-subtle mt-3 divide-y">
          {matches.map((item) => (
            <li key={item.id} className="min-w-0 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                  {item.cash.sourceTransactionId} → {item.batch.sourceBatchId}
                </h3>
                <Badge variant={item.status === 'STALE' ? 'warning' : 'outline'}>
                  {item.status === 'CURRENT'
                    ? 'Current source match'
                    : item.status === 'STALE'
                      ? 'Stale source · reservation retained'
                      : 'Released · reservation removed'}
                </Badge>
              </div>
              <p className="mt-2 text-sm tabular-nums">
                Matched {money(item.amount)} · Cash source sequence {item.cash.sourceSequence} ·
                Latest sequence {item.cash.latestSourceSequence}
              </p>
              <p className="text-gray-dark mt-2 break-words text-sm [overflow-wrap:anywhere]">
                Account {item.cash.sourceAccountId} · {item.cash.sourceSystem} /{' '}
                {item.cash.sourceProduct} / {item.cash.sourceNamespace}
              </p>
              <p className="text-gray-dark mt-1 break-words text-sm [overflow-wrap:anywhere]">
                Batch {item.batch.sourceBatchId} · {item.batch.sourceNamespace} ·{' '}
                {item.batch.payerName}
              </p>
              <details className="mt-3">
                <summary className="text-brand min-h-11 cursor-pointer text-sm font-medium">
                  Inspect matched source evidence
                </summary>
                <Bindings cash={item.cash} batch={item.batch} />
                <FinancialState />
                <p className="text-gray-dark mt-3 break-words text-sm [overflow-wrap:anywhere]">
                  Recorded {item.createdAt} by {item.reviewedByUserId} ({item.reviewedByRole}).
                  Review reference {item.id}.
                </p>
              </details>
              <Blockers items={item.blockers} />
              {item.release ? (
                <p className="text-gray-dark mt-3 text-sm">
                  Released {item.release.createdAt} · {REASONS[item.release.reason]} ·{' '}
                  {item.release.reviewedByUserId} ({item.release.reviewedByRole})
                </p>
              ) : (
                <Button
                  variant="ghost"
                  className="mt-3"
                  disabled={disabled}
                  aria-label={`Review release for ${item.cash.sourceTransactionId} to ${item.batch.sourceBatchId}`}
                  onClick={() => {
                    selectRelease(item);
                  }}
                >
                  Review full release
                </Button>
              )}
            </li>
          ))}
        </ol>
        {api.matches.hasNextPage ? (
          <Button
            variant="ghost"
            disabled={disabled || api.matches.isFetching}
            onClick={() => {
              void api.matches.fetchNextPage();
            }}
          >
            Load more matches
          </Button>
        ) : null}
      </section>
      {releaseTarget ? (
        <article
          aria-labelledby="release-heading"
          className="hairline-edge rounded-card min-w-0 bg-white p-5 sm:p-6"
        >
          <h2 id="release-heading" ref={releaseRef} tabIndex={-1} className="text-xl font-medium">
            Review full match release
          </h2>
          <p className="mt-3 break-words text-sm [overflow-wrap:anywhere]">
            {releaseTarget.cash.sourceTransactionId} → {releaseTarget.batch.sourceBatchId} ·{' '}
            {money(releaseTarget.amount)}
          </p>
          <p className="text-gray-dark mt-2 max-w-prose text-sm">
            Release removes the full reservation from this match. It preserves the source records
            and review history. It does not create a refund, reverse a bank transaction or allocate
            cash to claims.
          </p>
          <div className="mt-4 max-w-sm">
            <Label htmlFor={`${formId}-reason`}>Release reason</Label>
            <select
              id={`${formId}-reason`}
              className={selectClass}
              value={reason}
              disabled={disabled}
              onChange={(event) => {
                setReason(event.target.value as ReleaseCandidate['reason'] | '');
                setReleasePreview(null);
                setMessage(null);
              }}
            >
              <option value="">Choose the reviewed reason</option>
              {Object.entries(REASONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Button
            className="mt-4"
            variant="ghost"
            disabled={disabled || !reason}
            onClick={() => {
              void previewRelease();
            }}
          >
            Open fresh release preview
          </Button>
          {releasePreview ? (
            <section
              aria-label="Full release preview"
              className="border-border-subtle mt-5 border-t pt-5"
            >
              <h3 className="font-medium">Confirm the complete release</h3>
              <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                <Value
                  label="Signed match being released"
                  value={money(releasePreview.match.amount)}
                />
                <Value label="Reviewed release reason" value={REASONS[releasePreview.reason]} />
                <Value label="Cash source account" value={releaseTarget.cash.sourceAccountId} />
                <Value label="Batch source ID" value={releaseTarget.batch.sourceBatchId} />
              </dl>
              <FinancialState />
              {releasePreview.canRelease ? (
                <p className="text-gray-dark mt-3 text-sm">
                  The full reservation can be released even when its source match is stale.
                </p>
              ) : (
                <p className="text-gray-dark mt-3 text-sm">
                  This match has already been released. No further release is available.
                </p>
              )}
              <Button
                className="mt-4"
                disabled={
                  busy || matchCommand !== null || (!releaseCommand && !releasePreview.canRelease)
                }
                onClick={() => {
                  void releaseMatch();
                }}
              >
                {releaseCommand ? 'Retry same release' : 'Release full match'}
              </Button>
            </section>
          ) : null}
        </article>
      ) : null}
    </div>
  );
}

function CashSourceSummary({ evidence }: { readonly evidence: CashEvidence }): React.ReactElement {
  const p = evidence.payload;
  return (
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      <Value label="Selected account" value={p.sourceAccountId} />
      <Value label="Source transaction ID" value={p.sourceTransactionId} />
      <Value label="Selected cash source amount" value={money(p.amount)} />
      <Value label="Original cash source amount" value={money(p.sourceAmount)} />
      <Value label="Source sign convention" value={p.sourceSignConvention} />
      <Value
        label="Selected source status"
        value={`${p.status} · sequence ${String(p.sourceSequence)}`}
      />
    </dl>
  );
}
function Bindings({
  cash,
  batch,
}: {
  readonly cash: MatchPreview['cash'];
  readonly batch: MatchPreview['batch'];
}): React.ReactElement {
  return (
    <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-2">
      <section aria-label="Cash source binding" className="min-w-0">
        <h3 className="font-medium">Cash source evidence</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Value label="Account ID" value={cash.sourceAccountId} />
          <Value label="Transaction source ID" value={cash.sourceTransactionId} />
          <Value
            label="Source system / product"
            value={`${cash.sourceSystem} / ${cash.sourceProduct}`}
          />
          <Value label="Cash source namespace" value={cash.sourceNamespace} />
          <Value label="Cash source record ID" value={cash.sourceRecordId} />
          <Value label="Cash source document ID" value={cash.sourceDocumentId} />
          <Value label="Canonical cash amount" value={money(cash.amount)} />
          <Value label="Original source cash amount" value={money(cash.sourceAmount)} />
          <Value label="Original sign convention" value={cash.sourceSignConvention} />
          <Value label="Bound source status" value={cash.status} />
          <Value
            label="Source sequence / latest"
            value={`${String(cash.sourceSequence)} / ${String(cash.latestSourceSequence)}`}
          />
          <Value label="Cash source review" value={cash.reviewDecision ?? 'Not reviewed'} />
          <Value label="Cash payment trace" value={cash.paymentTrace ?? 'Not supplied'} />
          <Value
            label="Pending transaction source ID"
            value={cash.pendingSourceTransactionId ?? 'Not supplied'}
          />
        </dl>
      </section>
      <section aria-label="Batch source binding" className="min-w-0">
        <h3 className="font-medium">Remittance batch evidence</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Value label="Batch source ID" value={batch.sourceBatchId} />
          <Value label="Batch source namespace" value={batch.sourceNamespace} />
          <Value label="Batch source record ID" value={batch.sourceRecordId} />
          <Value label="Batch source document ID" value={batch.sourceDocumentId} />
          <Value label="Payer as supplied" value={batch.payerName} />
          <Value label="Claim-reported amount" value={money(batch.claimReportedAmount)} />
          <Value
            label="Provider adjustment net effect"
            value={money(batch.providerAdjustmentAmount)}
          />
          <Value label="Batch source net" value={money(batch.netAmount)} />
          <Value label="Batch source review" value={batch.reviewDecision ?? 'Not reviewed'} />
          <Value label="Batch payment trace" value={batch.paymentTrace ?? 'Not supplied'} />
        </dl>
      </section>
    </div>
  );
}
function FinancialState(): React.ReactElement {
  return (
    <p className="text-gray-dark mt-3 max-w-prose text-sm">
      Manual source review · Bank verification: unverified · Posting: unverified · Settlement:
      unverified · Claim cash: unallocated.
    </p>
  );
}
function Blockers({
  items,
}: {
  readonly items: MatchPreview['blockers'];
}): React.ReactElement | null {
  return items.length ? (
    <ul aria-label="Match blockers" className="text-warning mt-4 space-y-2 text-sm">
      {items.map((item) => (
        <li key={item}>{BLOCKERS[item]}</li>
      ))}
    </ul>
  ) : null;
}
function Value({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-gray-dark text-sm">{label}</dt>
      <dd className="mt-1 break-words text-sm tabular-nums text-black [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}
function money(value: string | null): string {
  return value === null ? 'Unknown' : value.startsWith('-') ? `−$${value.slice(1)}` : `+$${value}`;
}
function magnitude(value: string | null): string {
  return value === null ? 'Unknown' : `$${value}`;
}
