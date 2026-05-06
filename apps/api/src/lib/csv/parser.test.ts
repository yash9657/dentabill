import { describe, expect, it } from 'vitest';

import { detectCsvSource } from './detector.js';
import { parseClaimsCSV } from './parser.js';
import { UnknownCsvFormatError } from './types.js';

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
