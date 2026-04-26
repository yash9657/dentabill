import { resolvePayerCode } from '@dentabill/payer-ivr';
import Papa from 'papaparse';

import { detectCsvSource } from './detector.js';
import {
  normaliseAmount,
  normaliseCodes,
  normaliseDate,
  normaliseDateOptional,
} from './normalisers.js';
import {
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
    'patient id': 'patientId',
    dob: 'dob',
    'insurance carrier': 'carrier',
    'claim #': 'claimNumber',
    'procedure codes': 'cdtCodes',
    charge: 'amount',
    'service date': 'serviceDate',
    'submission date': 'submittedDate',
  },
  EAGLESOFT: {
    ptid: 'patientId',
    ptbirthdate: 'dob',
    carrier: 'carrier',
    claimnum: 'claimNumber',
    adacodes: 'cdtCodes',
    amount: 'amount',
    dos: 'serviceDate',
    submittedon: 'submittedDate',
  },
  OPEN_DENTAL: {
    patnum: 'patientId',
    birthdate: 'dob',
    inscarrier: 'carrier',
    claimident: 'claimNumber',
    proccodes: 'cdtCodes',
    claimfee: 'amount',
    procdate: 'serviceDate',
    datesent: 'submittedDate',
  },
};

type ColumnRole =
  | 'patientId'
  | 'dob'
  | 'carrier'
  | 'claimNumber'
  | 'cdtCodes'
  | 'amount'
  | 'serviceDate'
  | 'submittedDate';

const CODE_SEPARATORS: Readonly<Record<CsvSource, readonly string[]>> = {
  DENTRIX: [',', ';'],
  EAGLESOFT: [';', ','],
  OPEN_DENTAL: [' ', ',', ';'],
};

const REQUIRED_FIELDS: readonly Exclude<ColumnRole, 'patientId' | 'submittedDate'>[] = [
  'dob',
  'carrier',
  'claimNumber',
  'cdtCodes',
  'amount',
  'serviceDate',
];

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
  const text = buffer.toString('utf8');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  const source = detectCsvSource(headers);
  if (!source) throw new UnknownCsvFormatError(headers);

  const map = COLUMN_MAPS[source];
  // Build a lookup from role -> the *exact* original header text so
  // we can pull the value out of each row by key.
  const roleToHeader: Partial<Record<ColumnRole, string>> = {};
  for (const header of headers) {
    const role = map[header.trim().toLowerCase()];
    if (role) roleToHeader[role] = header;
  }
  for (const required of REQUIRED_FIELDS) {
    if (!roleToHeader[required]) {
      throw new UnknownCsvFormatError(headers);
    }
  }

  const rows: CanonicalClaimRow[] = [];
  const errors: ParseRowError[] = [];

  parsed.data.forEach((raw, idx) => {
    const rowIndex = idx + 2; // +1 for header, +1 to make 1-based
    try {
      rows.push(normaliseRow({ raw, rowIndex, source, roleToHeader }));
    } catch (err) {
      errors.push({
        rowIndex,
        message: err instanceof Error ? err.message : 'Unknown parse error',
      });
    }
  });

  return { source, rows, errors };
}

function normaliseRow(args: {
  readonly raw: Record<string, string>;
  readonly rowIndex: number;
  readonly source: CsvSource;
  readonly roleToHeader: Partial<Record<ColumnRole, string>>;
}): CanonicalClaimRow {
  const { raw, rowIndex, source, roleToHeader } = args;

  const get = (role: ColumnRole): string => {
    const header = roleToHeader[role];
    if (!header) throw new Error(`internal: missing header for role ${role}`);
    const value = raw[header];
    return typeof value === 'string' ? value : '';
  };

  const dob = normaliseDate(get('dob'), 'patient DOB');
  const claimNumber = get('claimNumber').trim();
  if (claimNumber.length === 0) throw new Error('claimNumber: empty');

  const cdtCodes = normaliseCodes(get('cdtCodes'), CODE_SEPARATORS[source]);
  if (cdtCodes.length === 0) throw new Error('cdtCodes: empty');

  const claimAmount = normaliseAmount(get('amount'), 'claimAmount');
  const serviceDate = normaliseDate(get('serviceDate'), 'serviceDate');
  const submittedDate = normaliseDateOptional(get('submittedDate'), 'submittedDate');

  const carrierRaw = get('carrier');
  const payer = resolvePayerCode(carrierRaw);

  return {
    rowIndex,
    patientDOB: dob,
    claimNumber,
    claimAmount,
    cdtCodes,
    serviceDate,
    submittedDate,
    payerCode: payer.code,
    payerLabel: payer.label,
  };
}
