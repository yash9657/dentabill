'use client';

import { useAuth } from '@clerk/nextjs';
import { Badge, Button, Label } from '@dentabill/ui';
import * as React from 'react';

import {
  readRemittanceFile,
  useRemittances,
  type RemittanceEvidence,
  type RemittanceList,
  type RemittancePreview,
  type RemittanceScope,
  type ReviewCommand,
} from '../../../lib/claims/use-remittances.js';

const BLOCKERS: Record<RemittancePreview['blockers'][number], string> = {
  ALREADY_REVIEWED: 'This evidence already has a recorded review.',
  SOURCE_LINE_MISSING: 'A source procedure line could not be matched to this claim.',
  SOURCE_COVERAGE_MISSING: 'The source coverage could not be matched to this claim.',
  ORIGINAL_MISSING: 'The original payment report for this reversal is missing.',
  ORIGINAL_NOT_ACCEPTED: 'The original payment report has not been accepted.',
  REVERSAL_TARGET_MISMATCH: 'The reversal does not match the original report’s source or coverage.',
  REVERSAL_EXCEEDS_REMAINING: 'The reversal exceeds the amount remaining on the original report.',
  REVERSAL_ADJUSTMENT_MISMATCH: 'The reversal adjustments do not match the original report.',
};

export function ClaimRemittances({ claimId }: { readonly claimId: string }): React.ReactElement {
  const { userId, orgId, isLoaded } = useAuth();
  if (!isLoaded)
    return (
      <p role="status" className="text-gray-dark text-sm">
        Loading remittance evidence…
      </p>
    );
  if (!userId)
    return <p className="text-gray-dark text-sm">Sign in to view remittance evidence.</p>;
  const scope: RemittanceScope = [claimId, userId, orgId ?? null];
  return <RemittanceWorkspace key={JSON.stringify(scope)} scope={scope} />;
}

