'use client';

import { useAuth } from '@clerk/nextjs';
import { Badge, Button, Label } from '@dentabill/ui';
import * as React from 'react';

import {
  readCashFile,
  useCashEvidence,
  type CashEvidence,
  type CashList,
  type CashPreview,
  type CashReviewCommand,
  type CashScope,
  type CashTransaction,
} from '../../../lib/cash-evidence/use-cash-evidence.js';

const BLOCKERS: Record<CashPreview['blockers'][number], string> = {
  ALREADY_REVIEWED: 'This revision already has a recorded review.',
  NEWER_SOURCE_EVIDENCE:
    'A newer source sequence exists. This older revision can be rejected but cannot be accepted.',
  POSTED_REPLACEMENT_OVERLAP:
    'More than one posted record refers to the same pending transaction. Resolve the source relationship before acceptance.',
  PENDING_LINK_CHANGED:
    'The pending transaction reference changed between revisions. The relationship needs manual resolution before acceptance.',
  SOURCE_LINK_LIMIT:
    'The related source history is too large for this review. It needs manual resolution before acceptance.',
};
const FRESHNESS: Record<CashTransaction['freshness'], string> = {
  CURRENT: 'Current accepted revision',
  STALE: 'Stale accepted revision · excluded',
  UNREVIEWED: 'No accepted revision · excluded',
};

export function CashEvidencePage(): React.ReactElement {
  const { userId, orgId, isLoaded } = useAuth();
  if (!isLoaded) return <p role="status">Loading cash evidence…</p>;
  if (!userId) return <p>Sign in to view cash evidence.</p>;
  const scope: CashScope = [userId, orgId ?? null];
  return <CashWorkspace key={JSON.stringify(scope)} scope={scope} />;
}

