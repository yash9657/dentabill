'use client';

import { useAuth } from '@clerk/nextjs';
import { Badge, Button, Label } from '@dentabill/ui';
import Link from 'next/link';
import * as React from 'react';

import {
  readBatchFile,
  useRemittanceBatches,
  type BatchEvidence,
  type BatchPreview,
  type BatchReviewCommand,
  type BatchScope,
} from '../../../lib/remittance-batches/use-remittance-batches.js';

const BLOCKERS: Record<BatchPreview['blockers'][number], string> = {
  ALREADY_REVIEWED: 'This batch already has a recorded review.',
  INCOMPLETE_DETAIL:
    'The source detail is incomplete. Listed amounts do not establish the full batch total.',
  UNKNOWN_TOTALS:
    'One or more source header totals are unknown. Unknown amounts cannot be treated as zero.',
  TOTAL_MISMATCH: 'The listed amounts do not balance to the source header totals.',
  MEMBER_MISSING: 'A referenced claim remittance has not been imported.',
  MEMBER_NOT_ACCEPTED: 'A referenced claim remittance has not been accepted.',
  MEMBER_AMOUNT_MISMATCH: 'A listed claim amount differs from its accepted remittance evidence.',
  MEMBER_ALREADY_BATCHED:
    'A referenced claim remittance is already included in another accepted batch.',
};
const MEMBER_STATUS: Record<BatchPreview['members'][number]['status'], string> = {
  MISSING: 'Not imported',
  UNREVIEWED: 'Awaiting remittance review',
  REJECTED: 'Remittance rejected',
  AMOUNT_MISMATCH: 'Amount mismatch',
  ALREADY_BATCHED: 'Already in an accepted batch',
  MATCHED: 'Accepted remittance matched',
};

export function RemittanceBatchesPage(): React.ReactElement {
  const { userId, orgId, isLoaded } = useAuth();
  if (!isLoaded) return <p role="status">Loading remittance batches…</p>;
  if (!userId) return <p>Sign in to view remittance batches.</p>;
  const scope: BatchScope = [userId, orgId ?? null];
  return <BatchWorkspace key={JSON.stringify(scope)} scope={scope} />;
}

