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

export const SUPPORTED_CSV_SOURCES = ['DENTRIX', 'EAGLESOFT', 'OPEN_DENTAL'] as const;
export type CsvSource = (typeof SUPPORTED_CSV_SOURCES)[number];

/**
 * Canonical row produced after detection + parse + normalise. Row
 * indexes are 1-based so the upload UI can highlight the same line
 * the user sees in their spreadsheet.
 */
export interface CanonicalClaimRow {
  readonly rowIndex: number;
  /** Patient DOB as ISO `YYYY-MM-DD`. The hash + last-4 are derived later. */
  readonly patientDOB: string;
  /** Source-system claim identifier — preserved verbatim. */
  readonly claimNumber: string;
  /** Decimal-string amount (no `$`, no commas). */
  readonly claimAmount: string;
  /** ADA / CDT procedure codes. Preserved order, no duplicates. */
  readonly cdtCodes: readonly string[];
  /** Service date as ISO `YYYY-MM-DD`. */
  readonly serviceDate: string;
  /** Submission date as ISO `YYYY-MM-DD`, or null when blank. */
  readonly submittedDate: string | null;
  /**
   * The mapped `PayerCode` enum value. `UNKNOWN` when no rule
   * matched — the original free-text label is preserved on
   * `payerLabel` so the import summary can show "we didn't
   * recognise '<their text>'".
   */
  readonly payerCode: PayerCode;
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
  public constructor(public readonly headers: readonly string[]) {
    super('Unrecognised CSV format. Supported sources: Dentrix, Eaglesoft, Open Dental.');
    this.name = 'UnknownCsvFormatError';
  }
}
