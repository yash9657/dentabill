/**
 * CSV ingestion contract — shared between the parser, the bulk-insert
 * step, and the eventual upload UI.
 *
 *   parseClaimsCSV(buffer) → ParseResult
 *
 * The parser detects which source system produced the file from the
 * header row, validates each data row against a per-source Zod
 * schema, normalises dates / amounts / payer codes / procedure-code
 * lists into a canonical shape, and returns *both* the accepted rows
 * and a typed error list. Failed rows do not abort the whole import:
 * the upload UI shows the count + a downloadable error CSV.
 *
 * No PHI ever leaves this module via logs — see ADR-006 + the
 * `@dentabill/logger` redact list. The parser intentionally never
 * accepts a logger; it's a pure transform.
 */
import type { PayerCode } from '@dentabill/db';

import type { ImportedSourceDetails } from './source-details.js';

export const SUPPORTED_CSV_SOURCES = ['DENTRIX', 'EAGLESOFT', 'OPEN_DENTAL'] as const;
export type CsvSource = (typeof SUPPORTED_CSV_SOURCES)[number];
export const MAX_IMPORT_ROWS = 5000;

/**
 * Canonical row produced after detection + parse + normalise. Row
 * indexes are 1-based so the upload UI can highlight the same line
 * the user sees in their spreadsheet.
 */
export interface CanonicalClaimRow {
  readonly rowIndex: number;
  /** Patient DOB as ISO `YYYY-MM-DD`. The hash + last-4 are derived later. */
  readonly patientDOB: string;
  /** Display/reference number; never treated as a stable source identity. */
  readonly claimNumber: string;
  /** Explicit source record ID, preserving case and leading zeroes; absent stays null. */
  readonly sourceClaimId: string | null;
  /** Opaque source edit/version marker; no ordering is inferred. */
  readonly sourceVersion: string | null;
  /** Optional source patient reference; never inferred from DOB or subscriber identity. */
  readonly sourcePatientId: string | null;
  /**
   * All exact source cell values, keyed by trimmed lowercase headers in
   * deterministic binary order. Transient input to the keyed import fingerprint
   * only: never persist, log, or expose these potentially sensitive raw cells.
   */
  readonly sourceFields: readonly (readonly [string, string])[];
  /** Optional explicit source facts; absent data is never synthesized from the header. */
  readonly sourceDetails: ImportedSourceDetails | null;
  /** Decimal(10,2) amount with exactly two fractional digits (no `$`, no commas). */
  readonly claimAmount: string;
  /** ADA / CDT procedure codes. Preserved order, no duplicates. */
  readonly cdtCodes: readonly string[];
  /** Service date as ISO `YYYY-MM-DD`. */
  readonly serviceDate: string;
  /** Submission date as ISO `YYYY-MM-DD`, or null when blank. */
  readonly submittedDate: string | null;
  /**
   * Insurance subscriber ID — the policy-side identifier the IVR
   * usually requests. Optional because some source systems (Dentrix)
   * don't surface it on every claim layout; calls remain blocked
   * until the missing identity is supplied.
   */
  readonly subscriberId: string | null;
  /**
   * The mapped `PayerCode` enum value. `UNKNOWN` when no rule
   * matched. The original free-text label is retained separately
   * so distinct unrecognised payers do not become identical source facts.
   */
  readonly payerCode: PayerCode;
  /** Exact source payer cell, not the resolver's canonical display label. */
  readonly payerLabel: string;
}

export interface ParseRowError {
  readonly rowIndex: number;
  readonly column?: string;
  readonly message: string;
}

export interface ParseResult {
  readonly source: CsvSource;
  readonly rows: readonly CanonicalClaimRow[];
  readonly errors: readonly ParseRowError[];
}

export class UnknownCsvFormatError extends Error {
  public constructor() {
    super(
      'Unrecognised or ambiguous CSV format. Supported sources: Dentrix, Eaglesoft, Open Dental.',
    );
    this.name = 'UnknownCsvFormatError';
  }
}

export class CsvRowLimitError extends Error {
  public constructor() {
    super(`CSV exceeds the ${String(MAX_IMPORT_ROWS)} data-record limit, including blank records.`);
    this.name = 'CsvRowLimitError';
  }
}
