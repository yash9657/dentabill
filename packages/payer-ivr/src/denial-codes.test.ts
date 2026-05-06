import { describe, expect, it } from 'vitest';

import { DENIAL_CODES, isKnownDenialCode } from './denial-codes.js';

describe('DENIAL_CODES allow-list', () => {
  it('contains the most common dental denial codes', () => {
    for (const code of ['CO-50', 'CO-29', 'CO-97', 'PR-204']) {
      expect(DENIAL_CODES).toContain(code);
    }
  });

  it('isKnownDenialCode narrows to the allow-list', () => {
    expect(isKnownDenialCode('CO-50')).toBe(true);
    expect(isKnownDenialCode('co-50')).toBe(false);
    expect(isKnownDenialCode('CO-9999')).toBe(false);
    expect(isKnownDenialCode('')).toBe(false);
  });

  it('has no duplicate codes', () => {
    expect(new Set(DENIAL_CODES).size).toBe(DENIAL_CODES.length);
  });
});
