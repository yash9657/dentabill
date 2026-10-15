'use client';

import { Badge, Button, Label } from '@dentabill/ui';
import * as React from 'react';

import type {
  PostingEvidence,
  PostingScope,
} from '../../../lib/posting-evidence/use-posting-evidence.js';
import {
  usePostingRelationships,
  type PostingRelationship,
  type RelationshipCandidate,
  type RelationshipDecision,
  type RelationshipPreview,
  type RelationshipReleaseCommand,
  type RelationshipReleaseCandidate,
  type RelationshipReleasePreview,
  type RelationshipTargets,
} from '../../../lib/posting-evidence/use-posting-relationships.js';

const BLOCKERS: Record<RelationshipPreview['blockers'][number], string> = {
  SOURCE_NOT_ACCEPTED: 'Accept this source revision before associating its entries.',
  SOURCE_NOT_CURRENT:
    'This accepted source revision is no longer current. Review the latest source revision.',
  SOURCE_SYSTEM_UNSUPPORTED:
    'This source system does not support exact claim associations yet. Its raw references remain unresolved.',
  SOURCE_CLAIM_ID_MISSING: 'The source entry has no claim ID. No claim can be associated.',
  CLAIM_SOURCE_IDENTITY_MISMATCH:
    'No claim has the exact source system, namespace and claim ID required by this entry.',
  SOURCE_LINE_ID_MISSING:
    'This entry has no source line ID. Only a claim association is supported; its raw procedure reference remains unresolved.',
  SOURCE_LINE_NOT_FOUND: 'The exact source line was not found on this imported claim.',
  SOURCE_PROCEDURE_MISMATCH:
    'The source procedure reference does not agree with the imported claim line.',
  ENTRY_ALREADY_LINKED:
    'This source entry already has an unreleased association. A stale association still reserves the entry. Review and release the existing association before linking it again.',
  CLAIM_CHANGED:
    'The imported claim changed after this association was reviewed. Review its current source evidence.',
};
const RELEASE_REASONS: Record<RelationshipReleaseCandidate['reason'], string> = {
  WRONG_LINK: 'Wrong claim association',
  SOURCE_CHANGED: 'Source evidence changed',
  OTHER_REVIEWED_ERROR: 'Other reviewed error',
};
const STATUSES: Record<PostingRelationship['status'], string> = {
  CURRENT: 'Current association',
  STALE: 'Stale association',
  RELEASED: 'Released association',
};
type PendingCommand =
  | { kind: 'CREATE'; body: RelationshipDecision }
  | { kind: 'RELEASE'; command: RelationshipReleaseCommand };

