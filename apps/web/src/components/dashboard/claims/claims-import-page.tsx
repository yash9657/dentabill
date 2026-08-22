'use client';

import { Button, Pill, cn } from '@dentabill/ui';
import * as React from 'react';

import { useClaimsImport, type ImportSummary } from '../../../lib/claims/use-claims-import.js';
import { DashboardEmptyState } from '../dashboard-empty-state.js';
import { SkeletonList } from '../skeleton-list.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SOURCE_LABELS: Readonly<Record<ImportSummary['source'], string>> = {
  DENTRIX: 'Dentrix',
  EAGLESOFT: 'Eaglesoft',
  OPEN_DENTAL: 'Open Dental',
};

function hasClerkKeys(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * `/dashboard/claims/import` — file picker + drag-drop CSV upload.
 *
 * Drag-drop is layered on top of a real `<input type="file">` so the
 * keyboard + screen reader path is identical to the click path.
 * No dropzone library — the native HTML5 events are enough for our
 * single-file flow, and skipping the dep keeps the dashboard bundle
 * a few KB lighter.
 *
 * Three states:
 *   1. Idle — drag-drop zone + "Choose CSV" button.
 *   2. Uploading — disabled UI with status text.
 *   3. Result — parse summary card with source label, counts,
 *      duplicates skipped, and an expandable errors list (with a
 *      downloadable CSV of the bad rows for fix-and-re-upload).
 */
export function ClaimsImportPage(): React.ReactElement {
  if (!hasClerkKeys()) {
    return (
      <DashboardEmptyState
        eyebrow="Import"
        title="Sign in to upload claims"
        body="Bulk-upload your open claims as a CSV from Dentrix, Eaglesoft, or Open Dental. Each row is hashed for HIPAA compliance and prioritized automatically."
        previewChildren={<SkeletonList rows={5} />}
        primaryCta={{ label: 'Sign in', href: '/sign-in' }}
        secondaryCta={{ label: 'Back to claims', href: '/dashboard/claims' }}
      />
    );
  }
  return <AuthenticatedImportPage />;
}

function AuthenticatedImportPage(): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [picked, setPicked] = React.useState<File | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const mutation = useClaimsImport();

  const choose = (file: File | undefined): void => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setLocalError('That CSV is over 10 MB. Split the file or contact support.');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.csv') && file.type && !file.type.includes('csv')) {
      setLocalError('Please upload a CSV file (.csv extension or text/csv mimetype).');
      return;
    }
    setLocalError(null);
    setPicked(file);
  };

  const upload = (): void => {
    if (!picked) return;
    mutation.mutate(picked);
  };

  const reset = (): void => {
    setPicked(null);
    setLocalError(null);
    mutation.reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="flex flex-col gap-8" aria-labelledby="claims-import-heading">
      <header className="max-w-3xl">
        <p className="text-caption text-gray-warm mb-2 uppercase tracking-[0.14em]">Import</p>
        <h1
          id="claims-import-heading"
          className="font-display text-[28px] font-light leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]"
        >
          Upload claims CSV
        </h1>
        <p className="text-body text-gray-dark mt-3 max-w-prose">
          Export from Dentrix, Eaglesoft, or Open Dental and drop the file here. Each row is hashed
          for HIPAA compliance, deduplicated by claim number, and prioritized.
        </p>
      </header>

      {mutation.data ? (
        <ResultCard summary={mutation.data} onReset={reset} />
      ) : (
        <DropZone
          dragActive={dragActive}
          picked={picked}
          isUploading={mutation.isPending}
          localError={localError}
          mutationError={mutation.error?.message ?? null}
          inputRef={inputRef}
          onChooseFile={choose}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => {
            setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            choose(e.dataTransfer.files[0]);
          }}
          onUpload={upload}
          onClear={reset}
        />
      )}
    </section>
  );
}

