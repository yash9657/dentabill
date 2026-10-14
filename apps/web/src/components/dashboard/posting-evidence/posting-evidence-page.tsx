'use client';

import { useAuth } from '@clerk/nextjs';
import { Badge, Button, Label } from '@dentabill/ui';
import * as React from 'react';

import {
  readPostingFile,
  usePostingEvidence,
  type PostingEvidence,
  type PostingPreview,
  type PostingReviewCommand,
  type PostingScope,
  type PostingReceipt,
} from '../../../lib/posting-evidence/use-posting-evidence.js';

import { PostingRelationships } from './posting-relationships.js';

const BLOCKERS: Record<PostingPreview['blockers'][number], string> = {
  ALREADY_REVIEWED: 'This revision already has a recorded review.',
  NEWER_SOURCE_EVIDENCE:
    'A newer source sequence exists. This older revision can be rejected but cannot be accepted.',
  SOURCE_ENTRY_OVERLAP:
    'A source entry ID is reserved by another accepted receipt observation. Partial or absent revisions retain previously reserved entries until a later accepted complete or removed revision. Review the original source history; do not invent new source IDs to bypass the overlap.',
};
const FRESHNESS: Record<PostingReceipt['freshness'], string> = {
  CURRENT: 'Current accepted observation',
  STALE: 'Stale accepted observation',
  UNREVIEWED: 'No accepted observation',
};

export function PostingEvidencePage(): React.ReactElement {
  const { userId, orgId, isLoaded } = useAuth();
  if (!isLoaded) return <p role="status">Loading posting evidence…</p>;
  if (!userId) return <p>Sign in to view posting evidence.</p>;
  const scope: PostingScope = [userId, orgId ?? null];
  return <PostingWorkspace key={JSON.stringify(scope)} scope={scope} />;
}