export function PostingRelationships({
  scope,
  evidence,
  disabled,
  onLockChange,
}: {
  readonly scope: PostingScope;
  readonly evidence: PostingEvidence | null;
  readonly disabled: boolean;
  readonly onLockChange: (locked: boolean) => void;
}): React.ReactElement {
  const api = usePostingRelationships(scope);
  const [targets, setTargets] = React.useState<RelationshipTargets | null>(null);
  const [preview, setPreview] = React.useState<RelationshipPreview | null>(null);
  const [releaseRow, setReleaseRow] = React.useState<PostingRelationship | null>(null);
  const [reason, setReason] = React.useState<RelationshipReleaseCandidate['reason'] | ''>('');
  const [releasePreview, setReleasePreview] = React.useState<RelationshipReleasePreview | null>(
    null,
  );
  const [command, setCommand] = React.useState<PendingCommand | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const lock = React.useRef(false);
  const previewRef = React.useRef<HTMLHeadingElement>(null);
  const releaseRef = React.useRef<HTMLHeadingElement>(null);
  const reasonId = React.useId();
  const locked = disabled || busy || command !== null;
  React.useEffect(() => {
    onLockChange(busy || command !== null);
  }, [busy, command, onLockChange]);
  React.useEffect(
    () => () => {
      onLockChange(false);
    },
    [onLockChange],
  );
  React.useEffect(() => {
    if (preview) previewRef.current?.focus();
  }, [preview]);
  React.useEffect(() => {
    if (releaseRow) releaseRef.current?.focus();
  }, [releaseRow]);
  const begin = (): boolean => {
    if (lock.current || disabled) return false;
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
  const inspect = async (): Promise<void> => {
    if (!evidence || command || !begin()) return;
    setPreview(null);
    setReleaseRow(null);
    setReleasePreview(null);
    try {
      const result = await api.targets(evidence.id);
      if (result.kind === 'OK') setTargets(result.data);
      else if (result.kind !== 'INACTIVE')
        setMessage(
          'Exact claim candidates could not be loaded. Retry inspecting this source revision; no association was created.',
        );
    } finally {
      end();
    }
  };
  const openPreview = async (candidate: RelationshipCandidate): Promise<void> => {
    if (command || !begin()) return;
    setPreview(null);
    setReleaseRow(null);
    setReleasePreview(null);
    try {
      const result = await api.preview(candidate);
      if (result.kind === 'OK') setPreview(result.data);
      else if (result.kind !== 'INACTIVE')
        setMessage(
          'The association preview could not be confirmed. Inspect the source entry and open a fresh preview.',
        );
    } finally {
      end();
    }
  };
  const openRelease = (row: PostingRelationship): void => {
    if (locked || lock.current) return;
    setPreview(null);
    setReleaseRow(row);
    setReleasePreview(null);
    setReason('');
    setMessage(null);
    setNotice(null);
  };
  const previewRelease = async (): Promise<void> => {
    if (!releaseRow || !reason || command || !begin()) return;
    setReleasePreview(null);
    try {
      const result = await api.previewRelease(releaseRow.id, { reason });
      if (result.kind === 'OK') setReleasePreview(result.data);
      else if (result.kind !== 'INACTIVE')
        setMessage(
          'The release preview could not be loaded. Open a fresh release preview before deciding.',
        );
    } finally {
      end();
    }
  };
  const commit = async (kind?: PendingCommand['kind']): Promise<void> => {
    if (!begin()) return;
    let pending = command;
    if (!pending) {
      if (kind === 'CREATE' && preview?.blockers.length === 0) {
        pending = {
          kind,
          body: {
            ...preview.candidate,
            reviewToken: preview.reviewToken,
            idempotencyKey: crypto.randomUUID(),
          },
        };
      } else if (kind === 'RELEASE' && releasePreview?.canRelease) {
        pending = {
          kind,
          command: {
            relationshipId: releasePreview.relationship.id,
            body: {
              reason: releasePreview.reason,
              reviewToken: releasePreview.reviewToken,
              idempotencyKey: crypto.randomUUID(),
            },
          },
        };
      } else {
        end();
        return;
      }
    }
    setCommand(pending);
    try {
      const result =
        pending.kind === 'CREATE'
          ? await api.create(pending.body)
          : await api.release(pending.command);
      if (result.kind === 'INACTIVE') return;
      if (result.kind === 'OK') {
        setCommand(null);
        setPreview(null);
        setTargets(null);
        setReleaseRow(null);
        setReleasePreview(null);
        setNotice(
          pending.kind === 'CREATE'
            ? 'Claim association recorded. It links reviewed source evidence only; no payment, recovered revenue or claim cash allocation was created.'
            : 'Association fully released. Its history is preserved. A new association requires a fresh review; no money was moved or reversed.',
        );
      } else if (result.kind === 'UNCERTAIN') {
        setMessage(
          'The decision could not be confirmed. Retry the same decision below before starting another review.',
        );
      } else {
        setCommand(null);
        setPreview(null);
        setReleasePreview(null);
        void api.refresh();
        setMessage(
          result.kind === 'STALE'
            ? 'Source evidence, the claim or its association changed. Open a fresh preview before deciding again.'
            : 'The association decision was not accepted. Check your access and source references, then open a fresh preview.',
        );
      }
    } finally {
      end();
    }
  };
  const rows = api.list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section
      aria-labelledby="posting-associations-heading"
      className="border-border-subtle min-w-0 border-t pt-6"
    >
      <h2 id="posting-associations-heading" className="text-xl font-medium">
        Claim associations
      </h2>
      <p className="text-gray-dark mt-2 max-w-prose text-sm">
        Review a source entry against the exact imported claim and, when supplied, its source line.
        Source system, namespace and claim ID must agree. These associations do not post a payment,
        establish recovered revenue or allocate cash.
      </p>
      <FinancialScope />
      {evidence ? (
        <div className="mt-4">
          <p className="break-words text-sm [overflow-wrap:anywhere]">
            Selected receipt {evidence.payload.sourceReceiptId} · source sequence{' '}
            {evidence.payload.sourceSequence}
          </p>
          <Button
            className="mt-3"
            variant="ghost"
            disabled={locked}
            onClick={() => {
              void inspect();
            }}
          >
            {targets ? 'Refresh exact claim candidates' : 'Inspect exact claim candidates'}
          </Button>
        </div>
      ) : (
        <p className="text-gray-dark mt-4 text-sm">
          Open a receipt revision above to inspect its exact claim candidates. Existing association
          history remains available below.
        </p>
      )}
      {busy ? (
        <p role="status" className="text-gray-dark mt-3 text-sm">
          Confirming claim association evidence…
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {message}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-gray-dark mt-3 text-sm">
          {notice}
        </p>
      ) : null}
      {command ? (
        <Button
          className="mt-3"
          disabled={busy || disabled}
          onClick={() => {
            void commit();
          }}
        >
          Retry same {command.kind === 'CREATE' ? 'association' : 'release'}
        </Button>
      ) : null}
      {targets ? (
        <section aria-label="Exact claim candidates" className="mt-5">
          <h3 className="font-medium">Source entry candidates</h3>
          {targets.items.length === 0 ? (
            <p className="text-gray-dark mt-2 text-sm">
              This revision has no listed source entries to associate.
            </p>
          ) : null}
          <ol className="divide-border-subtle mt-2 divide-y">
            {targets.items.map((target) => (
              <li key={target.source.entry.sourceEntryId} className="min-w-0 py-4">
                <h4 className="break-words font-medium [overflow-wrap:anywhere]">
                  {target.source.entry.sourceEntryId}
                </h4>
                <p className="mt-1 text-sm">
                  {target.source.entry.entryKind} · signed entry {money(target.source.entry.amount)}{' '}
                  · original source {money(target.source.entry.sourceAmount)} ·{' '}
                  {target.source.entry.sourceSignConvention}
                </p>
                <p className="text-gray-dark mt-2 break-words text-sm [overflow-wrap:anywhere]">
                  Source claim: {target.source.entry.sourceClaimId ?? 'Not supplied'} · source line:{' '}
                  {target.source.entry.sourceLineId ?? 'Not supplied'} · source procedure:{' '}
                  {target.source.entry.sourceProcedureId ?? 'Not supplied'}
                </p>
                {target.claim ? (
                  <ClaimFacts claim={target.claim} />
                ) : (
                  <p className="text-gray-dark mt-2 text-sm">
                    No exact imported claim candidate is available. Raw source references remain
                    unresolved.
                  </p>
                )}
                <Blockers blockers={target.blockers} />
                {target.candidate ? (
                  <Button
                    className="mt-3"
                    variant="ghost"
                    disabled={locked}
                    aria-label={`Preview association for ${target.source.entry.sourceEntryId}`}
                    onClick={() => {
                      if (target.candidate) void openPreview(target.candidate);
                    }}
                  >
                    Preview association
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {preview ? (
        <section
          aria-labelledby="association-preview-heading"
          className="border-border-subtle mt-5 border-y py-5"
        >
          <h3
            id="association-preview-heading"
            ref={previewRef}
            tabIndex={-1}
            className="text-lg font-medium"
          >
            Review exact claim association
          </h3>
          <SourceFacts source={preview.source} />
          <ClaimFacts claim={preview.claim} />
          {!preview.candidate.claimSourceLineId ? (
            <p className="text-gray-dark mt-3 text-sm">
              Claim-only association. No source line is associated; any raw procedure reference
              remains unresolved.
            </p>
          ) : null}
          <FinancialScope />
          <Blockers blockers={preview.blockers} />
          {preview.blockers.length === 0 ? (
            <p className="text-gray-dark mt-3 text-sm">
              The exact source references agree. Confirm the source entry and imported claim before
              recording this association.
            </p>
          ) : null}
          <Button
            className="mt-4"
            disabled={locked || preview.blockers.length > 0}
            onClick={() => {
              void commit('CREATE');
            }}
          >
            Record claim association
          </Button>
        </section>
      ) : null}
      <section aria-label="Claim association history" className="mt-6">
        <h3 className="font-medium">Association history</h3>
        <p className="text-gray-dark mt-2 max-w-prose text-sm">
          Source revisions and claim edits can make an association stale. An unreleased association
          continues to reserve its source entry, even when stale. Explicitly release it before a new
          association.
        </p>
        {api.list.isPending ? (
          <p role="status" className="mt-3 text-sm">
            Loading association history…
          </p>
        ) : null}
        {api.list.isError ? (
          <div className="mt-3">
            <p role="alert">
              Association history could not be loaded. Any previously loaded rows remain below.
            </p>
            <Button
              variant="ghost"
              disabled={locked || api.list.isFetching}
              onClick={() => {
                void api.list.refetch();
              }}
            >
              Retry association history
            </Button>
          </div>
        ) : null}
        {api.list.isSuccess && rows.length === 0 ? (
          <p className="text-gray-dark mt-3 text-sm">No claim associations have been recorded.</p>
        ) : null}
        <ol className="divide-border-subtle mt-3 divide-y">
          {rows.map((row) => (
            <li key={row.id} className="min-w-0 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                  {row.sourceEntryId}
                </p>
                <Badge variant="outline">{STATUSES[row.status]}</Badge>
              </div>
              <p className="text-gray-dark mt-2 break-words text-sm [overflow-wrap:anywhere]">
                {row.source.sourceSystem} / {row.source.sourceNamespace} /{' '}
                {row.source.sourceReceiptId} · source sequence {row.source.sourceSequence}
              </p>
              <p className="mt-1 text-sm">
                {row.source.entry.entryKind} · signed entry {money(row.source.entry.amount)} ·
                original source {money(row.source.entry.sourceAmount)}
              </p>
              <ClaimFacts claim={row.claim} />
              <p className="text-gray-dark mt-2 text-sm">
                {row.claimSourceLineId
                  ? 'Claim and source line association'
                  : 'Claim-only association; no source line associated'}{' '}
                · reviewed {row.createdAt} by {row.reviewedByRole}
              </p>
              <Blockers blockers={row.blockers} />
              {row.release ? (
                <p className="text-gray-dark mt-3 text-sm">
                  Released {row.release.createdAt} · {RELEASE_REASONS[row.release.reason]} ·{' '}
                  {row.release.reviewedByRole}
                </p>
              ) : (
                <Button
                  variant="ghost"
                  className="mt-3"
                  disabled={locked}
                  aria-label={`Release association for ${row.sourceEntryId}`}
                  onClick={() => {
                    openRelease(row);
                  }}
                >
                  Review full release
                </Button>
              )}
            </li>
          ))}
        </ol>
        {api.list.hasNextPage ? (
          <Button
            variant="ghost"
            disabled={locked || api.list.isFetching}
            onClick={() => {
              void api.list.fetchNextPage();
            }}
          >
            Load older associations
          </Button>
        ) : null}
      </section>
      {releaseRow ? (
        <section
          aria-labelledby="association-release-heading"
          className="border-border-subtle mt-5 border-y py-5"
        >
          <h3
            id="association-release-heading"
            ref={releaseRef}
            tabIndex={-1}
            className="text-lg font-medium"
          >
            Release this claim association
          </h3>
          <p className="mt-2 break-words text-sm [overflow-wrap:anywhere]">
            Source entry {releaseRow.sourceEntryId} · receipt {releaseRow.source.sourceReceiptId} ·
            source sequence {releaseRow.source.sourceSequence}
          </p>
          <ClaimFacts claim={releaseRow.claim} />
          <p className="text-gray-dark mt-3 max-w-prose text-sm">
            Release the whole association and its source-entry reservation. This preserves the
            review history and does not reverse a payment, alter source evidence or move money.
            Stale source evidence does not prevent release.
          </p>
          <div className="mt-4 max-w-md">
            <Label htmlFor={reasonId}>Reason for full release</Label>
            <select
              id={reasonId}
              className="border-border-light rounded-standard mt-2 min-h-11 w-full border bg-white px-3 text-sm"
              value={reason}
              disabled={locked}
              onChange={(event) => {
                setReason(event.target.value as RelationshipReleaseCandidate['reason'] | '');
                setReleasePreview(null);
              }}
            >
              <option value="">Choose a reviewed reason</option>
              {Object.entries(RELEASE_REASONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="ghost"
            className="mt-3"
            disabled={locked || !reason}
            onClick={() => {
              void previewRelease();
            }}
          >
            Open fresh release preview
          </Button>
          {releasePreview ? (
            <div className="mt-4">
              <p className="text-sm">
                Reviewed association: source entry {releasePreview.relationship.sourceEntryId} ·{' '}
                {RELEASE_REASONS[releasePreview.reason]}
              </p>
              <p className="text-gray-dark mt-2 text-sm">
                Originally recorded {releasePreview.relationship.createdAt} by{' '}
                {releasePreview.relationship.reviewedByRole}.{' '}
                {releasePreview.relationship.claimSourceLineId
                  ? 'Claim and source line association.'
                  : 'Claim-only association.'}
              </p>
              {releasePreview.canRelease ? (
                <Button
                  className="mt-3"
                  disabled={locked}
                  onClick={() => {
                    void commit('RELEASE');
                  }}
                >
                  Confirm full release
                </Button>
              ) : (
                <p role="status" className="text-gray-dark mt-3 text-sm">
                  This association has already been released. Refresh association history to see its
                  release.
                </p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function FinancialScope(): React.ReactElement {
  return (
    <p className="text-gray-dark mt-3 max-w-prose text-xs">
      Manual review · Exact source identity · Source verification: unverified · Bank verification:
      unverified · Settlement: unverified · Claim cash: unallocated.
    </p>
  );
}
function Blockers({
  blockers,
}: {
  readonly blockers: RelationshipPreview['blockers'];
}): React.ReactElement | null {
  return blockers.length ? (
    <ul aria-label="Association blockers" className="text-warning mt-3 space-y-2 text-sm">
      {blockers.map((blocker) => (
        <li key={blocker}>{BLOCKERS[blocker]}</li>
      ))}
    </ul>
  ) : null;
}
function ClaimFacts({
  claim,
}: {
  readonly claim: RelationshipPreview['claim'];
}): React.ReactElement {
  return (
    <div className="mt-3 text-sm">
      <a
        href={`/dashboard/claims/${encodeURIComponent(claim.id)}`}
        className="text-brand inline-flex min-h-11 items-center break-words font-medium underline [overflow-wrap:anywhere]"
      >
        Claim {claim.claimNumber}
      </a>
      <p className="text-gray-dark break-words [overflow-wrap:anywhere]">
        Imported identity: {claim.sourceSystem ?? 'Unknown'} / {claim.sourceNamespace ?? 'Unknown'}{' '}
        / {claim.sourceClaimId ?? 'Unknown'}
      </p>
      {claim.line ? (
        <p className="text-gray-dark mt-1 break-words [overflow-wrap:anywhere]">
          Source line {claim.line.sourceLineId} · source procedure{' '}
          {claim.line.sourceProcedureId ?? 'Not supplied'} · {claim.line.procedureCode} · service
          date {claim.line.serviceDate} · billed {money(claim.line.billedAmount)}
        </p>
      ) : null}
    </div>
  );
}
function SourceFacts({
  source,
}: {
  readonly source: RelationshipPreview['source'];
}): React.ReactElement {
  const entry = source.entry;
  const facts: readonly (readonly [string, string | null])[] = [
    ['Source entry', entry.sourceEntryId],
    ['Entry kind', entry.entryKind],
    ['Signed entry amount (USD)', money(entry.amount)],
    ['Original source entry amount (USD)', money(entry.sourceAmount)],
    ['Entry sign convention', entry.sourceSignConvention],
    ['Raw entry status', entry.sourceStatus],
    ['Entry source version', entry.sourceVersion],
    [
      'Raw source transfer flag',
      entry.sourceIsTransfer === null ? 'Unknown' : entry.sourceIsTransfer ? 'True' : 'False',
    ],
    ['Source claim ID', entry.sourceClaimId],
    ['Source line ID', entry.sourceLineId],
    ['Raw source procedure ID', entry.sourceProcedureId],
    ['Source system', source.sourceSystem],
    ['Source product', source.sourceProduct],
    ['Source namespace', source.sourceNamespace],
    ['Source receipt ID', source.sourceReceiptId],
    ['Source record ID', source.sourceRecordId],
    ['Source document ID', source.sourceDocumentId],
    ['Receipt status', source.status],
    ['Detail completeness', source.detailCompleteness],
    ['Signed receipt header (USD)', money(source.headerAmount)],
    ['Original source header (USD)', money(source.headerSourceAmount)],
    ['Header sign convention', source.sourceSignConvention],
  ];
  return (
    <div className="mt-3">
      <p className="text-gray-dark text-sm">
        Selected source sequence {source.sourceSequence} · latest observed sequence{' '}
        {source.latestSourceSequence} ·{' '}
        {source.reviewDecision === 'ACCEPT'
          ? 'Accepted source revision'
          : source.reviewDecision === 'REJECT'
            ? 'Rejected source revision'
            : 'Source revision awaiting review'}
        .
      </p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-gray-dark text-xs">{label}</dt>
            <dd className="mt-1 break-words text-sm [overflow-wrap:anywhere]">
              {value ?? 'Not supplied'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
function money(value: string | null): string {
  if (value === null) return 'Unknown';
  return `${value.startsWith('-') ? '−' : '+'}$${Math.abs(Number(value)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
