import { describe, expect, it, vi } from 'vitest';

import { detectCsvSource } from './detector.js';
import * as normalisers from './normalisers.js';
import { parseClaimsCSV } from './parser.js';
import { CsvRowLimitError, MAX_IMPORT_ROWS, UnknownCsvFormatError } from './types.js';

const DENTRIX_CSV = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status
P0001,"Sample, A",1990-05-12,Delta Dental PPO,CL-1,D2740,1240.00,2026-01-08,2026-01-09,Submitted
P0002,"Sample, B",1985-11-30,DELTA DENTAL OF CA - PPO,CL-2,"D0150,D1110",215.50,2026-01-12,,Pending
P0003,"Sample, C",not-a-date,Cigna Dental,CL-3,D2950,485.00,2026-01-14,,Pending
`;

const EAGLESOFT_CSV = `PtID,PtFirstName,PtLastName,PtBirthDate,Carrier,ClaimNum,ADACodes,Amount,DOS,SubmittedOn
EG001,Alpha,Smith,5/12/1990,DELTA PPO,EGS-1,D2740,$1240.00,01/08/2026,01/09/2026
EG002,Beta,Smith,11/30/1985,Tricare Dental,EGS-2,D0150;D1110,$215.50,01/12/2026,
`;

const OPEN_DENTAL_CSV = `PatNum,LName,FName,Birthdate,InsCarrier,ClaimIdent,ProcCodes,ClaimFee,ProcDate,DateSent
1001,Smith,Alpha,1990-05-12,Delta Dental PPO,OD-1,D2740 D2950,1240.00,2026-01-08,2026-01-09
`;

describe('detectCsvSource', () => {
  it('identifies Dentrix from its header signature', () => {
    expect(
      detectCsvSource(['Patient ID', 'Patient Name', 'DOB', 'Insurance Carrier', 'Service Date']),
    ).toBe('DENTRIX');
  });

  it('identifies Eaglesoft from its header signature', () => {
    expect(detectCsvSource(['PtID', 'Carrier', 'ClaimNum', 'DOS'])).toBe('EAGLESOFT');
  });

  it('identifies Open Dental from its header signature', () => {
    expect(detectCsvSource(['PatNum', 'InsCarrier', 'ProcDate', 'ClaimFee'])).toBe('OPEN_DENTAL');
  });

  it('returns null for an unknown header set', () => {
    expect(detectCsvSource(['Foo', 'Bar', 'Baz'])).toBeNull();
  });

  it('rejects a header set containing multiple source signatures', () => {
    expect(
      detectCsvSource([
        'Patient ID',
        'Insurance Carrier',
        'Service Date',
        'PtID',
        'Carrier',
        'DOS',
      ]),
    ).toBeNull();
  });
});

describe('parseClaimsCSV', () => {
  it('parses a Dentrix CSV: ISO dates, comma-separated codes, free-text payer', () => {
    const result = parseClaimsCSV(Buffer.from(DENTRIX_CSV, 'utf8'));
    expect(result.source).toBe('DENTRIX');
    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(1);

    const [first, second] = result.rows;
    expect(first?.claimNumber).toBe('CL-1');
    expect(first?.serviceDate).toBe('2026-01-08');
    expect(first?.submittedDate).toBe('2026-01-09');
    expect(first?.cdtCodes).toEqual(['D2740']);
    expect(first?.payerCode).toBe('DELTA_DENTAL_PPO');
    expect(first?.payerLabel).toBe('Delta Dental PPO');
    expect(first?.claimAmount).toBe('1240.00');

    expect(second?.cdtCodes).toEqual(['D0150', 'D1110']);
    expect(second?.submittedDate).toBeNull();
    expect(second?.payerCode).toBe('DELTA_DENTAL_PPO');

    const [error] = result.errors;
    expect(error?.rowIndex).toBe(4);
    expect(error?.message).toMatch(/DOB/);
  });

  it('parses Eaglesoft: US dates, $-amounts, semicolon-separated codes', () => {
    const result = parseClaimsCSV(Buffer.from(EAGLESOFT_CSV, 'utf8'));
    expect(result.source).toBe('EAGLESOFT');
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);

    const [first, second] = result.rows;
    expect(first?.patientDOB).toBe('1990-05-12');
    expect(first?.serviceDate).toBe('2026-01-08');
    expect(first?.submittedDate).toBe('2026-01-09');
    expect(first?.claimAmount).toBe('1240.00');
    expect(first?.payerCode).toBe('DELTA_DENTAL_PPO');

    expect(second?.cdtCodes).toEqual(['D0150', 'D1110']);
    expect(second?.payerCode).toBe('UNITED_CONCORDIA');
    expect(second?.submittedDate).toBeNull();
  });

  it('parses Open Dental: ISO dates, space-separated codes', () => {
    const result = parseClaimsCSV(Buffer.from(OPEN_DENTAL_CSV, 'utf8'));
    expect(result.source).toBe('OPEN_DENTAL');
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.cdtCodes).toEqual(['D2740', 'D2950']);
  });

  it('produces the same canonical patientDOB across all three formats for the same patient', () => {
    const dx = parseClaimsCSV(Buffer.from(DENTRIX_CSV, 'utf8')).rows[0]?.patientDOB;
    const eg = parseClaimsCSV(Buffer.from(EAGLESOFT_CSV, 'utf8')).rows[0]?.patientDOB;
    const od = parseClaimsCSV(Buffer.from(OPEN_DENTAL_CSV, 'utf8')).rows[0]?.patientDOB;
    expect(dx).toBe('1990-05-12');
    expect(eg).toBe('1990-05-12');
    expect(od).toBe('1990-05-12');
  });

  it('throws UnknownCsvFormatError on unrecognised headers', () => {
    const csv = 'foo,bar,baz\n1,2,3\n';
    expect(() => parseClaimsCSV(Buffer.from(csv, 'utf8'))).toThrow(UnknownCsvFormatError);
  });

  it('preserves the unrecognised payer label verbatim with UNKNOWN code', () => {
    const csv = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status
P1,"Sample",1990-05-12,Some Indie BCBS,CL-X,D2740,500.00,2026-01-08,,Pending
`;
    const result = parseClaimsCSV(Buffer.from(csv, 'utf8'));
    expect(result.rows[0]?.payerCode).toBe('UNKNOWN');
    expect(result.rows[0]?.payerLabel).toBe('Some Indie BCBS');
  });

  // P4-T1C / ADR-045 — subscriberId is the optional expand-step column.
  // Open Dental + Eaglesoft surface it on most layouts; Dentrix often
  // omits it. Parser must tolerate both shapes; absent header => null,
  // empty cell => null, present cell => trimmed string.
  it('extracts subscriberId from Open Dental when the header is present', () => {
    const csv = `PatNum,LName,FName,Birthdate,InsCarrier,ClaimIdent,ProcCodes,ClaimFee,ProcDate,DateSent,SubscriberID
1001,Smith,Alpha,1990-05-12,Delta Dental PPO,OD-1,D2740,1240.00,2026-01-08,2026-01-09,SUB-12345
1002,Smith,Beta,1985-11-30,Cigna Dental,OD-2,D0150,200.00,2026-02-01,,
`;
    const result = parseClaimsCSV(Buffer.from(csv, 'utf8'));
    expect(result.rows[0]?.subscriberId).toBe('SUB-12345');
    expect(result.rows[1]?.subscriberId).toBeNull();
  });

  it('returns null subscriberId when the source layout omits the column', () => {
    const result = parseClaimsCSV(Buffer.from(DENTRIX_CSV, 'utf8'));
    expect(result.rows.every((r) => r.subscriberId === null)).toBe(true);
  });

  it('extracts subscriberId from Eaglesoft', () => {
    const csv = `PtID,PtFirstName,PtLastName,PtBirthDate,Carrier,ClaimNum,ADACodes,Amount,DOS,SubmittedOn,SubscriberID
EG001,Alpha,Smith,5/12/1990,DELTA PPO,EGS-1,D2740,$1240.00,01/08/2026,01/09/2026,EG-SUB-9999
`;
    const result = parseClaimsCSV(Buffer.from(csv, 'utf8'));
    expect(result.rows[0]?.subscriberId).toBe('EG-SUB-9999');
  });

  it('deduplicates procedure codes within a row', () => {
    const csv = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status
P1,"Sample",1990-05-12,Delta PPO,CL-D,"D2740,d2740,D0150",500.00,2026-01-08,,Pending
`;
    const result = parseClaimsCSV(Buffer.from(csv, 'utf8'));
    expect(result.rows[0]?.cdtCodes).toEqual(['D2740', 'D0150']);
  });
});

const FIELDS = {
  'Patient ID': '0007a',
  DOB: '1990-05-12',
  'Insurance Carrier': 'Delta Dental PPO',
  'Claim #': 'display-claim',
  'Procedure Codes': 'D2740',
  Charge: '1240.00',
  'Service Date': '2026-01-08',
  'Submission Date': '2026-01-09',
  SourceClaimId: '000042a',
  SourceVersion: '00003a',
};

function csv(headers: readonly string[], cells: readonly string[]): Buffer {
  const encode = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  return Buffer.from(`${headers.map(encode).join(',')}\n${cells.map(encode).join(',')}\n`);
}

function dentrix(
  overrides: Readonly<Record<string, string>> = {},
): ReturnType<typeof parseClaimsCSV> {
  const fields = { ...FIELDS, ...overrides };
  return parseClaimsCSV(csv(Object.keys(fields), Object.values(fields)));
}

describe('source identity boundaries', () => {
  it.each([
    ['Dentrix', DENTRIX_CSV],
    ['Eaglesoft', EAGLESOFT_CSV],
    ['Open Dental', OPEN_DENTAL_CSV],
  ])('does not infer a source record ID from the %s display number', (_source, content) => {
    const result = parseClaimsCSV(Buffer.from(content));
    expect(result.rows.length).toBeGreaterThan(0);
    expect(
      result.rows.every((row) => row.sourceClaimId === null && row.sourceVersion === null),
    ).toBe(true);
  });

  it.each([
    ['Dentrix', DENTRIX_CSV],
    ['Eaglesoft', EAGLESOFT_CSV],
    ['Open Dental', OPEN_DENTAL_CSV],
  ])('supports an explicit source record ID and opaque version in %s', (_source, content) => {
    const [header, first] = content.trim().split('\n');
    if (!header || !first) throw new Error('Missing synthetic fixture');
    const result = parseClaimsCSV(
      Buffer.from(`${header},SourceClaimId,SourceVersion\n${first},00009a,V001z\n`),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ sourceClaimId: '00009a', sourceVersion: 'V001z' });
  });

  it('uses Open Dental ClaimNum and SecDateTEdit without changing display reference', () => {
    const [header, first] = OPEN_DENTAL_CSV.trim().split('\n');
    if (!header || !first) throw new Error('Missing synthetic fixture');
    const result = parseClaimsCSV(
      Buffer.from(`${header},ClaimNum,SecDateTEdit\n${first},000017,2026-10-13 13:02:00\n`),
    );
    expect(result.rows[0]).toMatchObject({
      claimNumber: 'OD-1',
      sourceClaimId: '000017',
      sourceVersion: '2026-10-13 13:02:00',
      sourcePatientId: '1001',
    });
  });

  it('retains identifier case and leading zeroes and leaves blank references null', () => {
    expect(dentrix().rows[0]).toMatchObject({
      sourceClaimId: '000042a',
      sourceVersion: '00003a',
      sourcePatientId: '0007a',
    });
    expect(dentrix({ SourceClaimId: '000042A' }).rows[0]?.sourceClaimId).toBe('000042A');
    expect(
      dentrix({ SourceClaimId: '  ', SourceVersion: '', 'Patient ID': '' }).rows[0],
    ).toMatchObject({
      sourceClaimId: null,
      sourceVersion: null,
      sourcePatientId: null,
    });
  });

  it.each(['SourceClaimId', 'SourceVersion', 'Patient ID', 'Claim #'])(
    'rejects oversized and non-printable %s without echoing its value',
    (field) => {
      for (const value of [
        'PRIVATE_CANARY\u0000',
        'PRIVATE_CANARY\n',
        'PRIVATE_CANARY\u202e',
        'PRIVATE_CANARY' + 'x'.repeat(201),
      ]) {
        const result = dentrix({ [field]: value });
        expect(result.rows).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(JSON.stringify(result.errors)).not.toContain('PRIVATE_CANARY');
      }
    },
  );

  it('accepts the 200-character ID boundary', () => {
    const id = 'a'.repeat(200);
    expect(dentrix({ SourceClaimId: id }).rows[0]?.sourceClaimId).toBe(id);
  });

  it('preserves exact payer text independently of normalized payer code', () => {
    expect(dentrix({ 'Insurance Carrier': '  DELTA PPO  ' }).rows[0]).toMatchObject({
      payerCode: 'DELTA_DENTAL_PPO',
      payerLabel: '  DELTA PPO  ',
    });
    const first = dentrix({ 'Insurance Carrier': 'Unknown synthetic payer one' }).rows[0];
    const second = dentrix({ 'Insurance Carrier': 'Unknown synthetic payer two' }).rows[0];
    expect(first?.payerCode).toBe('UNKNOWN');
    expect(second?.payerCode).toBe('UNKNOWN');
    expect(first?.payerLabel).not.toBe(second?.payerLabel);
  });

  it('retains unsupported source status and name cells in the transient fingerprint input', () => {
    const original = dentrix({
      Status: 'Submitted',
      'Patient Name': 'Synthetic Person',
      'Other Field': '  Exact value  ',
    }).rows[0];
    const changed = dentrix({
      Status: 'Paid',
      'Patient Name': 'Synthetic Changed',
      'Other Field': '  Exact value  ',
    }).rows[0];
    expect(original?.sourceFields).toContainEqual(['status', 'Submitted']);
    expect(original?.sourceFields).toContainEqual(['patient name', 'Synthetic Person']);
    expect(original?.sourceFields).toContainEqual(['other field', '  Exact value  ']);
    expect(changed?.sourceFields).toContainEqual(['status', 'Paid']);
    expect(changed?.sourceFields).toContainEqual(['patient name', 'Synthetic Changed']);
    expect(original?.sourceFields).not.toEqual(changed?.sourceFields);
  });

  it('retains repeated raw procedure codes even though the domain code list is deduplicated', () => {
    const single = dentrix({ 'Procedure Codes': 'D2740' }).rows[0];
    const repeated = dentrix({ 'Procedure Codes': 'D2740,D2740' }).rows[0];
    expect(single?.cdtCodes).toEqual(repeated?.cdtCodes);
    expect(single?.sourceFields).toContainEqual(['procedure codes', 'D2740']);
    expect(repeated?.sourceFields).toContainEqual(['procedure codes', 'D2740,D2740']);
    expect(single?.sourceFields).not.toEqual(repeated?.sourceFields);
  });

  it('makes column reorder, header casing and surrounding header spaces equivalent', () => {
    const original = dentrix().rows[0];
    const entries = Object.entries(FIELDS).reverse();
    const reordered = parseClaimsCSV(
      csv(
        entries.map(([header]) => `  ${header.toUpperCase()}  `),
        entries.map(([, value]) => value),
      ),
    ).rows[0];
    expect(reordered?.sourceFields).toEqual(original?.sourceFields);
    const keys = original?.sourceFields.map(([header]) => header) ?? [];
    expect(keys).toEqual(
      [...keys].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    );
  });
});

describe('CSV structural validation', () => {
  it('accepts exactly 5000 logical data records with a final line terminator', () => {
    const [header, row] = csv(Object.keys(FIELDS), Object.values(FIELDS))
      .toString('utf8')
      .trim()
      .split('\n');
    if (!header || !row) throw new Error('Missing synthetic fixture');
    const input = Buffer.from(`${header}\n${(row + '\n').repeat(MAX_IMPORT_ROWS)}`);
    const result = parseClaimsCSV(input);
    expect(result.rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(result.errors).toEqual([]);
  });

  it('rejects 5001 data records before normalizing any partial prefix', () => {
    const [header, row] = csv(Object.keys(FIELDS), Object.values(FIELDS))
      .toString('utf8')
      .trim()
      .split('\n');
    if (!header || !row) throw new Error('Missing synthetic fixture');
    const amount = vi.spyOn(normalisers, 'normaliseAmount');
    try {
      const input = Buffer.from(`${header}\n${(row + '\n').repeat(MAX_IMPORT_ROWS + 1)}`);
      expect(() => parseClaimsCSV(input)).toThrow(CsvRowLimitError);
      expect(amount).not.toHaveBeenCalled();
    } finally {
      amount.mockRestore();
    }
  });

  it('counts empty logical records toward the bound', () => {
    const header = Object.keys(FIELDS).join(',');
    expect(() =>
      parseClaimsCSV(Buffer.from(`${header}\n${'\n'.repeat(MAX_IMPORT_ROWS + 1)}`)),
    ).toThrow(CsvRowLimitError);
  });

  it('counts quoted multiline cells as one record rather than counting raw newlines', () => {
    const fields = { ...FIELDS, 'Unused notes': 'Synthetic note\n'.repeat(MAX_IMPORT_ROWS + 1) };
    const result = parseClaimsCSV(csv(Object.keys(fields), Object.values(fields)));
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it.each(['SourceClaimId', ' sourceclaimid ', 'Claim #', 'claim #'])(
    'rejects duplicate normalized %s headers',
    (header) => {
      expect(() =>
        parseClaimsCSV(
          csv([...Object.keys(FIELDS), header], [...Object.values(FIELDS), 'conflicting']),
        ),
      ).toThrow(UnknownCsvFormatError);
    },
  );

  it.each([
    ['SourceClaimId', 'ClaimNum'],
    ['SourceVersion', 'SecDateTEdit'],
  ])(
    'rejects Open Dental role aliases %s and %s even with matching values',
    (firstAlias, secondAlias) => {
      const [header, first] = OPEN_DENTAL_CSV.trim().split('\n');
      if (!header || !first) throw new Error('Missing synthetic fixture');
      expect(() =>
        parseClaimsCSV(Buffer.from(`${header},${firstAlias},${secondAlias}\n${first},same,same\n`)),
      ).toThrow(UnknownCsvFormatError);
    },
  );

  it('rejects overlapping source layout signatures', () => {
    const fields = { ...FIELDS, PtID: '1', Carrier: 'Cigna', DOS: '2026-01-01' };
    expect(() => parseClaimsCSV(csv(Object.keys(fields), Object.values(fields)))).toThrow(
      UnknownCsvFormatError,
    );
  });

  it.each(['too few', 'too many'])(
    'rejects records with %s cells instead of importing a partial identity',
    (kind) => {
      const cells =
        kind === 'too few'
          ? Object.values(FIELDS).slice(0, -1)
          : [...Object.values(FIELDS), 'PRIVATE_EXTRA'];
      const result = parseClaimsCSV(csv(Object.keys(FIELDS), cells));
      expect(result.rows).toEqual([]);
      expect(result.errors).toEqual([
        { rowIndex: 2, message: 'CSV row: malformed record or incorrect column count' },
      ]);
    },
  );

  it('rejects malformed quotes without returning raw error data and preserves independent valid records', () => {
    const valid = csv(Object.keys(FIELDS), Object.values(FIELDS)).toString('utf8');
    const result = parseClaimsCSV(Buffer.from(`${valid}"PRIVATE_UNCLOSED`));
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([
      { rowIndex: 3, message: 'CSV row: malformed record or incorrect column count' },
    ]);
    expect(JSON.stringify(result.errors)).not.toContain('PRIVATE_UNCLOSED');
  });

  it('keeps malformed-quote errors aligned after a blank line even when column counts match', () => {
    const valid = csv(Object.keys(FIELDS), Object.values(FIELDS)).toString('utf8');
    const [header, row] = valid.trim().split('\n');
    if (!header || !row) throw new Error('Missing synthetic fixture');
    const malformed = row.replace('"000042a"', '"PRIVATE"junk"');
    const result = parseClaimsCSV(Buffer.from(`${header}\n\n${malformed}\n${row}\n`));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rowIndex).toBe(4);
    expect(result.rows[0]?.sourceClaimId).toBe('000042a');
    expect(result.errors).toEqual([
      { rowIndex: 3, message: 'CSV row: malformed record or incorrect column count' },
    ]);
  });

  it('does not expose unknown raw headers in thrown errors', () => {
    try {
      parseClaimsCSV(Buffer.from('PRIVATE_HEADER,another\nprivate,value\n'));
      throw new Error('Expected format rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownCsvFormatError);
      expect(String(error)).not.toContain('PRIVATE_HEADER');
      expect(JSON.stringify(error)).not.toContain('PRIVATE_HEADER');
    }
  });

  it('rejects invalid UTF-8 rather than replacing source identity bytes', () => {
    const valid = csv(Object.keys(FIELDS), Object.values(FIELDS));
    expect(() => parseClaimsCSV(Buffer.concat([valid, Buffer.from([0xff])]))).toThrow(
      UnknownCsvFormatError,
    );
  });

  it('accepts missing optional submission-date, version and subscriber columns', () => {
    const entries = Object.entries(FIELDS).filter(
      ([field]) => field !== 'Submission Date' && field !== 'SourceVersion',
    );
    const result = parseClaimsCSV(
      csv(
        entries.map(([key]) => key),
        entries.map(([, value]) => value),
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      submittedDate: null,
      sourceVersion: null,
      subscriberId: null,
    });
  });
});

