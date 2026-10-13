import { resolvePayerCode } from '@dentabill/payer-ivr';
import Papa from 'papaparse';

import { detectCsvSource } from './detector.js';
import {
  normaliseAmount,
  normaliseCodes,
  normaliseDate,
  normaliseDateOptional,
  normaliseOpaqueId,
} from './normalisers.js';
import { CsvChildLimitError, MAX_IMPORT_CHILDREN, parseSourceDetails } from './source-details.js';
import {
  CsvRowLimitError,
  MAX_IMPORT_ROWS,
  UnknownCsvFormatError,
  type CanonicalClaimRow,
  type CsvSource,
  type ParseResult,
  type ParseRowError,
} from './types.js';

/**
 * Per-source column-name → field-name map. Lowercase + trimmed keys
 * so the parser is tolerant of header casing variations.
 */
const COLUMN_MAPS: Readonly<Record<CsvSource, Readonly<Record<string, ColumnRole>>>> = {
  DENTRIX: {
    'patient id': 'sourcePatientId',
    dob: 'dob',
    'insurance carrier': 'carrier',
    'claim #': 'claimNumber',
    'procedure codes': 'cdtCodes',
    charge: 'amount',
    'service date': 'serviceDate',
    'submission date': 'submittedDate',
    'subscriber id': 'subscriberId',
    sourceclaimid: 'sourceClaimId',
    sourceversion: 'sourceVersion',
    claimlines: 'claimLines',
    coverages: 'coverages',
  },
  EAGLESOFT: {
    ptid: 'sourcePatientId',
    ptbirthdate: 'dob',
    carrier: 'carrier',
    claimnum: 'claimNumber',
    adacodes: 'cdtCodes',
    amount: 'amount',
    dos: 'serviceDate',
    submittedon: 'submittedDate',
    subscriberid: 'subscriberId',
    sourceclaimid: 'sourceClaimId',
    sourceversion: 'sourceVersion',
    claimlines: 'claimLines',
    coverages: 'coverages',
  },
  OPEN_DENTAL: {
    patnum: 'sourcePatientId',
    birthdate: 'dob',
    inscarrier: 'carrier',
    claimident: 'claimNumber',
    proccodes: 'cdtCodes',
    claimfee: 'amount',
    procdate: 'serviceDate',
    datesent: 'submittedDate',
    subscriberid: 'subscriberId',
    sourceclaimid: 'sourceClaimId',
    // Open Dental's record key is ClaimNum; ClaimIdent remains only display/reference text.
    claimnum: 'sourceClaimId',
    sourceversion: 'sourceVersion',
    claimlines: 'claimLines',
    coverages: 'coverages',
    secdatetedit: 'sourceVersion',
  },
};

type ColumnRole =
  | 'sourcePatientId'
  | 'sourceClaimId'
  | 'sourceVersion'
  | 'claimLines'
  | 'coverages'
  | 'dob'
  | 'carrier'
  | 'claimNumber'
  | 'cdtCodes'
  | 'amount'
  | 'serviceDate'
  | 'submittedDate'
  | 'subscriberId';

const CODE_SEPARATORS: Readonly<Record<CsvSource, readonly string[]>> = {
  DENTRIX: [',', ';'],
  EAGLESOFT: [';', ','],
  OPEN_DENTAL: [' ', ',', ';'],
};

const REQUIRED_FIELDS: readonly Exclude<
  ColumnRole,
  | 'sourcePatientId'
  | 'sourceClaimId'
  | 'sourceVersion'
  | 'submittedDate'
  | 'subscriberId'
  | 'claimLines'
  | 'coverages'
>[] = ['dob', 'carrier', 'claimNumber', 'cdtCodes', 'amount', 'serviceDate'];

/**
 * Parse a CSV buffer (UTF-8) into canonical claim rows. The parser
 * first detects which of the three source systems produced the file
 * from the header row, then validates + normalises each row in a
 * single pass.
 *
 * Rows that fail validation are reported via `errors` rather than
 * aborting the parse — billers can fix the source CSV and re-upload
 * without losing the rows that did parse.
 */