function CashWorkspace({ scope }: { readonly scope: CashScope }): React.ReactElement {
  const [transactionId, setTransactionId] = React.useState<string | null>(null);
  const api = useCashEvidence(scope, transactionId);
  const [selected, setSelected] = React.useState<CashEvidence | null>(null);
  const [preview, setPreview] = React.useState<CashPreview | null>(null);
  const [command, setCommand] = React.useState<CashReviewCommand | null>(null);
  const [file, setFile] = React.useState<{ name: string; body: unknown } | null>(null);
  const [importUncertain, setImportUncertain] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const lock = React.useRef(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const historyRef = React.useRef<HTMLHeadingElement>(null);
  const previewRef = React.useRef<HTMLHeadingElement>(null);
  const fileId = React.useId();
  const uncertain = importUncertain || command !== null;
  React.useEffect(() => {
    if (transactionId) historyRef.current?.focus();
  }, [transactionId]);
  React.useEffect(() => {
    if (preview) previewRef.current?.focus();
  }, [preview]);
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
  const choose = async (candidate: File | undefined): Promise<void> => {
    if (!candidate || uncertain || !begin()) return;
    try {
      const body = await readCashFile(candidate);
      if (api.isActive()) setFile({ name: candidate.name, body });
    } catch (error) {
      if (api.isActive()) {
        setFile(null);
        setMessage(error instanceof Error ? error.message : 'The JSON file could not be read.');
      }
    } finally {
      end();
    }
  };
  const upload = async (): Promise<void> => {
    if (!file || command || !begin()) return;
    try {
      const result = await api.importEvidence(file.body);
      if (result.kind === 'INACTIVE') return;
      if (result.kind === 'OK') {
        setImportUncertain(false);
        setFile(null);
        if (fileRef.current) fileRef.current.value = '';
        setTransactionId(result.data.transactionId);
        setSelected(result.data);
        setPreview(null);
        setNotice('Source revision saved. Open a fresh preview before accepting or rejecting it.');
      } else if (result.kind === 'UNCERTAIN') {
        setImportUncertain(true);
        setMessage(
          'The import could not be confirmed. Retry the same file with its unchanged source identity and content.',
        );
      } else {
        setImportUncertain(false);
        setMessage(
          result.kind === 'STALE'
            ? 'This source identity or sequence conflicts with saved evidence. Compare the original export; nothing was overwritten.'
            : result.kind === 'DENIED'
              ? 'This account cannot import the evidence. Check your access.'
              : 'The source record did not meet the import contract. Check its status, signed amounts, source sequence and references, then choose a corrected file.',
        );
      }
    } finally {
      end();
    }
  };
  const openHistory = (id: string): void => {
    if (lock.current || uncertain) return;
    setTransactionId(id);
    setSelected(null);
    setPreview(null);
    setMessage(null);
    setNotice(null);
  };
  const openPreview = async (evidence: CashEvidence): Promise<void> => {
    if (uncertain || !begin()) return;
    setSelected(evidence);
    setPreview(null);
    try {
      const result = await api.preview(evidence.id);
      if (result.kind === 'OK') {
        setSelected(result.data.evidence);
        setPreview(result.data);
      } else if (result.kind !== 'INACTIVE')
        setMessage('The source preview could not be loaded. Open a fresh preview before deciding.');
    } finally {
      end();
    }
  };
  const decide = async (decision?: 'ACCEPT' | 'REJECT'): Promise<void> => {
    if (!selected || !preview || importUncertain || !begin()) return;
    let pending = command;
    if (!pending) {
      if (
        !decision ||
        preview.evidence.review ||
        preview.blockers.includes('ALREADY_REVIEWED') ||
        (decision === 'ACCEPT' && preview.blockers.length > 0)
      ) {
        end();
        return;
      }
      pending = {
        evidenceId: selected.id,
        body: { decision, reviewToken: preview.reviewToken, idempotencyKey: crypto.randomUUID() },
      };
    }
    setCommand(pending);
    try {
      const result = await api.review(pending);
      if (result.kind === 'INACTIVE') return;
      if (result.kind === 'OK') {
        setCommand(null);
        setPreview(null);
        setSelected(result.data);
        setNotice(
          result.data.review?.decision === 'ACCEPT'
            ? 'Source revision accepted. Account totals include only current accepted posted records. Bank verification and settlement remain unverified.'
            : 'Source revision rejected. Its history is preserved; rejection does not restore a stale revision to the totals.',
        );
      } else if (result.kind === 'UNCERTAIN')
        setMessage(
          'The review could not be confirmed. Retry the same decision, preview token and request key.',
        );
      else {
        setCommand(null);
        setPreview(null);
        void api.refresh();
        setMessage(
          result.kind === 'STALE'
            ? 'Source evidence changed before the review was recorded. Open a fresh preview and review it again.'
            : 'The review was not accepted. Check your access and open a fresh preview.',
        );
      }
    } finally {
      end();
    }
  };
  const transactions = api.list.data?.pages.flatMap((page) => page.items) ?? [];
  const accounts = [
    ...new Map(
      (api.list.data?.pages.flatMap((page) => page.accounts) ?? []).map((account) => [
        JSON.stringify([
          account.sourceSystem,
          account.sourceProduct,
          account.sourceNamespace,
          account.sourceAccountId,
        ]),
        account,
      ]),
    ).values(),
  ];
  const history = api.history.data?.pages.flatMap((page) => page.items) ?? [];
  const context = api.history.data?.pages[0]?.transaction;
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <header>
        <h1 className="font-body text-[28px] font-semibold leading-[1.15] text-black sm:text-[32px]">
          Cash evidence
        </h1>
        <p className="text-gray-dark mt-3 max-w-prose text-sm">
          Import and review bank-account source records for your practice. These records are not yet
          linked to claims. Bank verification and settlement remain unverified; accepting a source
          revision does not move money.
        </p>
      </header>
      <section aria-labelledby="cash-import-heading" className="border-border-subtle border-y py-5">
        <h2 id="cash-import-heading" className="text-xl font-medium text-black">
          Import a source revision
        </h2>
        <p id={`${fileId}-help`} className="text-gray-dark mt-2 max-w-prose text-sm">
          Choose one custom version 1 JSON file up to 64 KiB containing a bank-account transaction.
          PMS deposits, remittances and transfer instructions are different records. Keep the
          original account and transaction IDs; source sequence must come from ordered source
          history, not upload time.
        </p>
        <a
          href="/examples/synthetic-cash-evidence.json"
          download
          className="text-brand mt-3 inline-flex min-h-11 items-center text-sm font-medium underline"
        >
          Download synthetic example JSON
        </a>
        <p className="text-gray-dark mb-3 text-xs">
          The example contains fake account and transaction IDs for testing only.
        </p>
        <Label htmlFor={fileId}>Bank-account transaction JSON</Label>
        <input
          ref={fileRef}
          id={fileId}
          aria-describedby={`${fileId}-help`}
          type="file"
          accept=".json,application/json"
          disabled={busy || uncertain}
          className="file:rounded-standard file:border-border-light mt-3 block min-h-11 w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:border file:bg-white file:px-3"
          onChange={(event) => {
            void choose(event.target.files?.[0]);
          }}
        />
        {file ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="min-w-0 break-all text-sm">{file.name}</span>
            <Button
              disabled={busy || command !== null}
              onClick={() => {
                void upload();
              }}
            >
              {importUncertain ? 'Retry same import' : 'Import source revision'}
            </Button>
          </div>
        ) : null}
      </section>
      {busy ? (
        <p role="status" className="text-gray-dark text-sm">
          Confirming source evidence…
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
      <section aria-labelledby="cash-accounts-heading">
        <h2 id="cash-accounts-heading" className="text-xl font-medium">
          Accounts on this page
        </h2>
        <p className="text-gray-dark mt-2 max-w-prose text-sm">
          Source-posted totals include all imported transactions for each account shown. Load more
          transactions to reach other accounts. Accounts stay separate by source system, product,
          database and account ID. Credits and debit magnitudes are shown separately; net is credits
          minus debits. Pending, removed, unknown, stale and unreviewed records are excluded. These
          are not verified bank balances.
        </p>
        <AccountSummaries accounts={accounts} />
      </section>
      <section aria-labelledby="cash-inbox-heading">
        <h2 id="cash-inbox-heading" className="text-xl font-medium">
          Source transaction inbox
        </h2>
        {api.list.isPending ? (
          <p role="status" className="mt-3 text-sm">
            Loading source transactions…
          </p>
        ) : null}
        {api.list.isError ? (
          <div className="mt-3">
            <p role="alert">Source transactions could not be loaded.</p>
            <Button
              variant="ghost"
              disabled={busy || uncertain || api.list.isFetching}
              onClick={() => {
                void api.list.refetch();
              }}
            >
              Retry inbox
            </Button>
          </div>
        ) : null}
        {api.list.isSuccess && transactions.length === 0 ? (
          <p className="text-gray-dark mt-3 text-sm">No bank-account evidence has been imported.</p>
        ) : null}
        <ol aria-label="Source transactions" className="divide-border-subtle mt-3 divide-y">
          {transactions.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="break-words font-medium [overflow-wrap:anywhere]">
                  {item.latestEvidence.payload.sourceTransactionId}
                </p>
                <p className="text-gray-dark mt-1 break-words text-sm [overflow-wrap:anywhere]">
                  Account {item.latestEvidence.payload.sourceAccountId} ·{' '}
                  {item.latestEvidence.payload.sourceSystem} /{' '}
                  {item.latestEvidence.payload.sourceProduct} /{' '}
                  {item.latestEvidence.payload.sourceNamespace}
                </p>
                <p className="mt-2 text-sm">
                  Latest source sequence {item.latestSourceSequence} ·{' '}
                  {item.latestEvidence.payload.status} · {money(item.latestEvidence.payload.amount)}
                </p>
                <p className="text-gray-dark mt-1 text-sm">{FRESHNESS[item.freshness]}</p>
              </div>
              <Button
                variant="ghost"
                disabled={busy || uncertain}
                aria-label={`View transaction ${item.latestEvidence.payload.sourceTransactionId} in account ${item.latestEvidence.payload.sourceAccountId}`}
                onClick={() => {
                  openHistory(item.id);
                }}
              >
                View source history
              </Button>
            </li>
          ))}
        </ol>
        {api.list.hasNextPage ? (
          <Button
            variant="ghost"
            disabled={busy || uncertain || api.list.isFetching}
            onClick={() => {
              void api.list.fetchNextPage();
            }}
          >
            Load more transactions
          </Button>
        ) : null}
      </section>
      {transactionId ? (
        <section
          aria-labelledby="cash-history-heading"
          className="border-border-subtle min-w-0 border-t pt-6"
        >
          <h2
            id="cash-history-heading"
            ref={historyRef}
            tabIndex={-1}
            className="text-xl font-medium"
          >
            Source revision history
          </h2>
          {context ? (
            <p className="text-gray-dark mt-2 text-sm">
              Highest source sequence: {context.latestSourceSequence}. Accepted sequence:{' '}
              {context.currentAcceptedEvidence?.payload.sourceSequence ?? 'none'}.{' '}
              {FRESHNESS[context.freshness]}. Upload time does not determine source order.
            </p>
          ) : null}
          {api.history.isPending ? <p role="status">Loading source history…</p> : null}
          {api.history.isError ? (
            <div>
              <p role="alert">Source history could not be loaded.</p>
              <Button
                variant="ghost"
                disabled={busy || uncertain || api.history.isFetching}
                onClick={() => {
                  void api.history.refetch();
                }}
              >
                Retry source history
              </Button>
            </div>
          ) : null}
          <ol aria-label="Source revisions" className="divide-border-subtle mt-3 divide-y">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    Sequence {item.payload.sourceSequence} · {item.payload.status} ·{' '}
                    {money(item.payload.amount)}
                  </p>
                  <p className="text-gray-dark mt-1 break-words text-sm [overflow-wrap:anywhere]">
                    Record {item.payload.sourceRecordId} ·{' '}
                    {item.review
                      ? item.review.decision === 'ACCEPT'
                        ? 'Accepted revision'
                        : 'Rejected revision'
                      : 'Awaiting review'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  disabled={busy || uncertain}
                  onClick={() => {
                    void openPreview(item);
                  }}
                  aria-label={`Preview source sequence ${String(item.payload.sourceSequence)}`}
                >
                  Open preview
                </Button>
              </li>
            ))}
          </ol>
          {api.history.hasNextPage ? (
            <Button
              variant="ghost"
              disabled={busy || uncertain || api.history.isFetching}
              onClick={() => {
                void api.history.fetchNextPage();
              }}
            >
              Load older revisions
            </Button>
          ) : null}
        </section>
      ) : null}
      {selected ? (
        <article
          aria-labelledby="cash-evidence-heading"
          className="hairline-edge rounded-card min-w-0 bg-white p-5 sm:p-6"
        >
          <h2
            id="cash-evidence-heading"
            ref={previewRef}
            tabIndex={-1}
            className="text-xl font-medium"
          >
            Source sequence {selected.payload.sourceSequence}
          </h2>
          <EvidenceDetails evidence={selected} />
          {preview ? (
            <section
              aria-label="Source review preview"
              className="border-border-subtle mt-5 border-t pt-5"
            >
              <h3 className="font-medium">Review this source revision</h3>
              <p className="text-gray-dark mt-2 text-sm">
                Highest observed source sequence: {preview.latestSourceSequence}. Current accepted
                sequence: {preview.currentAcceptedEvidence?.payload.sourceSequence ?? 'none'}.
              </p>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <Value
                  label="Current accepted source amount"
                  value={
                    preview.currentAcceptedEvidence
                      ? money(preview.currentAcceptedEvidence.payload.amount)
                      : 'No accepted revision'
                  }
                />
                <Value
                  label="Proposed source amount"
                  value={money(preview.evidence.payload.amount)}
                />
                <Value
                  label="Previously included amount"
                  value={included(preview.priorIncludedAmount)}
                />
                <Value
                  label="Proposed included amount"
                  value={included(preview.nextIncludedAmount)}
                />
              </dl>
              <p className="text-gray-dark mt-3 max-w-prose text-sm">
                An accepted newer revision replaces the older source revision; its amount is not
                added to the previous revision. A removal is not a refund. Missing amounts stay
                unknown.
              </p>
              {preview.blockers.length ? (
                <ul
                  aria-label="Source review blockers"
                  className="text-warning mt-4 space-y-2 text-sm"
                >
                  {preview.blockers.map((item) => (
                    <li key={item}>{BLOCKERS[item]}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-dark mt-3 text-sm">
                  Source checks allow this revision to be reviewed. Confirm its identity, ordering,
                  status and amounts before accepting.
                </p>
              )}
              {!preview.evidence.review && !preview.blockers.includes('ALREADY_REVIEWED') ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  {command ? (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        void decide();
                      }}
                    >
                      Retry same review
                    </Button>
                  ) : (
                    <>
                      <Button
                        disabled={busy || importUncertain || preview.blockers.length > 0}
                        onClick={() => {
                          void decide('ACCEPT');
                        }}
                      >
                        Accept source revision
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy || importUncertain}
                        onClick={() => {
                          void decide('REJECT');
                        }}
                      >
                        Reject source revision
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </section>
          ) : (
            <Button
              className="mt-4"
              variant="ghost"
              disabled={busy || uncertain}
              onClick={() => {
                void openPreview(selected);
              }}
            >
              Open fresh source preview
            </Button>
          )}
        </article>
      ) : null}
    </div>
  );
}

function AccountSummaries({
  accounts,
}: {
  readonly accounts: CashList['accounts'];
}): React.ReactElement {
  if (!accounts.length)
    return (
      <p className="text-gray-dark mt-3 text-sm">
        Account totals appear after source records are imported.
      </p>
    );
  return (
    <>
      <ol aria-label="Account source totals" className="divide-border-subtle mt-3 divide-y">
        {accounts.map((account) => (
          <li
            key={JSON.stringify([
              account.sourceSystem,
              account.sourceProduct,
              account.sourceNamespace,
              account.sourceAccountId,
            ])}
            className="min-w-0 py-4"
          >
            <h3 className="break-words font-medium [overflow-wrap:anywhere]">
              Account {account.sourceAccountId}
            </h3>
            <p className="text-gray-dark mt-1 break-words text-sm [overflow-wrap:anywhere]">
              {account.sourceSystem} / {account.sourceProduct} / {account.sourceNamespace}
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              <Value label="Posted credits" value={money(account.postedCreditAmount)} />
              <Value label="Posted debits (magnitude)" value={money(account.postedDebitAmount)} />
              <Value label="Posted net" value={money(account.postedNetAmount)} />
            </dl>
            <p className="text-gray-dark mt-3 text-sm">
              {account.transactionCount} source transactions · {account.postedCount} posted ·{' '}
              {account.pendingCount} pending · {account.removedCount} removed ·{' '}
              {account.unknownCount} unknown
            </p>
            <p className="text-gray-dark mt-1 text-sm">
              {account.staleCount} stale · {account.unreviewedCount} without an accepted revision ·{' '}
              {account.reviewNeededCount} need review
            </p>
          </li>
        ))}
      </ol>
    </>
  );
}

function EvidenceDetails({ evidence }: { readonly evidence: CashEvidence }): React.ReactElement {
  const p = evidence.payload;
  const fields: readonly (readonly [string, string | null])[] = [
    ['Canonical signed amount (USD)', money(p.amount)],
    ['Original source amount (USD)', money(p.sourceAmount)],
    ['Source sign convention', p.sourceSignConvention],
    ['Source status category', p.status],
    ['Source system', p.sourceSystem],
    ['Source product', p.sourceProduct],
    ['Source database', p.sourceNamespace],
    ['Source account ID', p.sourceAccountId],
    ['Source transaction ID', p.sourceTransactionId],
    ['Source record ID', p.sourceRecordId],
    ['Source document ID', p.sourceDocumentId],
    ['Source version', p.sourceVersion],
    ['Observed at source', p.observedAt],
    ['Imported at', evidence.createdAt],
    ['Transaction date', p.transactionDate],
    ['Posting date', p.postingDate],
    ['Counterparty as supplied', p.counterpartyName],
    ['Payment trace', p.paymentTrace],
    ['Raw source status', p.sourceStatus],
    ['Source description', p.sourceDescription],
    ['Pending source transaction ID', p.pendingSourceTransactionId],
  ];
  return (
    <>
      <Badge className="mt-3" variant="outline">
        {evidence.review
          ? evidence.review.decision === 'ACCEPT'
            ? 'Accepted source revision'
            : 'Rejected source revision'
          : 'Awaiting human review'}
      </Badge>
      <p className="text-gray-dark mt-3 text-sm">
        Manual upload · Bank verification: unverified · Settlement: unverified. Canonical positive
        amounts represent credits; negative amounts represent debits. Source signs are preserved
        separately.
      </p>
      {p.status === 'REMOVED' ? (
        <p className="text-warning mt-3 text-sm">
          The source marks this transaction removed. This is not evidence of a refund; no amount is
          inferred.
        </p>
      ) : null}
      <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([label, value]) => (
          <Value key={label} label={label} value={value ?? 'Not supplied'} />
        ))}
      </dl>
    </>
  );
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
      <dd className="mt-1 break-words text-sm text-black [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
function money(value: string | null): string {
  return value === null ? 'Unknown' : value.startsWith('-') ? `-$${value.slice(1)}` : `$${value}`;
}
function included(value: string | null): string {
  return value === null ? 'Excluded from source-posted totals' : money(value);
}