describe('validated source facts', () => {
  it.each([
    '2026-02-29',
    '2024-02-30',
    '1900-02-29',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '0000-01-01',
    '4/31/2026',
  ])('rejects impossible calendar date %s', (date) => {
    const result = dentrix({ 'Service Date': date });
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toBe('serviceDate: expected a valid calendar date');
  });

  it.each([
    ['2000-02-29', '2000-02-29'],
    ['2/29/2024', '2024-02-29'],
    ['1/1/0001', '0001-01-01'],
  ])('normalizes valid calendar date %s exactly', (date, expected) => {
    expect(dentrix({ 'Service Date': date }).rows[0]?.serviceDate).toBe(expected);
  });

  it('validates optional dates and never echoes invalid DOB or amount content', () => {
    expect(dentrix({ 'Submission Date': '2026-02-30' }).rows).toEqual([]);
    for (const fields of [{ DOB: 'PRIVATE_DOB_CANARY' }, { Charge: 'PRIVATE_AMOUNT_CANARY' }]) {
      const result = dentrix(fields);
      expect(result.rows).toEqual([]);
      expect(JSON.stringify(result.errors)).not.toContain('PRIVATE_');
    }
  });

  it.each([
    ['0', '0.00'],
    ['00001.2', '1.20'],
    ['$1,240.50', '1240.50'],
    ['99999999.99', '99999999.99'],
  ])('normalizes amount %s without floating-point arithmetic', (amount, expected) => {
    expect(dentrix({ Charge: amount }).rows[0]?.claimAmount).toBe(expected);
  });

  it.each(['100000000', '99999999.999', '-1', '1e3', 'NaN', '1,2', '1$2', '1 2', '.50', '1.'])(
    'rejects out-of-range or malformed amount %s',
    (amount) => {
      const result = dentrix({ Charge: amount });
      expect(result.rows).toEqual([]);
      expect(result.errors).toHaveLength(1);
    },
  );
});