function PostingWorkspace({ scope }: { readonly scope: PostingScope }): React.ReactElement {
  const [receiptId, setReceiptId] = React.useState<string | null>(null);
  const api = usePostingEvidence(scope, receiptId);
  const [selected, setSelected] = React.useState<PostingEvidence | null>(null);
  const [preview, setPreview] = React.useState<PostingPreview | null>(null);
  const [command, setCommand] = React.useState<PostingReviewCommand | null>(null);
  const [file, setFile] = React.useState<{ name: string; body: unknown } | null>(null);
  const [importUncertain, setImportUncertain] = React.useState(false);
  const [sourceBusy, setBusy] = React.useState(false);
  const [relationshipLocked, setRelationshipLocked] = React.useState(false);
  const busy = sourceBusy || relationshipLocked;
  const [message, setMessage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const lock = React.useRef(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const historyRef = React.useRef<HTMLHeadingElement>(null);
  const previewRef = React.useRef<HTMLHeadingElement>(null);
  const fileId = React.useId();
  const uncertain = importUncertain || command !== null;
  React.useEffect(() => {
    if (receiptId) historyRef.current?.focus();
  }, [receiptId]);
  React.useEffect(() => {
    if (preview) previewRef.current?.focus();
  }, [preview]);
  const begin = (): boolean => {
    if (lock.current || relationshipLocked) return false;
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
      const body = await readPostingFile(candidate);
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
        setReceiptId(result.data.receiptId);
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
    if (lock.current || uncertain || relationshipLocked) return;
    setReceiptId(id);
    setSelected(null);
    setPreview(null);
    setMessage(null);
    setNotice(null);
  };
  const openPreview = async (evidence: PostingEvidence): Promise<void> => {
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
            ? 'Source observation accepted. Header and entry facts remain separate; no local claim payment or cash allocation was created. Source and bank verification remain unverified.'
            : 'Source observation rejected. Its history is preserved; rejection does not make an earlier stale observation current.',
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
  const receipts = api.list.data?.pages.flatMap((page) => page.items) ?? [];
  const history = api.history.data?.pages.flatMap((page) => page.items) ?? [];
  const context = api.history.data?.pages[0]?.receipt;
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <header>
        <h1 className="font-body text-[28px] font-semibold leading-[1.15] text-black sm:text-[32px]">
          Posting evidence
        </h1>
        <p className="text-gray-dark mt-3 max-w-prose text-sm">
          Import and review PMS receipt observations independently of cash and remittance evidence.
          Acceptance records source facts; it does not post a payment to a local claim, verify a PMS
          connector or establish received cash. Exact claim associations require a separate review
          below.
        </p>
      </header>
      <section
        aria-labelledby="posting-import-heading"
        className="border-border-subtle border-y py-5"
      >
        <h2 id="posting-import-heading" className="text-xl font-medium text-black">
          Import a source revision
        </h2>
        <p id={`${fileId}-help`} className="text-gray-dark mt-2 max-w-prose text-sm">
          Choose one custom version 1 JSON file up to 256 KiB containing a PMS payment receipt. Keep
          the original source system, product, namespace, receipt and entry IDs. Source sequence
          must come from ordered source history, not upload time. Preserve header and entry amounts
          independently, including partial details and unknown values.
        </p>
        <a
          href="/examples/synthetic-posting-evidence.json"
          download
          className="text-brand mt-3 inline-flex min-h-11 items-center text-sm font-medium underline"
        >
          Download synthetic example JSON
        </a>
        <p className="text-gray-dark mb-3 text-xs">
          The example contains fake receipt, entry and claim references for testing only. Its
          unsupported source system keeps those references unresolved.
        </p>
        <a
          href="/examples/synthetic-posting-associations.json"
          download
          className="text-brand mb-2 inline-flex min-h-11 items-center text-sm font-medium underline"
        >
          Download synthetic exact-association example
        </a>
        <p className="text-gray-dark mb-3 max-w-prose text-xs">
          Uses fake OPEN_DENTAL source IDs. Import the matching claim source identity and any exact
          source line separately before reviewing an association. This custom JSON is not a native
          connector or proof of PMS posting.
        </p>
        <Label htmlFor={fileId}>PMS payment receipt JSON</Label>
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
      <section aria-labelledby="posting-inbox-heading">
        <h2 id="posting-inbox-heading" className="text-xl font-medium">
          Source receipt inbox
        </h2>
        {api.list.isPending ? (
          <p role="status" className="mt-3 text-sm">
            Loading source receipts…
          </p>
        ) : null}
        {api.list.isError ? (
          <div className="mt-3">
            <p role="alert">Source receipts could not be loaded.</p>
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
        {api.list.isSuccess && receipts.length === 0 ? (
          <p className="text-gray-dark mt-3 text-sm">
            No PMS posting evidence has been imported. Import a receipt source above to inspect its
            history and details.
          </p>
        ) : null}
        <ol aria-label="Source receipts" className="divide-border-subtle mt-3 divide-y">
          {receipts.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="break-words font-medium [overflow-wrap:anywhere]">
                  {item.latestEvidence.payload.sourceReceiptId}
                </p>
                <p className="text-gray-dark mt-1 break-words text-sm [overflow-wrap:anywhere]">
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
                aria-label={`View receipt ${item.latestEvidence.payload.sourceReceiptId} in ${item.latestEvidence.payload.sourceNamespace}`}
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
            Load more receipts
          </Button>
        ) : null}
      </section>
      {receiptId ? (
        <section
          aria-labelledby="posting-history-heading"
          className="border-border-subtle min-w-0 border-t pt-6"
        >
          <h2
            id="posting-history-heading"
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
          aria-labelledby="posting-evidence-heading"
          className="hairline-edge rounded-card min-w-0 bg-white p-5 sm:p-6"
        >
          <h2
            id="posting-evidence-heading"
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
                  label="Current accepted header amount"
                  value={
                    preview.currentAcceptedEvidence
                      ? money(preview.currentAcceptedEvidence.payload.amount)
                      : 'No accepted revision'
                  }
                />
                <Value
                  label="Proposed source header amount"
                  value={money(preview.evidence.payload.amount)}
                />
              </dl>
              <p className="text-gray-dark mt-3 max-w-prose text-sm">
                Acceptance replaces the earlier accepted observation; it does not add header amounts
                together. Header differences, incomplete details, unknown amounts and unresolved
                source claim references remain reviewable source facts. Acceptance does not resolve
                those differences or link an entry to a local claim.
              </p>
              <p className="text-gray-dark mt-3 max-w-prose text-sm">
                A partial or absent accepted revision retains entry IDs reserved by earlier accepted
                observations. Those reservations are replaced only by a later accepted complete or
                removed revision.
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
                  status, completeness and independent amounts before accepting.
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
      <PostingRelationships
        key={selected?.id ?? 'unselected'}
        scope={scope}
        evidence={selected}
        disabled={sourceBusy || uncertain}
        onLockChange={setRelationshipLocked}
      />
    </div>
  );
}

function EvidenceDetails({ evidence }: { readonly evidence: PostingEvidence }): React.ReactElement {
  const p = evidence.payload;
  const fields: readonly (readonly [string, string | null])[] = [
    ['Source system', p.sourceSystem],
    ['Source product', p.sourceProduct],
    ['Source namespace', p.sourceNamespace],
    ['Source receipt ID', p.sourceReceiptId],
    ['Source record ID', p.sourceRecordId],
    ['Source document ID', p.sourceDocumentId],
    ['Source version', p.sourceVersion],
    ['Observed at source', p.observedAt],
    ['Imported at', evidence.createdAt],
    ['Source entry date', p.sourceEntryDate],
    ['Source issued date', p.sourceIssuedDate],
    ['Payment trace', p.paymentTrace],
    ['Source deposit ID', p.sourceDepositId],
    ['Source status category', p.status],
    ['Raw source status', p.sourceStatus],
    ['Raw source partial flag', flag(p.sourceIsPartial)],
  ];
  return (
    <>
      <Badge className="mt-3" variant="outline">
        {evidence.review
          ? evidence.review.decision === 'ACCEPT'
            ? 'Accepted source observation'
            : 'Rejected source observation'
          : 'Awaiting human review'}
      </Badge>
      <p className="text-gray-dark mt-3 max-w-prose text-sm">
        Manual upload · Source verification: unverified · Raw receipt claim references: unlinked ·
        Bank verification: unverified · Settlement: unverified. Reviewed claim associations are
        shown separately below.
      </p>
      {p.status === 'REMOVED' ? (
        <p className="text-warning mt-3 max-w-prose text-sm">
          The source marks this receipt removed. This observation does not establish a refund or
          reverse a local claim payment. Its missing amount remains unknown.
        </p>
      ) : null}
      <section aria-label="Receipt header amounts" className="mt-5">
        <h3 className="font-medium">Receipt header facts</h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          <Value label="Canonical signed header amount (USD)" value={money(p.amount)} />
          <Value label="Original source header amount (USD)" value={money(p.sourceAmount)} />
          <Value label="Header sign convention" value={p.sourceSignConvention} />
        </dl>
        <p className="text-gray-dark mt-3 max-w-prose text-sm">
          Positive canonical amounts represent source-ledger credits; negative amounts represent
          source-ledger debits. These signs do not establish received cash.
        </p>
      </section>
      <section aria-label="Listed entry facts" className="mt-5">
        <h3 className="font-medium">Listed entry facts</h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Value label="Detail completeness" value={p.detailCompleteness} />
          <Value
            label="Known listed entry subtotal (USD)"
            value={money(evidence.totals.knownListedEntryAmount)}
          />
          <Value
            label="Entries with unknown amounts"
            value={String(evidence.totals.unknownEntryCount)}
          />
          <Value
            label="Complete entry amount (USD)"
            value={
              evidence.totals.completeEntryAmount === null
                ? 'Not established'
                : money(evidence.totals.completeEntryAmount)
            }
          />
          <Value
            label="Header minus complete entries (USD)"
            value={
              evidence.totals.headerDifference === null
                ? 'Not comparable'
                : money(evidence.totals.headerDifference)
            }
          />
        </dl>
        <p className="text-gray-dark mt-3 max-w-prose text-sm">
          The known subtotal includes only supplied amounts, across the listed entry kinds. A
          complete entry amount requires complete detail with no unknown amounts. Header differences
          are shown only when that complete amount and a known header are available. These are
          independent source observations, not cash or claim balances.
        </p>
        {evidence.totals.headerDifference !== null &&
        evidence.totals.headerDifference !== '0.00' ? (
          <p className="text-warning mt-3 max-w-prose text-sm">
            The source header differs from its complete entry detail. Both values are preserved;
            accepting this observation does not reconcile the difference.
          </p>
        ) : null}
      </section>
      <details className="border-border-subtle mt-5 border-t pt-4">
        <summary className="text-brand min-h-11 cursor-pointer text-sm font-medium">
          Inspect source identity, dates and raw status
        </summary>
        <p className="text-gray-dark mb-3 max-w-prose text-sm">
          Entry date and issued date are separate source facts. Deposit and trace references are not
          inferred bank matches.
        </p>
        <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([label, value]) => (
            <Value key={label} label={label} value={value ?? 'Not supplied'} />
          ))}
        </dl>
      </details>
      <section
        aria-label="Receipt source entries"
        className="border-border-subtle mt-5 border-t pt-5"
      >
        <h3 className="font-medium">Receipt source entries</h3>
        <p className="text-gray-dark mt-2 max-w-prose text-sm">
          Payment, transfer and adjustment entries remain distinct source facts. Their claim, line
          and procedure references remain raw source IDs here. Reviewed claim associations are shown
          separately below; neither flow allocates money to local claims. A source transfer flag
          does not establish a bank transfer.
        </p>
        {p.entries.length === 0 ? (
          <p className="text-gray-dark mt-3 text-sm">
            No source entries were supplied. An empty list does not establish a zero receipt amount.
          </p>
        ) : (
          <ol className="divide-border-subtle mt-3 divide-y">
            {p.entries.map((entry) => (
              <li key={entry.sourceEntryId} className="min-w-0 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">
                    {entry.sourceEntryId}
                  </h4>
                  <Badge variant="outline">{entry.entryKind}</Badge>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Value label="Canonical signed entry amount (USD)" value={money(entry.amount)} />
                  <Value
                    label="Original source entry amount (USD)"
                    value={money(entry.sourceAmount)}
                  />
                  <Value label="Entry sign convention" value={entry.sourceSignConvention} />
                  <Value
                    label="Raw source claim ID"
                    value={entry.sourceClaimId ?? 'Not supplied'}
                  />
                  <Value label="Raw source line ID" value={entry.sourceLineId ?? 'Not supplied'} />
                  <Value
                    label="Raw source procedure ID"
                    value={entry.sourceProcedureId ?? 'Not supplied'}
                  />
                  <Value
                    label="Entry source version"
                    value={entry.sourceVersion ?? 'Not supplied'}
                  />
                  <Value
                    label="Entry raw source status"
                    value={entry.sourceStatus ?? 'Not supplied'}
                  />
                  <Value label="Raw source transfer flag" value={flag(entry.sourceIsTransfer)} />
                </dl>
              </li>
            ))}
          </ol>
        )}
      </section>
      {evidence.review ? (
        <p className="text-gray-dark mt-4 break-words text-sm [overflow-wrap:anywhere]">
          Reviewed {evidence.review.createdAt} by {evidence.review.reviewedByUserId} (
          {evidence.review.reviewedByRole}).
        </p>
      ) : null}
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
      <dd className="mt-1 break-words text-sm tabular-nums text-black [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}
function money(value: string | null): string {
  return value === null ? 'Unknown' : value.startsWith('-') ? `−$${value.slice(1)}` : `+$${value}`;
}
function flag(value: boolean | null): string {
  return value === null ? 'Not supplied' : value ? 'True' : 'False';
}