export function parseClaimsCSV(buffer: Buffer): ParseResult {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new UnknownCsvFormatError();
  }
  // Keep cells positional until headers are validated. Object-mode parsing can
  // rename duplicate headers or overwrite an earlier identity column.
  const parsed = Papa.parse<string[]>(text, {
    header: false,
    delimiter: ',',
    // Papa's unquoted fast path splits the entire file before applying preview.
    // Use record-wise parsing so blank floods cannot bypass the materialization bound.
    fastMode: false,
    // Papa's error.row counts blank records, so filtering them here would
    // detach malformed-row errors from the returned positional data.
    skipEmptyLines: false,
    preview: MAX_IMPORT_ROWS + 2,
  });
  // A final line terminator produces one synthetic empty Papa record. It is
  // not another data row; all actual blank logical records still count.
  const last = parsed.data.at(-1);
  if (!parsed.meta.truncated && /[\r\n]$/.test(text) && last?.length === 1 && last[0] === '')
    parsed.data.pop();
  if (parsed.meta.truncated || parsed.data.length > MAX_IMPORT_ROWS + 1)
    throw new CsvRowLimitError();
  const empty = (cells: readonly string[]): boolean => cells.every((cell) => !cell.trim());
  const headerIndex = parsed.data.findIndex((cells) => !empty(cells));
  const headers = (parsed.data[headerIndex] ?? []).map((header) => header.trim());
  const normalisedHeaders = headers.map((header) => header.toLowerCase());
  if (
    headers.some((header) => !header) ||
    new Set(normalisedHeaders).size !== headers.length ||
    parsed.errors.some((error) => error.row === undefined || error.row <= headerIndex)
  )
    throw new UnknownCsvFormatError();
  const source = detectCsvSource(headers);
  if (!source) throw new UnknownCsvFormatError();

  const map = COLUMN_MAPS[source];
  const roleToColumn: Partial<Record<ColumnRole, number>> = {};
  headers.forEach((header, index) => {
    const role = map[header.toLowerCase()];
    if (role) {
      if (roleToColumn[role] !== undefined) throw new UnknownCsvFormatError();
      roleToColumn[role] = index;
    }
  });
  for (const required of REQUIRED_FIELDS) {
    if (roleToColumn[required] === undefined) {
      throw new UnknownCsvFormatError();
    }
  }

  const rows: CanonicalClaimRow[] = [];
  let childCount = 0;
  const errors: ParseRowError[] = [];

  const malformedRecords = new Set(parsed.errors.map((error) => error.row));
  parsed.data.forEach((cells, idx) => {
    if (idx <= headerIndex || (empty(cells) && !malformedRecords.has(idx))) return;
    const rowIndex = idx + 1; // Record index including the header and blanks, 1-based.
    if (cells.length !== headers.length || malformedRecords.has(idx)) {
      errors.push({ rowIndex, message: 'CSV row: malformed record or incorrect column count' });
      return;
    }
    try {
      const row = normaliseRow({
        cells,
        headers: normalisedHeaders,
        rowIndex,
        source,
        roleToColumn,
      });
      childCount +=
        (row.sourceDetails?.lines.length ?? 0) + (row.sourceDetails?.coverages.length ?? 0);
      if (childCount > MAX_IMPORT_CHILDREN) throw new CsvChildLimitError();
      rows.push(row);
    } catch (err) {
      if (err instanceof CsvChildLimitError) throw err;
      errors.push({
        rowIndex,
        message: err instanceof Error ? err.message : 'Unknown parse error',
      });
    }
  });

  return { source, rows, errors };
}

function normaliseRow(args: {
  readonly cells: readonly string[];
  readonly headers: readonly string[];
  readonly rowIndex: number;
  readonly source: CsvSource;
  readonly roleToColumn: Partial<Record<ColumnRole, number>>;
}): CanonicalClaimRow {
  const { cells, headers, rowIndex, source, roleToColumn } = args;

  const get = (role: ColumnRole): string => {
    const column = roleToColumn[role];
    return column === undefined ? '' : (cells[column] ?? '');
  };

  const dob = normaliseDate(get('dob'), 'patient DOB');
  const claimNumber = normaliseOpaqueId(get('claimNumber'), 'claimNumber');
  if (!claimNumber) throw new Error('claimNumber: empty');
  const sourceClaimId = normaliseOpaqueId(get('sourceClaimId'), 'sourceClaimId');
  const sourceVersion = normaliseOpaqueId(get('sourceVersion'), 'sourceVersion');
  const sourcePatientId = normaliseOpaqueId(get('sourcePatientId'), 'sourcePatientId');

  const cdtCodes = normaliseCodes(get('cdtCodes'), CODE_SEPARATORS[source]);
  if (cdtCodes.length === 0) throw new Error('cdtCodes: empty');

  const claimAmount = normaliseAmount(get('amount'), 'claimAmount');
  const sourceDetails = parseSourceDetails(
    get('claimLines'),
    get('coverages'),
    claimAmount,
    cdtCodes,
  );
  const serviceDate = normaliseDate(get('serviceDate'), 'serviceDate');
  const submittedDate = normaliseDateOptional(get('submittedDate'), 'submittedDate');

  const carrierRaw = get('carrier');
  const payer = resolvePayerCode(carrierRaw);

  // Subscriber ID is optional — Dentrix layouts often omit it. Empty
  // string and absent header both normalise to null; outbound calls
  // remain blocked until the missing subscriber identity is supplied.
  const subscriberId = normaliseOpaqueId(get('subscriberId'), 'subscriberId');
  // Domain normalization intentionally drops or changes some exported fields.
  // Keep every exact cell transiently so keyed comparison detects source edits
  // without storing those cells or treating normalization as evidence of equality.
  const sourceFields = headers
    .map((header, index) => [header, cells[index] ?? ''] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return {
    rowIndex,
    patientDOB: dob,
    claimNumber,
    sourceClaimId,
    sourceVersion,
    sourcePatientId,
    sourceFields,
    sourceDetails,
    claimAmount,
    cdtCodes,
    serviceDate,
    submittedDate,
    subscriberId,
    payerCode: payer.code,
    payerLabel: carrierRaw,
  };
}
