'use client';

import { Badge, Button, cn } from '@dentabill/ui';
import * as React from 'react';

import type {
  ClaimSourceCoverage,
  ClaimSourceDetails,
  ClaimSourceLine,
} from '../../../lib/claims/types.js';

const PAGE_SIZE = 50;
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  DENTRIX: 'Dentrix',
  EAGLESOFT: 'Eaglesoft',
  OPEN_DENTAL: 'Open Dental',
};

export function ClaimSourceDetailsSection({
  details,
  currentAmount,
}: {
  readonly details: ClaimSourceDetails | null;
  readonly currentAmount: string;
}): React.ReactElement {
  return (
    <section
      aria-labelledby="claim-source-heading"
      className="hairline-edge rounded-card flex min-w-0 flex-col gap-6 bg-white p-6"
    >
      <header>
        <h2 id="claim-source-heading" className="font-body text-2xl font-medium text-black">
          Imported procedures and coverage
        </h2>
        <p className="text-gray-dark mt-2 max-w-prose text-sm">
          Original source information from the import. Coverage entries do not confirm eligibility,
          benefits or payment.
        </p>
      </header>
      {details ? (
        <ImportedDetails details={details} currentAmount={currentAmount} />
      ) : (
        <p className="text-gray-dark max-w-prose text-sm">
          No procedure or coverage snapshot was saved for this claim. The summary codes above do not
          identify individual procedures, teeth or coverage. Consult the original source database
          for those details.
        </p>
      )}
    </section>
  );
}

