import { describe, expect, it } from 'vitest';

import { DENIAL_CODES, isKnownDenialCode } from './denial-codes.js';

describe('DENIAL_CODES recognition subset', () => {
  it('retains existing recognized values', () => {
    for (const code of ['CO-50', 'CO-29', 'CO-97', 'PR-204']) {
      expect(DENIAL_CODES).toContain(code);
    }
  });

  it('isKnownDenialCode narrows only exact recognized values', () => {
    expect(isKnownDenialCode('CO-50')).toBe(true);
    expect(isKnownDenialCode('co-50')).toBe(false);
    expect(isKnownDenialCode('CO-9999')).toBe(false);
    expect(isKnownDenialCode('')).toBe(false);
    expect(isKnownDenialCode('CO50')).toBe(false);
    expect(isKnownDenialCode('payer-local:a12')).toBe(false);
  });

  it('has no duplicate codes', () => {
    expect(new Set(DENIAL_CODES).size).toBe(DENIAL_CODES.length);
  });
});