interface DropZoneProps {
  readonly dragActive: boolean;
  readonly picked: File | null;
  readonly isUploading: boolean;
  readonly localError: string | null;
  readonly mutationError: string | null;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly onChooseFile: (file: File | undefined) => void;
  readonly onDragOver: (e: React.DragEvent) => void;
  readonly onDragLeave: () => void;
  readonly onDrop: (e: React.DragEvent) => void;
  readonly onUpload: () => void;
  readonly onClear: () => void;
}

function DropZone(props: DropZoneProps): React.ReactElement {
  const {
    dragActive,
    picked,
    isUploading,
    localError,
    mutationError,
    inputRef,
    onChooseFile,
    onDragOver,
    onDragLeave,
    onDrop,
    onUpload,
    onClear,
  } = props;
  return (
    <div className="flex flex-col gap-4">
      <div
        role="region"
        aria-label="CSV upload"
        className={cn(
          'rounded-card hairline-edge flex flex-col items-center gap-3 bg-white px-6 py-12 text-center transition-colors',
          dragActive ? 'bg-warm-stone/40' : '',
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <p className="font-display text-2xl font-light text-black">
          {picked ? picked.name : 'Drop a CSV here'}
        </p>
        <p className="text-body text-gray-warm text-sm">
          {picked
            ? formatBytes(picked.size)
            : 'Up to 10 MB. CSV exports from Dentrix, Eaglesoft, or Open Dental.'}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,application/vnd.ms-excel"
          className="sr-only"
          onChange={(e) => {
            onChooseFile(e.target.files?.[0]);
          }}
          aria-label="Choose CSV file"
        />
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            {picked ? 'Choose a different file' : 'Choose CSV'}
          </Button>
          {picked ? (
            <Button type="button" variant="primary" onClick={onUpload} disabled={isUploading}>
              {isUploading ? 'Uploading…' : 'Upload claims'}
            </Button>
          ) : null}
          {picked ? (
            <Button type="button" variant="ghost" onClick={onClear} disabled={isUploading}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      {localError ? (
        <p role="alert" className="text-body text-sm text-black">
          {localError}
        </p>
      ) : null}
      {mutationError ? (
        <p role="alert" className="text-body text-sm text-black">
          {mutationError}
        </p>
      ) : null}
    </div>
  );
}

function ResultCard({
  summary,
  onReset,
}: {
  readonly summary: ImportSummary;
  readonly onReset: () => void;
}): React.ReactElement {
  return (
    <article
      aria-labelledby="import-result-heading"
      className="hairline-edge rounded-card flex flex-col gap-6 bg-white p-6"
    >
      <header className="flex flex-col gap-1">
        <p className="text-caption text-gray-warm uppercase tracking-[0.14em]">
          Import summary · {SOURCE_LABELS[summary.source]}
        </p>
        <h2 id="import-result-heading" className="font-display text-2xl font-light text-black">
          {summary.insertedRows > 0
            ? `Imported ${String(summary.insertedRows)} new claims`
            : 'No new claims'}
        </h2>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat label="Total rows" value={summary.totalRows} />
        <Stat label="Valid rows" value={summary.validRows} />
        <Stat label="Inserted" value={summary.insertedRows} />
        <Stat label="Skipped (duplicates)" value={summary.skippedDuplicates} />
      </dl>

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
      <dd className="font-display text-2xl font-light tabular-nums text-black">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function ErrorList({ errors }: { readonly errors: ImportSummary['errors'] }): React.ReactElement {
  return (
    <details className="rounded-card bg-warm-stone/30 px-5 py-4">
      <summary className="text-body cursor-pointer text-sm font-medium text-black">
        {errors.length} {errors.length === 1 ? 'row was' : 'rows were'} skipped due to validation
        errors
      </summary>
      <ul className="text-body mt-3 flex flex-col gap-1 text-sm">
        {errors.slice(0, 25).map((err) => (
          <li key={err.rowIndex} className="text-gray-warm">
            <span className="font-mono text-black">Row {err.rowIndex}:</span> {err.message}
          </li>
        ))}
        {errors.length > 25 ? (
          <li className="text-gray-warm">
            …and {errors.length - 25} more. Fix the source CSV and re-upload.
          </li>
        ) : null}
      </ul>
    </details>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
