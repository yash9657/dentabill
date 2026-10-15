'use client';

import { useAuth } from '@clerk/nextjs';
import { Button, Input, Label, Pill, cn } from '@dentabill/ui';
import Link from 'next/link';
import * as React from 'react';

import {
  sourceDatabaseError,
  useClaimsImport,
  type ImportSummary,
} from '../../../lib/claims/use-claims-import.js';
import { DashboardEmptyState } from '../dashboard-empty-state.js';
import { SkeletonList } from '../skeleton-list.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PAGE_SIZE = 50;
const SOURCE_LABELS: Readonly<Record<ImportSummary['source'], string>> = {
  DENTRIX: 'Dentrix',
  EAGLESOFT: 'Eaglesoft',
  OPEN_DENTAL: 'Open Dental',
};
const ROW_COPY: Readonly<
  Record<ImportSummary['rows'][number]['disposition'], { label: string; nextStep: string }>
> = {
  INSERTED: { label: 'Imported', nextStep: 'Added as a new claim.' },
  DUPLICATE: {
    label: 'Unchanged',
    nextStep: 'This exact record was already imported. No changes were made.',
  },
  SOURCE_CHANGED: {
    label: 'Source changed',
    nextStep:
      'Compare the existing claim with this export before making corrections. This upload did not overwrite it.',
  },
  BATCH_CONFLICT: {
    label: 'Conflicting rows',
    nextStep:
      'Export one consistent record for this source ID, then upload again using the same source database name.',
  },
  LEGACY_MATCH: {
    label: 'Legacy match',
    nextStep:
      'Review existing claims with this displayed claim number. No source identity was assigned and no new claim was created.',
  },
  MISSING_SOURCE_ID: {
    label: 'Missing source ID',
    nextStep:
      'Add SourceClaimId to the export, or ClaimNum for Open Dental, then upload again using the same source database name.',
  },
};

export function ClaimsImportPage(): React.ReactElement {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <DashboardEmptyState
        eyebrow="Import"
        title="Sign in to upload claims"
        body="Upload open claims from Dentrix, Eaglesoft, or Open Dental. Each new claim needs its original source ID and a stable source database name."
        previewChildren={<SkeletonList rows={5} />}
        primaryCta={{ label: 'Sign in', href: '/sign-in' }}
        secondaryCta={{ label: 'Back to claims', href: '/dashboard/claims' }}
      />
    );
  }
  return <OrganizationImportPage />;
}

function OrganizationImportPage(): React.ReactElement {
  const { orgId } = useAuth();
  // File, namespace and results cannot carry across organizations.
  return <AuthenticatedImportPage key={orgId ?? 'no-organization'} />;
}

