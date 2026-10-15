import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';

import { parseClaimsCSV } from './parser.js';
import { CsvChildLimitError } from './source-details.js';

const line = (sourceLineId = 'line-1', billedAmount = '40.00'): Record<string, unknown> => ({
  sourceLineId,
  procedureCode: 'D1110',
  serviceDate: '2026-01-08',
  billedAmount,
});
const coverage = (
  sourceCoverageId = 'coverage-1',
  sequence = 1,
  isClaimCoverage = true,
): Record<string, unknown> => ({
  sourceCoverageId,
  sequence,
  payerName: 'Synthetic payer',
  isClaimCoverage,
});
function csv(lines: unknown, coverages?: unknown, amount = '40.00'): Buffer {
  return Buffer.from(
    Papa.unparse([
      {
        PatNum: 'patient-1',
        Birthdate: '1990-05-12',
        InsCarrier: 'Synthetic payer',
        ClaimIdent: 'display-1',
        ClaimNum: 'source-1',
        ProcCodes: 'D1110',
        ClaimFee: amount,
        ProcDate: '2026-01-08',
        ClaimLines: lines === undefined ? '' : JSON.stringify(lines),
        Coverages: coverages === undefined ? '' : JSON.stringify(coverages),
      },
    ]),
  );
}

describe('custom procedure and coverage CSV contract', () => {
  it('retains repeated codes, distinct teeth and explicit total independent of quantity', () => {
    const result = parseClaimsCSV(
      csv([
        {
          ...line('001', '20.00'),
          tooth: 'A',
          toothNumberingSystem: 'Universal',
          quantity: '3',
          surface: 'MO',
        },
        {
          ...line('002', '20.00'),
          tooth: 'AS',
          toothNumberingSystem: 'Universal',
          quantity: '0.125',
        },
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.cdtCodes).toEqual(['D1110']);
    expect(result.rows[0]?.sourceDetails?.lines).toMatchObject([
      { sourceLineId: '001', tooth: 'A', quantity: '3', billedAmount: '20.00' },
      { sourceLineId: '002', tooth: 'AS', quantity: '0.125', billedAmount: '20.00' },
    ]);
  });

  it('keeps unknown location/code data without inventing quantity or tooth', () => {
    const input = csv([{ ...line(), procedureCode: 'LOCAL-CODE', quadrant: 'source quadrant Q' }]);
    const result = parseClaimsCSV(Buffer.from(input.toString().replace('D1110', 'LOCAL-CODE')));
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.sourceDetails?.lines[0]).toMatchObject({
      procedureCode: 'LOCAL-CODE',
      quadrant: 'source quadrant Q',
      tooth: null,
      quantity: null,
    });
  });

  it('preserves secondary target, noncontiguous sequence and separate subscription/member facts', () => {
    const result = parseClaimsCSV(
      csv(undefined, [
        {
          ...coverage('primary', 1, false),
          sourceSubscriptionId: 'subscription-record',
          subscriberId: 'member-id',
          patientMemberId: 'dependent-id',
        },
        coverage('third', 3, true),
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.sourceDetails?.coverages).toMatchObject([
      {
        sequence: 1,
        isClaimCoverage: false,
        sourceSubscriptionId: 'subscription-record',
        subscriberId: 'member-id',
        patientMemberId: 'dependent-id',
      },
      { sequence: 3, isClaimCoverage: true, subscriberId: null, sourceSubscriptionId: null },
    ]);
    expect(result.rows[0]?.subscriberId).toBeNull();
    expect(result.rows[0]?.sourceDetails?.lines).toEqual([]);
  });

  it('leaves summary-only rows without a snapshot instead of manufacturing procedures', () => {
    expect(parseClaimsCSV(csv(undefined)).rows[0]?.sourceDetails).toBeNull();
  });

  it.each([
    [[], undefined],
    [[line(), line()], undefined],
    [[{ ...line(), billedAmount: '39.99' }], undefined],
    [[{ ...line(), billedAmount: 40 }], undefined],
    [[{ ...line(), billedAmount: '40.000' }], undefined],
    [[{ ...line(), billedAmount: '-40.00' }], undefined],
    [[{ ...line(), procedureCode: 'D9999' }], undefined],
    [[{ ...line(), quantity: '0' }], undefined],
    [[{ ...line(), quantity: '1.0001' }], undefined],
    [[{ ...line(), quantity: 1 }], undefined],
    [[{ ...line(), serviceDate: '2026-02-29' }], undefined],
    [[{ ...line(), serviceDate: '1/8/2026' }], undefined],
    [[{ ...line(), sourceLineId: '' }], undefined],
    [[{ ...line(), sourceLineId: 'secret\nvalue' }], undefined],
    [[{ ...line(), patientName: 'private unknown field' }], undefined],
    [[line()], []],
    [[line()], [coverage(), coverage()]],
    [[line()], [coverage(), coverage('other')]],
    [[line()], [coverage('one', 1, false)]],
    [[line()], [coverage(), coverage('two', 2)]],
    [[line()], [{ ...coverage(), effectiveDate: '2026-02-01', terminationDate: '2026-01-01' }]],
    [[line()], [{ ...coverage(), isClaimCoverage: undefined }]],
    [[line()], [{ ...coverage(), subscriberId: '' }]],
    [[line()], [{ ...coverage(), sequence: 10 }]],
    [[line()], [{ ...coverage(), sequence: 1.5 }]],
  ])(
    'rejects an invalid whole row without falling back to summary data (%#)',
    (lines, coverages) => {
      const result = parseClaimsCSV(csv(lines, coverages));
      expect(result.rows).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(JSON.stringify(result.errors)).not.toContain('private unknown field');
      expect(JSON.stringify(result.errors)).not.toContain('secret');
    },
  );

  it('does not reflect malformed JSON text', () => {
    const input = csv([line()]);
    const parsed = Papa.parse<Record<string, string>>(input.toString(), { header: true });
    const row = parsed.data[0];
    if (!row) throw new Error('Missing synthetic fixture');
    row.ClaimLines = '[private patient text';
    expect(parseClaimsCSV(Buffer.from(Papa.unparse([row]))).errors).toEqual([
      { rowIndex: 2, message: 'ClaimLines: expected a JSON array' },
    ]);
  });

  it('validates exact cents at the maximum header amount', () => {
    expect(
      parseClaimsCSV(
        csv([line('one', '99999999.98'), line('two', '0.01')], undefined, '99999999.99'),
      ).errors,
    ).toEqual([]);
    expect(
      parseClaimsCSV(
        csv([line('one', '99999999.99'), line('two', '0.01')], undefined, '99999999.99'),
      ).rows,
    ).toEqual([]);
  });

  it('rejects more than 500 procedures per claim', () => {
    expect(
      parseClaimsCSV(
        csv(
          Array.from({ length: 501 }, (_, i) => line(String(i), '0.00')),
          undefined,
          '0.00',
        ),
      ).rows,
    ).toEqual([]);
  });

  it('bounds individual cells before JSON materialization', () => {
    const input = csv([{ ...line(), tooth: 'x'.repeat(512 * 1024) }]);
    expect(parseClaimsCSV(input).errors[0]?.message).toContain('512 KiB');
  });

  it('bounds total upload children before insertion, accepting exactly 10000', () => {
    const one = csv(
      Array.from({ length: 500 }, (_, i) => line(String(i), '0.00')),
      undefined,
      '0.00',
    );
    const data = Papa.parse<Record<string, string>>(one.toString(), { header: true }).data[0];
    if (!data) throw new Error('Missing synthetic fixture');
    const many = (count: number): Buffer =>
      Buffer.from(
        Papa.unparse(Array.from({ length: count }, (_, i) => ({ ...data, ClaimNum: String(i) }))),
      );
    expect(parseClaimsCSV(many(20)).rows).toHaveLength(20);
    expect(() => parseClaimsCSV(many(21))).toThrow(CsvChildLimitError);
  });
});