function RemittanceWorkspace({ scope }: { readonly scope: RemittanceScope }): React.ReactElement {
  const api = useRemittances(scope);
  const lock = React.useRef(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const fileId = React.useId();
  const [busy, setBusy] = React.useState(false);
  const [file, setFile] = React.useState<{ name: string; body: unknown } | null>(null);
  const [importUncertain, setImportUncertain] = React.useState(false);
  const [selected, setSelected] = React.useState<RemittanceEvidence | null>(null);
  const [preview, setPreview] = React.useState<RemittancePreview | null>(null);
  const [reviewCommand, setReviewCommand] = React.useState<ReviewCommand | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const uncertain = importUncertain || reviewCommand !== null;
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
  const chooseFile = async (candidate: File | undefined): Promise<void> => {
    if (!candidate || uncertain || !begin()) return;
    try {
      const body = await readRemittanceFile(candidate);
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
    if (!file || reviewCommand || !begin()) return;
    try {
      const result = await api.importEvidence(file.body);
      if (result.kind === 'INACTIVE') return;
      if (result.kind === 'OK') {
        setImportUncertain(false);
        setFile(null);
        setSelected(result.data);
        setPreview(null);
        if (fileRef.current) fileRef.current.value = '';
        setNotice('Evidence saved. Open a fresh preview to review its source mappings.');
      } else if (result.kind === 'UNCERTAIN') {
        setImportUncertain(true);
        setMessage(
          'The import could not be confirmed. Retry the same file; its source identity and content will stay unchanged.',
        );
      } else {
        setImportUncertain(false);
        setMessage(
          result.kind === 'STALE'
            ? 'This source record conflicts with saved evidence. Compare the original source record; this import did not overwrite it.'
            : result.kind === 'DENIED'
              ? 'This evidence could not be imported for the current account and claim. Check your access.'
              : 'The remittance JSON did not meet the import contract. Check the export and choose a corrected file.',
        );
      }
    } finally {
      end();
    }
  };
  const select = async (evidence: RemittanceEvidence): Promise<void> => {
    if (uncertain || !begin()) return;
    setSelected(evidence);
    setPreview(null);
    try {
      const result = await api.preview(evidence.id);
      if (result.kind === 'OK') {
        setSelected(result.data.evidence);
        setPreview(result.data);
      } else if (result.kind !== 'INACTIVE')
        setMessage('The review preview could not be loaded. Open a fresh preview before deciding.');
    } finally {
      end();
    }
  };
  const review = async (decision?: 'ACCEPT' | 'REJECT'): Promise<void> => {
    if (importUncertain || !selected || !preview || !begin()) return;
    const alreadyReviewed =
      preview.evidence.review !== null || preview.blockers.includes('ALREADY_REVIEWED');
    if (
      !reviewCommand &&
      (!decision || alreadyReviewed || (decision === 'ACCEPT' && preview.blockers.length > 0))
    ) {
      end();
      return;
    }
    let command = reviewCommand;
    if (!command) {
      if (!decision) {
        end();
        return;
      }
      command = {
        evidenceId: selected.id,
        body: { decision, reviewToken: preview.reviewToken, idempotencyKey: crypto.randomUUID() },
      };
    }
    setReviewCommand(command);
    try {
      const result = await api.review(command);
      if (result.kind === 'INACTIVE') return;
      if (result.kind === 'OK') {
        setReviewCommand(null);
        setPreview(null);
        setSelected(result.data);
        setNotice(
          result.data.review?.decision === 'ACCEPT'
            ? 'Reported evidence accepted into the local reviewed totals. Cash, posting and settlement remain unverified.'
            : 'Evidence rejected. It is preserved in the history and excluded from reviewed totals.',
        );
      } else if (result.kind === 'STALE') {
        setReviewCommand(null);
        setPreview(null);
        void api.refresh();
        setMessage(
          'The evidence or claim changed before the review was recorded. Open a fresh preview and review it again.',
        );
      } else if (result.kind === 'UNCERTAIN') {
        setMessage(
          'The review could not be confirmed. Retry the same review; the decision, token and request key will stay unchanged.',
        );
      } else {
        setReviewCommand(null);
        setPreview(null);
        setMessage(
          'The review was not accepted. Check your access and open a fresh preview before trying again.',
        );
      }
    } finally {
      end();
    }
  };
  const items = api.query.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = api.query.data?.pages[0]?.summary;
  return (
    <section aria-labelledby="remittance-heading" className="flex min-w-0 flex-col gap-5">
      <header>
        <h2 id="remittance-heading" className="text-2xl font-medium text-black">
          Remittance evidence
        </h2>
        <p className="text-gray-dark mt-2 max-w-prose text-sm">
          Payer-reported payment and reversal records for this claim. Cash receipt, posting and
          settlement are unverified. Accepting evidence changes only the local reviewed totals; it
          does not move money or submit a claim.
        </p>
      </header>
      {summary ? <ReportedSummary summary={summary} /> : null}
      <div className="border-border-subtle border-y py-5">
        <Label htmlFor={fileId}>Import remittance JSON</Label>
        <p id={`${fileId}-help`} className="text-gray-dark mt-2 max-w-prose text-sm">
          Choose one custom version 1 JSON file up to 1 MiB. Use the original source database,
          document and record IDs. This importer does not accept native 835 files or bank
          statements. Payments may be positive or zero; reversals name the original source record.
        </p>
        <input
          ref={fileRef}
          id={fileId}
          type="file"
          accept=".json,application/json"
          className="file:rounded-standard file:border-border-light mt-3 block min-h-11 w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:border file:bg-white file:px-3 file:text-black"
          aria-describedby={`${fileId}-help`}
          disabled={busy || uncertain}
          onChange={(event) => {
            void chooseFile(event.target.files?.[0]);
          }}
        />
        {file ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-gray-dark min-w-0 break-all text-sm">{file.name}</span>
            <Button
              type="button"
              disabled={busy || reviewCommand !== null}
              onClick={() => {
                void upload();
              }}
            >
              {importUncertain ? 'Retry same import' : 'Import evidence'}
            </Button>
          </div>
        ) : null}
      </div>
      {busy ? (
        <p role="status" className="text-gray-dark text-sm">
          Confirming remittance evidence…
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
      {api.query.isPending ? (
        <p role="status" className="text-gray-dark text-sm">
          Loading remittance records…
        </p>
      ) : null}
      {api.query.isError ? (
        <div>
          <p role="alert" className="text-danger text-sm">
            Remittance evidence could not be loaded.
          </p>
          <Button
            type="button"
            variant="ghost"
            disabled={busy || uncertain || api.query.isFetching}
            onClick={() => {
              void api.query.refetch();
            }}
          >
            Retry remittance list
          </Button>
        </div>
      ) : null}
      {items.length === 0 && api.query.isSuccess ? (
        <p className="text-gray-dark text-sm">
          No remittance evidence has been imported for this claim.
        </p>
      ) : null}
      {items.length > 0 ? (
        <ol aria-label="Remittance records" className="divide-border-subtle divide-y">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="break-words font-medium text-black [overflow-wrap:anywhere]">
                  {item.payload.sourceRecordId}
                </p>
                <p className="text-gray-dark mt-1 text-sm">
                  {item.payload.kind === 'REVERSAL' ? 'Reversal report' : 'Payment report'} ·{' '}
                  {money(item.payload.reportedAmount)} ·{' '}
                  {item.review
                    ? item.review.decision === 'ACCEPT'
                      ? 'Accepted'
                      : 'Rejected'
                    : 'Pending review'}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || uncertain}
                onClick={() => {
                  void select(item);
                }}
                aria-label={`Preview remittance ${item.payload.sourceRecordId}`}
              >
                Open preview
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      {api.query.hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          disabled={busy || uncertain || api.query.isFetching}
          onClick={() => {
            void api.query.fetchNextPage();
          }}
        >
          Load more remittances
        </Button>
      ) : null}
      {selected ? (
        <article
          className="hairline-edge rounded-card min-w-0 bg-white p-5 sm:p-6"
          aria-labelledby="selected-remittance-heading"
        >
          <h3
            id="selected-remittance-heading"
            className="break-words text-xl font-medium text-black [overflow-wrap:anywhere]"
          >
            Evidence: {selected.payload.sourceRecordId}
          </h3>
          <EvidenceDetails key={selected.id} evidence={selected} />
          {preview ? (
            <PreviewDetails
              key={`${preview.evidence.id}:${preview.reviewToken}`}
              preview={preview}
            />
          ) : (
            <Button
              className="mt-4"
              type="button"
              variant="ghost"
              disabled={busy || uncertain}
              onClick={() => {
                void select(selected);
              }}
            >
              Open fresh preview
            </Button>
          )}
          {preview && !preview.evidence.review && !preview.blockers.includes('ALREADY_REVIEWED') ? (
            <div className="border-border-subtle mt-5 border-t pt-5">
              <p className="text-gray-dark max-w-prose text-sm">
                Review the source, mappings and signed amounts before deciding. Acceptance includes
                this report in reviewed totals; it does not confirm cash, posting or settlement.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                {reviewCommand ? (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void review();
                    }}
                  >
                    Retry same review
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      disabled={busy || importUncertain || preview.blockers.length > 0}
                      onClick={() => {
                        void review('ACCEPT');
                      }}
                    >
                      Accept reported evidence
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy || importUncertain}
                      onClick={() => {
                        void review('REJECT');
                      }}
                    >
                      Reject evidence
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

function ReportedSummary({
  summary,
}: {
  readonly summary: RemittanceList['summary'];
}): React.ReactElement {
  return (
    <div>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
        <Value label="Net accepted payer reports" value={money(summary.reviewedReportedAmount)} />
        <Value label="Allocated portion" value={money(summary.allocatedAmount)} />
        <Value label="Unallocated portion" value={money(summary.unallocatedAmount)} />
      </dl>
      <p className="text-gray-dark mt-3 max-w-prose text-sm">
        Allocated and unallocated portions make up the net accepted reports; they are not additional
        payments. Unallocated means no procedure allocation was supplied for that portion, not an
        outstanding or unpaid balance.
      </p>
      <p className="text-gray-dark mt-2 text-sm">
        {summary.pendingCount} pending · {summary.acceptedCount} accepted · {summary.rejectedCount}{' '}
        rejected. Cash receipt: unverified · Posting: unverified · Settlement: unverified.
      </p>
      {summary.lines.length > 0 ? (
        <details className="mt-3">
          <summary className="text-brand min-h-11 cursor-pointer content-center text-sm font-medium">
            Reviewed procedure allocations
          </summary>
          <PagedRows
            label="Reviewed procedure allocations"
            rows={summary.lines}
            rowKey={(line) => line.lineId}
            render={(line) => (
              <>
                <p className="font-mono text-sm text-black">
                  {line.procedureCode} · {money(line.amount)}
                </p>
                <p className="text-gray-dark break-words text-sm [overflow-wrap:anywhere]">
                  Source line {line.sourceLineId} · Tooth {line.tooth ?? 'not supplied'} · Mapped
                  line {line.lineId}
                </p>
              </>
            )}
          />
        </details>
      ) : null}
    </div>
  );
}

function EvidenceDetails({
  evidence,
}: {
  readonly evidence: RemittanceEvidence;
}): React.ReactElement {
  const p = evidence.payload;
  const fields: readonly (readonly [string, string | null | undefined])[] = [
    ['Reported amount', money(p.reportedAmount)],
    ['Kind', p.kind],
    ['Source database', p.sourceNamespace],
    ['Source document ID', p.sourceDocumentId],
    ['Source record ID', p.sourceRecordId],
    ['Source version', p.sourceVersion],
    ['Payer', p.payerName],
    ['Payer identifier', p.payerIdentifier],
    ['Payer identifier system', p.payerIdentifierSystem],
    ['Payer claim control number', p.payerClaimControlNumber],
    ['Source coverage ID', p.sourceCoverageId],
    ['Payment trace', p.paymentTrace],
    ['Trace type', p.paymentTraceType],
    ['Trace issuer', p.paymentTraceIssuer],
    ['Reported date', p.reportedDate],
    ['Source status', p.sourceStatus],
    ['Line detail completeness', p.lineDetailCompleteness],
    ['Original source record ID', p.reversesSourceRecordId],
  ];
  return (
    <>
      <div className="mt-3">
        <Badge variant="outline">
          {evidence.review
            ? evidence.review.decision === 'ACCEPT'
              ? 'Accepted local evidence'
              : 'Rejected local evidence'
            : 'Pending human review'}
        </Badge>
      </div>
      <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([label, value]) => (
          <Value key={label} label={label} value={value ?? 'Not supplied'} />
        ))}
      </dl>
      <details className="mt-3">
        <summary className="text-brand min-h-11 cursor-pointer content-center text-sm font-medium">
          Source allocations and raw adjustments
        </summary>
        <h4 className="mt-3 font-medium text-black">Source allocations</h4>
        <PagedRows
          label="Source allocations"
          rows={p.allocations}
          rowKey={(row) => row.sourceLineId}
          render={(row) => (
            <dl className="grid gap-3 sm:grid-cols-2">
              <Value label="Source line ID" value={row.sourceLineId} />
              <Value label="Reported allocation" value={money(row.amount)} />
              <Value label="Source status" value={row.sourceStatus ?? 'Not supplied'} />
            </dl>
          )}
        />
        <h4 className="mt-5 font-medium text-black">Raw adjustments</h4>
        <p className="text-gray-dark mt-1 text-sm">
          Codes and signs are shown as supplied. No denial, write-off or patient liability is
          inferred.
        </p>
        <PagedRows
          label="Raw adjustments"
          rows={p.adjustments}
          rowKey={(row) => row.sourceAdjustmentId}
          render={(row) => (
            <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Value label="Source adjustment ID" value={row.sourceAdjustmentId} />
              <Value label="Source line ID" value={row.sourceLineId ?? 'Not supplied'} />
              <Value label="Code system" value={row.codeSystem} />
              <Value label="Group code" value={row.groupCode ?? 'Not supplied'} />
              <Value label="Reason code" value={row.reasonCode} />
              <Value label="Signed adjustment" value={money(row.amount)} />
              <Value label="Source reference" value={row.sourceReference ?? 'Not supplied'} />
            </dl>
          )}
        />
      </details>
    </>
  );
}

function PreviewDetails({ preview }: { readonly preview: RemittancePreview }): React.ReactElement {
  return (
    <section aria-label="Review preview" className="border-border-subtle mt-5 border-t pt-5">
      <h4 className="font-medium text-black">Review preview</h4>
      <p className="text-gray-dark mt-2 text-sm">
        Unallocated portion: {money(preview.unallocatedAmount)}. This is a reporting residual, not
        the amount unpaid or outstanding.
      </p>
      {preview.remainingOriginalAmount !== null ? (
        <p className="text-gray-dark mt-2 text-sm">
          Remaining original accepted report: {money(preview.remainingOriginalAmount)}.
        </p>
      ) : null}
      {preview.originalEvidenceId ? (
        <p className="text-gray-dark mt-1 break-words text-sm [overflow-wrap:anywhere]">
          Original evidence ID: {preview.originalEvidenceId}
        </p>
      ) : null}
      {preview.blockers.length > 0 ? (
        <ul aria-label="Review blockers" className="text-warning mt-3 space-y-2 text-sm">
          {preview.blockers.map((blocker) => (
            <li key={blocker}>{BLOCKERS[blocker]}</li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-dark mt-2 text-sm">
          Source checks passed for local review. Confirm the evidence before accepting.
        </p>
      )}
      <PagedRows
        label="Mapped procedure allocations"
        rows={preview.allocations}
        rowKey={(row) => row.sourceLineId}
        render={(row) => (
          <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Value label="Source line ID" value={row.sourceLineId} />
            <Value label="Mapped procedure line ID" value={row.lineId ?? 'Not matched'} />
            <Value label="Procedure code" value={row.procedureCode ?? 'Not matched'} />
            <Value label="Tooth as supplied" value={row.tooth ?? 'Not supplied'} />
            <Value label="Signed allocation" value={money(row.amount)} />
          </dl>
        )}
      />
    </section>
  );
}

function PagedRows<T>({
  label,
  rows,
  rowKey,
  render,
}: {
  readonly label: string;
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly render: (row: T) => React.ReactNode;
}): React.ReactElement {
  const [page, setPage] = React.useState(0);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
  const start = currentPage * 50;
  if (rows.length === 0)
    return <p className="text-gray-dark mt-3 text-sm">No {label.toLowerCase()} supplied.</p>;
  return (
    <div className="min-w-0">
      <ol aria-label={label} className="divide-border-subtle mt-3 divide-y">
        {rows.slice(start, start + 50).map((row) => (
          <li key={rowKey(row)} className="min-w-0 space-y-2 py-3">
            {render(row)}
          </li>
        ))}
      </ol>
      <p role="status" className="text-gray-dark mt-2 text-sm">
        {label}: {start + 1}–{Math.min(start + 50, rows.length)} of {rows.length}
      </p>
      {rows.length > 50 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={currentPage === 0}
            onClick={() => {
              setPage(currentPage - 1);
            }}
            aria-label={`Previous ${label.toLowerCase()}`}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={start + 50 >= rows.length}
            onClick={() => {
              setPage(currentPage + 1);
            }}
            aria-label={`Next ${label.toLowerCase()}`}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
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
function money(value: string): string {
  return value.startsWith('-') ? `-$${value.slice(1)}` : `$${value}`;
}