function AuthenticatedImportPage(): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const sourceRef = React.useRef<HTMLInputElement>(null);
  const submitting = React.useRef(false);
  const sourceId = React.useId();
  const [picked, setPicked] = React.useState<File | null>(null);
  const [sourceNamespace, setSourceNamespace] = React.useState('');
  const [sourceTouched, setSourceTouched] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const mutation = useClaimsImport();
  const sourceError = sourceTouched ? sourceDatabaseError(sourceNamespace) : null;

  const choose = (file: File | undefined): void => {
    if (!file || submitting.current) return;
    const error =
      file.size === 0
        ? 'That CSV is empty. Choose an export containing claims.'
        : file.size > MAX_FILE_BYTES
          ? 'That CSV is over 10 MB. Split the file into smaller uploads.'
          : !file.name.toLowerCase().endsWith('.csv') && !file.type.toLowerCase().includes('csv')
            ? 'Choose a CSV file with a .csv extension or CSV file type.'
            : null;
    setLocalError(error);
    setPicked(error ? null : file);
    mutation.reset();
    if (error && inputRef.current) inputRef.current.value = '';
  };
  const upload = (event: React.SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting.current) return;
    setSourceTouched(true);
    if (sourceDatabaseError(sourceNamespace)) {
      sourceRef.current?.focus();
      return;
    }
    if (!picked) {
      setLocalError('Choose a CSV file before uploading.');
      return;
    }
    submitting.current = true;
    mutation.mutate(
      { file: picked, sourceNamespace },
      {
        onSettled: () => {
          submitting.current = false;
        },
      },
    );
  };
  const reset = (): void => {
    if (submitting.current) return;
    setPicked(null);
    setLocalError(null);
    setSourceTouched(false);
    mutation.reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="flex flex-col gap-8" aria-labelledby="claims-import-heading">
      <header className="max-w-3xl">
        <h1
          id="claims-import-heading"
          className="font-body text-[28px] font-medium leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]"
        >
          Upload claims CSV
        </h1>
        <p className="text-body text-gray-dark mt-3 max-w-prose">
          Export from Dentrix, Eaglesoft, or Open Dental. Include <code>SourceClaimId</code> for
          each claim, or <code>ClaimNum</code> for Open Dental. <code>SourceVersion</code> is
          optional.
        </p>
        <p className="text-gray-dark mt-2 max-w-prose text-sm">
          Repeated uploads match the source database and source ID. Changed records are held for
          review without overwriting existing claims.
        </p>
      </header>
      {mutation.data ? (
        <ResultCard summary={mutation.data} onReset={reset} />
      ) : (
        <form
          className="flex flex-col gap-6"
          onSubmit={upload}
          noValidate
          aria-busy={mutation.isPending}
        >
          <div className="flex max-w-xl flex-col gap-2">
            <Label htmlFor={sourceId}>Source database</Label>
            <Input
              ref={sourceRef}
              id={sourceId}
              name="sourceDatabase"
              value={sourceNamespace}
              required
              maxLength={80}
              placeholder="main-office"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={mutation.isPending}
              aria-invalid={Boolean(sourceError)}
              aria-describedby={`${sourceId}-help${sourceError ? ` ${sourceId}-error` : ''}`}
              onBlur={() => {
                setSourceTouched(true);
              }}
              onChange={(event) => {
                setSourceNamespace(event.target.value);
              }}
            />
            <p id={`${sourceId}-help`} className="text-gray-dark text-sm">
              Choose a stable name for this source database, such as main-office. Reuse it for every
              upload from that database. Use a different name for a different database.
            </p>
            {sourceError ? (
              <p id={`${sourceId}-error`} role="alert" className="text-danger text-sm">
                {sourceError}
              </p>
            ) : null}
          </div>
          <div
            role="region"
            aria-label="CSV upload"
            className={cn(
              'rounded-card hairline-edge flex min-w-0 flex-col items-center gap-3 bg-white px-6 py-12 text-center transition-colors',
              dragActive ? 'bg-warm-stone/40' : '',
            )}
            onDragOver={(event) => {
              event.preventDefault();
              if (!submitting.current) setDragActive(true);
            }}
            onDragLeave={() => {
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              choose(event.dataTransfer.files[0]);
            }}
          >
            <p className="font-body max-w-full break-all text-2xl font-medium text-black">
              {picked?.name ?? 'Drop a CSV here'}
            </p>
            <p className="text-body text-gray-warm text-sm">
              {picked
                ? formatBytes(picked.size)
                : 'Up to 10 MB and 5,000 rows. CSV exports from Dentrix, Eaglesoft, or Open Dental.'}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,application/vnd.ms-excel"
              className="sr-only"
              disabled={mutation.isPending}
              aria-label="Choose CSV file"
              onChange={(event) => {
                choose(event.target.files?.[0]);
              }}
            />
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => inputRef.current?.click()}
                disabled={mutation.isPending}
              >
                {picked ? 'Choose a different file' : 'Choose CSV'}
              </Button>
              {picked ? (
                <Button type="submit" variant="primary" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Uploading…' : 'Upload claims'}
                </Button>
              ) : null}
              {picked ? (
                <Button type="button" variant="ghost" onClick={reset} disabled={mutation.isPending}>
                  Clear file
                </Button>
              ) : null}
            </div>
          </div>
          {mutation.isPending ? (
            <p role="status" className="text-gray-dark text-sm">
              Uploading claims and checking source identities…
            </p>
          ) : null}
          {localError ? (
            <p role="alert" className="text-danger text-sm">
              {localError}
            </p>
          ) : null}
          {mutation.error ? (
            <p role="alert" className="text-danger text-sm">
              {mutation.error.message}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}

function ResultCard({
  summary,
  onReset,
}: {
  readonly summary: ImportSummary;
  readonly onReset: () => void;
}): React.ReactElement {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <article
      aria-labelledby="import-result-heading"
      className="hairline-edge rounded-card flex min-w-0 flex-col gap-6 bg-white p-6"
    >
      <header className="flex flex-col gap-1">
        <h2
          ref={headingRef}
          tabIndex={-1}
          id="import-result-heading"
          className="font-body text-2xl font-medium text-black"
        >
          {summary.insertedRows > 0
            ? `Imported ${summary.insertedRows.toLocaleString()} new ${summary.insertedRows === 1 ? 'claim' : 'claims'}`
            : 'No new claims'}
        </h2>
        <p className="text-caption text-gray-dark">
          {SOURCE_LABELS[summary.source]} · Source database:{' '}
          <span className="break-all font-mono">{summary.sourceNamespace}</span>
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total rows" value={summary.totalRows} />
        <Stat label="Parsed rows" value={summary.validRows} />
        <Stat label="Imported" value={summary.insertedRows} />
        <Stat label="Unchanged" value={summary.skippedDuplicates} />
        <Stat label="Needs attention" value={summary.conflictRows} />
      </dl>
      {summary.conflictRows > 0 ? (
        <p className="text-warning text-sm">
          {summary.conflictRows.toLocaleString()}{' '}
          {summary.conflictRows === 1 ? 'row needs' : 'rows need'} attention. These rows were not
          imported or used to overwrite existing claims. Follow the steps in the row report.
        </p>
      ) : null}
      <RowReport rows={summary.rows} />
      {summary.errors.length > 0 ? <ErrorList errors={summary.errors} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Pill href="/dashboard/claims" variant="black" size="sm" withArrow>
          View claims queue
        </Pill>
        <Button type="button" variant="ghost" onClick={onReset}>
          Upload another file
        </Button>
      </div>
    </article>
  );
}

export function importRowReportCsv(rows: ImportSummary['rows']): string {
  const cell = (value: string): string => {
    const safe = /^[=+@-]/.test(value.trimStart()) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [
    '"rowIndex","disposition","claimId"',
    ...rows.map((row) =>
      [String(row.rowIndex), row.disposition, row.claimId ?? ''].map(cell).join(','),
    ),
  ].join('\r\n');
}

function RowReport({ rows }: { readonly rows: ImportSummary['rows'] }): React.ReactElement {
  const [page, setPage] = React.useState(0);
  const start = page * PAGE_SIZE;
  const download = (): void => {
    const url = URL.createObjectURL(
      new Blob([importRowReportCsv(rows)], { type: 'text/csv;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'claim-import-row-report.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section aria-labelledby="import-row-report-heading" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="import-row-report-heading" className="text-lg font-medium text-black">
          Row report
        </h3>
        {rows.length > 0 ? (
          <Button type="button" variant="ghost" onClick={download}>
            Download row report
          </Button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-gray-dark mt-3 text-sm">
          No rows were parsed. Review the validation errors and correct the source CSV.
        </p>
      ) : (
        <>
          <p className="text-gray-dark mt-2 text-sm">
            Download includes parsed row numbers, outcome codes and linked claim IDs only.
          </p>
          <ol className="divide-border-subtle mt-3 divide-y">
            {rows.slice(start, start + PAGE_SIZE).map((row) => (
              <li
                key={row.rowIndex}
                className="flex min-w-0 flex-col items-start gap-2 py-4 sm:flex-row sm:gap-4"
              >
                <span className="shrink-0 font-mono text-sm text-black">Row {row.rowIndex}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-black">{ROW_COPY[row.disposition].label}</p>
                  <p className="text-gray-dark mt-1 max-w-prose text-sm">
                    {ROW_COPY[row.disposition].nextStep}
                  </p>
                  {row.disposition === 'LEGACY_MATCH' && !row.claimId ? (
                    <p className="text-gray-dark mt-1 text-sm">
                      No single claim could be linked. Find the matching record in the claims queue.
                    </p>
                  ) : null}
                </div>
                {row.claimId ? (
                  <Link
                    className="text-brand inline-flex min-h-11 shrink-0 items-center text-sm font-medium underline underline-offset-4"
                    href={`/dashboard/claims/${encodeURIComponent(row.claimId)}`}
                    aria-label={`View claim for row ${String(row.rowIndex)}`}
                  >
                    View claim
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-gray-dark text-sm">
              Showing {String(start + 1)}–{String(Math.min(start + PAGE_SIZE, rows.length))} of{' '}
              {rows.length.toLocaleString()} rows
            </p>
            {rows.length > PAGE_SIZE ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={page === 0}
                  onClick={() => {
                    setPage(page - 1);
                  }}
                >
                  Previous rows
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={start + PAGE_SIZE >= rows.length}
                  onClick={() => {
                    setPage(page + 1);
                  }}
                >
                  Next rows
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-gray-warm uppercase tracking-[0.12em]">{label}</dt>
      <dd className="font-body text-2xl font-medium tabular-nums text-black">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function ErrorList({ errors }: { readonly errors: ImportSummary['errors'] }): React.ReactElement {
  const [page, setPage] = React.useState(0);
  const start = page * PAGE_SIZE;
  return (
    <details className="rounded-card bg-warm-stone/30 px-5 py-4">
      <summary className="text-body cursor-pointer text-sm font-medium text-black">
        {errors.length.toLocaleString()} validation {errors.length === 1 ? 'error' : 'errors'} to
        review
      </summary>
      <ul aria-label="Validation errors" className="text-body mt-3 flex flex-col gap-1 text-sm">
        {errors.slice(start, start + PAGE_SIZE).map((error, index) => (
          <li
            key={`${String(error.rowIndex)}.${String(start + index)}`}
            className="text-gray-dark break-words"
          >
            <span className="font-mono text-black">Row {error.rowIndex}:</span> {error.message}
          </li>
        ))}
      </ul>
      <p role="status" className="text-gray-dark mt-3 text-sm">
        Showing {String(start + 1)}–{String(Math.min(start + PAGE_SIZE, errors.length))} of{' '}
        {errors.length.toLocaleString()} errors. Correct the source CSV and upload again using the
        same source database name.
      </p>
      {errors.length > PAGE_SIZE ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={page === 0}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            Previous errors
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={start + PAGE_SIZE >= errors.length}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            Next errors
          </Button>
        </div>
      ) : null}
    </details>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