function ImportedDetails({
  details,
  currentAmount,
}: {
  readonly details: ClaimSourceDetails;
  readonly currentAmount: string;
}): React.ReactElement {
  const amountChanged = decimalKey(details.importedClaimAmount) !== decimalKey(currentAmount);
  return (
    <>
      <dl className="grid min-w-0 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Value label="Imported billed total" value={`$${details.importedClaimAmount}`} mono />
        <Value
          label="Source system"
          value={SOURCE_LABELS[details.sourceSystem] ?? details.sourceSystem}
        />
        <Value label="Source database" value={details.sourceNamespace} mono />
        <Value label="Source claim ID" value={details.sourceClaimId} mono />
        <Value
          label="Source version"
          value={details.sourceVersion ?? 'Not supplied'}
          mono={details.sourceVersion !== null}
        />
        <Value label="Snapshot saved" value={formatDate(details.createdAt)} />
      </dl>
      {amountChanged ? (
        <p className="text-warning text-sm">
          The current claim amount is ${currentAmount}. The imported billed total remains $
          {details.importedClaimAmount}; the source snapshot has not been changed.
        </p>
      ) : null}
      <ProcedureLines key={details.createdAt} lines={details.lines} />
      <section aria-labelledby="source-coverages-heading" className="min-w-0">
        <h3 id="source-coverages-heading" className="text-lg font-medium text-black">
          Imported coverage
        </h3>
        <p className="text-gray-dark mt-1 max-w-prose text-sm">
          Sequence is the order reported by the source. “Coverage for this claim” identifies the
          entry linked to this claim, which may have a later sequence.
        </p>
        {details.coverages.length === 0 ? (
          <p className="text-gray-dark mt-4 text-sm">
            No coverage entries were supplied with this snapshot.
          </p>
        ) : (
          <ol aria-label="Imported coverage entries" className="divide-border-subtle mt-3 divide-y">
            {details.coverages.map((coverage) => (
              <Coverage key={coverage.id} coverage={coverage} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function ProcedureLines({
  lines,
}: {
  readonly lines: readonly ClaimSourceLine[];
}): React.ReactElement {
  const [page, setPage] = React.useState(0);
  const start = page * PAGE_SIZE;
  return (
    <section aria-labelledby="source-procedures-heading" className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="source-procedures-heading" className="text-lg font-medium text-black">
          Imported procedures
        </h3>
        <p className="text-gray-dark text-sm">
          {lines.length.toLocaleString()} {lines.length === 1 ? 'line' : 'lines'}
        </p>
      </div>
      <p className="text-gray-dark mt-1 max-w-prose text-sm">
        Each source line is shown separately. Treatment locations and numbering systems are
        displayed as supplied.
      </p>
      {lines.length === 0 ? (
        <p className="text-gray-dark mt-4 text-sm">
          No procedure lines were supplied with this snapshot.
        </p>
      ) : (
        <>
          <ol aria-label="Imported procedure lines" className="divide-border-subtle mt-3 divide-y">
            {lines.slice(start, start + PAGE_SIZE).map((line, index) => (
              <ProcedureLine key={line.id} line={line} ordinal={start + index + 1} />
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-gray-dark text-sm">
              Showing {String(start + 1)}–{String(Math.min(start + PAGE_SIZE, lines.length))} of{' '}
              {lines.length.toLocaleString()} procedure lines
            </p>
            {lines.length > PAGE_SIZE ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={page === 0}
                  onClick={() => {
                    setPage(page - 1);
                  }}
                >
                  Previous procedures
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={start + PAGE_SIZE >= lines.length}
                  onClick={() => {
                    setPage(page + 1);
                  }}
                >
                  Next procedures
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function ProcedureLine({
  line,
  ordinal,
}: {
  readonly line: ClaimSourceLine;
  readonly ordinal: number;
}): React.ReactElement {
  const locations = [
    ['Treatment area', line.treatmentArea],
    ['Tooth', line.tooth],
    ['Surface', line.surface],
    ['Quadrant', line.quadrant],
    ['Tooth range', line.toothRange],
    ['Tooth numbering system', line.toothNumberingSystem],
  ] as const;
  return (
    <li className="flex min-w-0 flex-col gap-3 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h4 className="min-w-0 break-words font-medium text-black">
          Line {ordinal} · <span className="font-mono">{line.procedureCode}</span>
        </h4>
        <p className="shrink-0 text-sm text-black">
          Billed <span className="font-mono tabular-nums">${line.billedAmount}</span>
        </p>
      </div>
      <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Value label="Service date" value={formatDate(line.serviceDate)} />
        <Value
          label="Quantity"
          value={line.quantity ?? 'Not supplied'}
          mono={line.quantity !== null}
        />
        {locations.map(([label, value]) =>
          value !== null ? <Value key={label} label={label} value={value} /> : null,
        )}
      </dl>
      {locations.every(([, value]) => value === null) ? (
        <p className="text-gray-dark text-sm">No treatment location was supplied.</p>
      ) : null}
      <details className="min-w-0">
        <summary className="text-brand min-h-11 cursor-pointer content-center text-sm font-medium">
          Source line details
        </summary>
        <dl className="mt-2 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Value label="Source line ID" value={line.sourceLineId} mono />
          {line.sourceProcedureId !== null ? (
            <Value label="Source procedure ID" value={line.sourceProcedureId} mono />
          ) : null}
          {line.codeVersion !== null ? (
            <Value label="Code version" value={line.codeVersion} mono />
          ) : null}
        </dl>
      </details>
    </li>
  );
}

function Coverage({ coverage }: { readonly coverage: ClaimSourceCoverage }): React.ReactElement {
  const optional = [
    ['Payer identifier', coverage.payerIdentifier],
    ['Payer identifier system', coverage.payerIdentifierSystem],
    ['Source plan ID', coverage.sourcePlanId],
    ['Source subscription ID', coverage.sourceSubscriptionId],
    ['Patient member ID', coverage.patientMemberId],
    ['Group number', coverage.groupNumber],
    ['Relationship', coverage.relationship],
  ] as const;
  return (
    <li className="min-w-0 py-5">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <div className="min-w-0 flex-1">
          <h4 className="break-words font-medium text-black">{coverage.payerName}</h4>
          <p className="text-gray-dark mt-1 text-sm">Coverage sequence {coverage.sequence}</p>
        </div>
        {coverage.isClaimCoverage ? <Badge variant="outline">Coverage for this claim</Badge> : null}
      </div>
      <details className="mt-2 min-w-0">
        <summary className="text-brand min-h-11 cursor-pointer content-center text-sm font-medium">
          Coverage details
        </summary>
        <dl className="mt-2 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Value label="Source coverage ID" value={coverage.sourceCoverageId} mono />
          <Value
            label="Subscriber ID"
            value={coverage.subscriberId ?? 'Not supplied'}
            mono={coverage.subscriberId !== null}
          />
          {optional.map(([label, value]) =>
            value !== null ? <Value key={label} label={label} value={value} mono /> : null,
          )}
          {coverage.effectiveDate !== null ? (
            <Value label="Effective date" value={formatDate(coverage.effectiveDate)} />
          ) : null}
          {coverage.terminationDate !== null ? (
            <Value label="Termination date" value={formatDate(coverage.terminationDate)} />
          ) : null}
        </dl>
      </details>
    </li>
  );
}

function Value({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-gray-dark text-sm">{label}</dt>
      <dd
        className={cn(
          'mt-1 break-words text-sm text-black [overflow-wrap:anywhere]',
          mono && 'font-mono tabular-nums',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}
function decimalKey(value: string): string {
  const [whole = '', fraction = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`;
}
