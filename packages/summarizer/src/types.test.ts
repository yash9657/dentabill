import { describe, expect, it } from 'vitest';

import { SummaryOutputSchema } from './types.js';

const RESOLVED_FIXTURE = {
  claimStatus: 'paid',
  denialReason: null,
  denialCode: null,
  nextAction: 'RESOLVED',
  confidence: 0.97,
  repName: 'Lisa M.',
  referenceNumber: 'REF-2026-0001',
  callbackDate: null,
  amountApprovedCents: 24000,
  notes: null,
};

const DENIED_FIXTURE = {
  claimStatus: 'denied',
  denialReason: 'payer determined medical necessity was not established',
  denialCode: 'CO-50',
  nextAction: 'APPEAL',
  confidence: 0.92,
  repName: 'Tom K.',
  referenceNumber: 'REF-2026-0002',
  callbackDate: '2026-05-20',
  amountApprovedCents: 0,
  notes: 'rep recommended attaching narrative',
};

describe('SummaryOutputSchema', () => {
  it('parses a resolved-claim fixture', () => {
    const parsed = SummaryOutputSchema.parse(RESOLVED_FIXTURE);
    expect(parsed.nextAction).toBe('RESOLVED');
    expect(parsed.denialCode).toBeNull();
  });

  it('parses a denied-claim fixture with a known denial code', () => {
    const parsed = SummaryOutputSchema.parse(DENIED_FIXTURE);
    expect(parsed.denialCode).toBe('CO-50');
    expect(parsed.amountApprovedCents).toBe(0);
  });

  it.each(['CO-9999', 'N999', 'CO50', 'co-50', 'payer-local:a12'])(
    'preserves unrecognized raw code %s without rewriting its meaning',
    (denialCode) => {
      expect(SummaryOutputSchema.parse({ ...DENIED_FIXTURE, denialCode }).denialCode).toBe(
        denialCode,
      );
    },
  );

  it('bounds denial-code length without silently truncating the evidence', () => {
    expect(
      SummaryOutputSchema.parse({ ...DENIED_FIXTURE, denialCode: 'X'.repeat(64) }).denialCode,
    ).toBe('X'.repeat(64));
    expect(() =>
      SummaryOutputSchema.parse({ ...DENIED_FIXTURE, denialCode: 'X'.repeat(65) }),
    ).toThrow(/64 characters/);
  });

  it('trims only surrounding whitespace and rejects non-string codes', () => {
    expect(
      SummaryOutputSchema.parse({ ...DENIED_FIXTURE, denialCode: ' LOCAL-1 ' }).denialCode,
    ).toBe('LOCAL-1');
    expect(() => SummaryOutputSchema.parse({ ...DENIED_FIXTURE, denialCode: 123 })).toThrow();
  });

  it('treats empty-string denialCode as null (LLM omitted the field)', () => {
    const parsed = SummaryOutputSchema.parse({ ...RESOLVED_FIXTURE, denialCode: ' \t ' });
    expect(parsed.denialCode).toBeNull();
  });

  it('rejects malformed callbackDate', () => {
    expect(() =>
      SummaryOutputSchema.parse({ ...DENIED_FIXTURE, callbackDate: '5/20/2026' }),
    ).toThrow(/YYYY-MM-DD/);
  });

  it('rejects confidence > 1', () => {
    expect(() => SummaryOutputSchema.parse({ ...RESOLVED_FIXTURE, confidence: 1.2 })).toThrow();
  });

  it('rejects confidence < 0', () => {
    expect(() => SummaryOutputSchema.parse({ ...RESOLVED_FIXTURE, confidence: -0.1 })).toThrow();
  });

  it('rejects an unknown nextAction value', () => {
    expect(() =>
      SummaryOutputSchema.parse({ ...RESOLVED_FIXTURE, nextAction: 'AUTO_RESOLVE' }),
    ).toThrow();
  });
});