function BatchWorkspace({ scope }: { readonly scope: BatchScope }): React.ReactElement {
  const api = useRemittanceBatches(scope);
  const [selected, setSelected] = React.useState<BatchEvidence | null>(null);
  const [preview, setPreview] = React.useState<BatchPreview | null>(null);
  const [command, setCommand] = React.useState<BatchReviewCommand | null>(null);
  const [file, setFile] = React.useState<{ name: string; body: unknown } | null>(null);
  const [importUncertain, setImportUncertain] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const lock = React.useRef(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const previewRef = React.useRef<HTMLHeadingElement>(null);
  const fileId = React.useId();
  const uncertain = importUncertain || command !== null;
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
      const body = await readBatchFile(candidate);
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
        setSelected(result.data);
        setPreview(null);
        setNotice(
          'Batch source saved. Open a fresh preview to resolve its claim remittances before reviewing.',
        );
      } else if (result.kind === 'UNCERTAIN') {
        setImportUncertain(true);
        setMessage(
          'The import could not be confirmed. Retry the same file with its unchanged source identity and content.',
        );
      } else {
        setImportUncertain(false);
        setMessage(
          result.kind === 'STALE'
            ? 'This batch source identity conflicts with saved evidence. Nothing was overwritten. Corrections and revised batch uploads are not implemented yet; keep the original source identity.'
            : result.kind === 'DENIED'
              ? 'This account cannot import the batch. Check your access.'
              : 'The batch did not meet the import contract. Check source references, decimal-string amounts and adjustment signs, then choose a valid file. Corrections to saved batches are not implemented yet.',
        );
      }
    } finally {
      end();
    }
  };
  const openPreview = async (evidence: BatchEvidence): Promise<void> => {
    if (uncertain || !begin()) return;
    setSelected(evidence);
    setPreview(null);
    try {
      const result = await api.preview(evidence.id);
      if (result.kind === 'OK') {
        setSelected(result.data.evidence);
        setPreview(result.data);
      } else if (result.kind !== 'INACTIVE')
        setMessage('The batch preview could not be loaded. Open a fresh preview before deciding.');
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
            ? 'Batch evidence accepted. Claim reports and provider adjustments remain separate. No cash was created or allocated; bank cash receipt, posting and settlement remain unverified.'
            : 'Batch evidence rejected. Its source and review history are preserved.',
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
            ? 'Batch or claim remittance evidence changed before the review was recorded. Open a fresh preview and review it again.'
            : 'The review was not accepted. Check your access and open a fresh preview.',
        );
      }
    } finally {
      end();
    }
  };
  const batches = api.list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <header>
        <h1 className="font-body text-[28px] font-semibold leading-[1.15] text-black sm:text-[32px]">
          Remittance batches
        </h1>
        <p className="text-gray-dark mt-3 max-w-prose text-sm">
          Review payer batch totals alongside claim remittances and provider adjustments. A batch
          net amount is source evidence, not received cash. Acceptance does not post payments,
          allocate cash or establish settlement.
        </p>
      </header>
      <section
        aria-labelledby="batch-import-heading"
        className="border-border-subtle border-y py-5"
      >
        <h2 id="batch-import-heading" className="text-xl font-medium text-black">
          Import a batch source
        </h2>
        <p id={`${fileId}-help`} className="text-gray-dark mt-2 max-w-prose text-sm">
          Choose one custom version 1 JSON file up to 256 KiB. Reference claim remittances by their
          exact source namespace and record ID. This import does not parse an 835. Corrections and
          revised uploads for saved batches are not implemented yet; keep the original source
          identity.
        </p>
        <a
          href="/examples/synthetic-remittance-batch.json"
          download
          className="text-brand mt-3 inline-flex min-h-11 items-center text-sm font-medium underline"
        >
          Download synthetic example JSON
        </a>
        <p className="text-gray-dark mb-3 text-xs">
          Fake source IDs only. The example lists $100.00 + $80.00 in claim reports and a −$30.00
          adjustment, for a $150.00 net.
        </p>
        <Label htmlFor={fileId}>Payer remittance batch JSON</Label>
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
              {importUncertain ? 'Retry same import' : 'Import batch source'}
            </Button>
          </div>
        ) : null}
      </section>
      {busy ? (
        <p role="status" className="text-gray-dark text-sm">
          Confirming batch evidence…
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
      <section aria-labelledby="batch-inbox-heading">
        <h2 id="batch-inbox-heading" className="text-xl font-medium">
          Batch source inbox
        </h2>
        {api.list.isPending ? (
          <p role="status" className="mt-3 text-sm">
            Loading batch sources…
          </p>
        ) : null}
        {api.list.isError ? (
          <div className="mt-3">
            <p role="alert">Batch sources could not be loaded.</p>
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
        {api.list.isSuccess && batches.length === 0 ? (
          <p className="text-gray-dark mt-3 text-sm">
            No remittance batch evidence has been imported. Import a source above to compare its
            totals and review its claim references.
          </p>
        ) : null}
        <ol aria-label="Batch sources" className="divide-border-subtle mt-3 divide-y">
          {batches.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="break-words font-medium [overflow-wrap:anywhere]">
                  {item.payload.sourceBatchId}
                </p>
                <p className="text-gray-dark mt-1 break-words text-sm [overflow-wrap:anywhere]">
                  {item.payload.payerName} · {item.payload.sourceNamespace}
                </p>
                <p className="mt-2 text-sm tabular-nums">
                  Source net {money(item.payload.reportedNetAmount)} ·{' '}
                  {item.payload.detailCompleteness} detail
                </p>
                <p className="text-gray-dark mt-1 text-sm">{reviewLabel(item)}</p>
              </div>
              <Button
                variant="ghost"
                disabled={busy || uncertain}
                aria-label={`Preview batch ${item.payload.sourceBatchId}`}
                onClick={() => {
                  void openPreview(item);
                }}
              >
                Open preview
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
            Load more batches
          </Button>
        ) : null}
      </section>
      {selected ? (
        <article
          aria-labelledby="batch-evidence-heading"
          className="hairline-edge rounded-card min-w-0 bg-white p-5 sm:p-6"
        >
          <h2
            id="batch-evidence-heading"
            ref={previewRef}
            tabIndex={-1}
            className="break-words text-xl font-medium [overflow-wrap:anywhere]"
          >
            Batch {selected.payload.sourceBatchId}
          </h2>
          <Badge className="mt-3" variant="outline">
            {reviewLabel(selected)}
          </Badge>
          <p className="text-gray-dark mt-3 text-sm">
            Manual upload · Bank cash receipt: unverified · Posting: unverified · Settlement:
            unverified.
          </p>
          <BatchAmounts evidence={selected} preview={preview} />
          <SourceDetails evidence={selected} />
          <ClaimMembers evidence={selected} preview={preview} />
          <ProviderAdjustments evidence={selected} />
          {selected.review ? (
            <p className="text-gray-dark mt-5 text-sm">
              Reviewed {selected.review.createdAt} by {selected.review.reviewedByUserId} (
              {selected.review.reviewedByRole}). The recorded review preserves the resolved claim
              references and source totals.
            </p>
          ) : null}
          {preview ? (
            <section
              aria-label="Batch review preview"
              className="border-border-subtle mt-5 border-t pt-5"
            >
              <h3 className="font-medium">Review this batch evidence</h3>
              {preview.blockers.length ? (
                <ul
                  aria-label="Batch review blockers"
                  className="text-warning mt-4 space-y-2 text-sm"
                >
                  {preview.blockers.map((item) => (
                    <li key={item}>{BLOCKERS[item]}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-dark mt-3 max-w-prose text-sm">
                  Source totals balance and the explicitly referenced claim remittances are accepted
                  and available. Confirm the source identity, completeness and adjustment signs
                  before accepting.
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
                        Accept batch evidence
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy || importUncertain}
                        onClick={() => {
                          void decide('REJECT');
                        }}
                      >
                        Reject batch evidence
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
              Open fresh batch preview
            </Button>
          )}
        </article>
      ) : null}
    </div>
  );
}

function BatchAmounts({
  evidence,
  preview,
}: {
  readonly evidence: BatchEvidence;
  readonly preview: BatchPreview | null;
}): React.ReactElement {
  const p = evidence.payload;
  return (
    <section aria-label="Batch amounts" className="mt-5">
      <h3 className="font-medium">Source header totals</h3>
      <dl className="mt-3 grid gap-4 sm:grid-cols-3">
        <Value label="Reported claim amount" value={money(p.reportedClaimAmount)} />
        <Value label="Reported adjustment net effect" value={money(p.reportedAdjustmentAmount)} />
        <Value label="Reported batch net" value={money(p.reportedNetAmount)} />
      </dl>
      <h3 className="mt-5 font-medium">Listed detail totals</h3>
      {preview ? (
        <>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <Value label="Listed claim reports" value={money(preview.listedClaimAmount)} />
            <Value
              label="Listed provider adjustments"
              value={money(preview.listedAdjustmentAmount)}
            />
            <Value label="Calculated detail net" value={money(preview.calculatedNetAmount)} />
          </dl>
          <p className="text-gray-dark mt-3 text-sm">
            Detail calculation: {money(preview.listedClaimAmount)} + (
            {money(preview.listedAdjustmentAmount)}) = {money(preview.calculatedNetAmount)}. No part
            of this net is allocated to a claim.
          </p>
        </>
      ) : (
        <p className="text-gray-dark mt-2 text-sm">
          Open a fresh preview to calculate the listed detail and resolve claim references.
        </p>
      )}
      <p className="text-gray-dark mt-3 max-w-prose text-sm">
        Detail completeness: {p.detailCompleteness}. Positive provider adjustments increase the
        batch net; negative adjustments reduce it. Missing header amounts remain unknown. A partial
        list is not a full batch total.
      </p>
    </section>
  );
}
function SourceDetails({ evidence }: { readonly evidence: BatchEvidence }): React.ReactElement {
  const p = evidence.payload;
  const fields: readonly (readonly [string, string | null])[] = [
    ['Source namespace', p.sourceNamespace],
    ['Source batch ID', p.sourceBatchId],
    ['Source record ID', p.sourceRecordId],
    ['Source document ID', p.sourceDocumentId],
    ['Source version', p.sourceVersion],
    ['Payer name', p.payerName],
    ['Payer identifier', p.payerIdentifier],
    ['Payer identifier system', p.payerIdentifierSystem],
    ['Payee identifier', p.payeeIdentifier],
    ['Payee identifier system', p.payeeIdentifierSystem],
    ['Payment trace', p.paymentTrace],
    ['Trace type', p.paymentTraceType],
    ['Trace issuer', p.paymentTraceIssuer],
    ['Reported date', p.reportedDate],
    ['Raw source status', p.sourceStatus],
    ['Imported at', evidence.createdAt],
  ];
  return (
    <details className="border-border-subtle mt-5 border-t pt-4">
      <summary className="text-brand min-h-11 cursor-pointer text-sm font-medium">
        Inspect source identity and trace metadata
      </summary>
      <p className="text-gray-dark mb-3 max-w-prose text-sm">
        Trace metadata is preserved as supplied. It does not establish a bank match or a claim
        relationship.
      </p>
      <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([label, value]) => (
          <Value key={label} label={label} value={value ?? 'Not supplied'} />
        ))}
      </dl>
    </details>
  );
}
function ClaimMembers({
  evidence,
  preview,
}: {
  readonly evidence: BatchEvidence;
  readonly preview: BatchPreview | null;
}): React.ReactElement {
  return (
    <section
      aria-label="Claim remittance references"
      className="border-border-subtle mt-5 border-t pt-5"
    >
      <h3 className="font-medium">Claim remittance references</h3>
      <p className="text-gray-dark mt-2 max-w-prose text-sm">
        Only exact source namespace and record IDs resolve these members. Payment traces are not
        used to infer a match. Claim-reported amounts stay separate from provider adjustments.
      </p>
      {evidence.payload.claimRemittances.length === 0 ? (
        <p className="text-gray-dark mt-3 text-sm">No claim remittance references were supplied.</p>
      ) : (
        <ol className="divide-border-subtle mt-3 divide-y">
          {evidence.payload.claimRemittances.map((member) => {
            const resolved = preview?.members.find(
              (item) =>
                item.sourceNamespace === member.sourceNamespace &&
                item.sourceRecordId === member.sourceRecordId,
            );
            return (
              <li
                key={JSON.stringify([member.sourceNamespace, member.sourceRecordId])}
                className="min-w-0 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">
                    {member.sourceNamespace} / {member.sourceRecordId}
                  </p>
                  <p className="text-sm tabular-nums">{money(member.reportedAmount)}</p>
                </div>
                <p className="text-gray-dark mt-1 text-sm">
                  {resolved
                    ? MEMBER_STATUS[resolved.status]
                    : 'Open a fresh preview to resolve this reference.'}
                </p>
                {resolved?.claimId ? (
                  <Link
                    className="text-brand mt-2 inline-flex min-h-11 items-center break-all text-sm underline"
                    href={`/dashboard/claims/${encodeURIComponent(resolved.claimId)}`}
                  >
                    View claim {resolved.claimId}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
function ProviderAdjustments({
  evidence,
}: {
  readonly evidence: BatchEvidence;
}): React.ReactElement {
  return (
    <section aria-label="Provider adjustments" className="border-border-subtle mt-5 border-t pt-5">
      <h3 className="font-medium">Provider adjustments</h3>
      <p className="text-gray-dark mt-2 max-w-prose text-sm">
        These are provider-level source adjustments. They are not assigned to claim balances,
        collected cash or patient responsibility.
      </p>
      {evidence.payload.providerAdjustments.length === 0 ? (
        <p className="text-gray-dark mt-3 text-sm">No provider adjustments were supplied.</p>
      ) : (
        <ol className="divide-border-subtle mt-3 divide-y">
          {evidence.payload.providerAdjustments.map((item) => (
            <li key={item.sourceAdjustmentId} className="min-w-0 py-4">
              <h4 className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                {item.sourceAdjustmentId}
              </h4>
              <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <Value label="Canonical net effect (USD)" value={money(item.amount)} />
                <Value label="Original source amount (USD)" value={money(item.sourceAmount)} />
                <Value label="Source sign convention" value={item.sourceSignConvention} />
                <Value label="Raw code system" value={item.codeSystem} />
                <Value label="Raw reason code" value={item.reasonCode} />
                <Value label="Source reference" value={item.sourceReference ?? 'Not supplied'} />
                <Value
                  label="Provider identifier"
                  value={item.providerIdentifier ?? 'Not supplied'}
                />
                <Value label="Fiscal period end" value={item.fiscalPeriodEnd ?? 'Not supplied'} />
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
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
      <dd className="mt-1 break-words text-sm tabular-nums text-black [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}
function money(value: string | null): string {
  return value === null ? 'Unknown' : value.startsWith('-') ? `−$${value.slice(1)}` : `+$${value}`;
}
function reviewLabel(evidence: BatchEvidence): string {
  return evidence.review
    ? evidence.review.decision === 'ACCEPT'
      ? 'Accepted batch evidence'
      : 'Rejected batch evidence'
    : 'Awaiting human review';
}
