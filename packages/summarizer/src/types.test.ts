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
  denialReason: 'non-covered service',
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

  it('rejects unknown denial codes (suspected hallucination)', () => {
    expect(() => SummaryOutputSchema.parse({ ...DENIED_FIXTURE, denialCode: 'CO-9999' })).toThrow(
      /allow-list/,
    );
  });

  it('treats empty-string denialCode as null (LLM omitted the field)', () => {
    const parsed = SummaryOutputSchema.parse({ ...RESOLVED_FIXTURE, denialCode: '' });
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
