import { describe, expect, it } from 'vitest';

import { OnboardingFormSchema } from './onboarding-schema.js';

describe('OnboardingFormSchema', () => {
  const valid = {
    practiceName: 'Sunrise Family Dental',
    npi: '',
    zip: '94110',
    acceptedPayers: ['Delta Dental PPO' as const],
  };

  it('accepts a valid submission with NPI omitted', () => {
    expect(OnboardingFormSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a valid 10-digit NPI', () => {
    const result = OnboardingFormSchema.safeParse({ ...valid, npi: '1234567890' });
    expect(result.success).toBe(true);
  });

  it('rejects NPIs that are not exactly 10 digits', () => {
    const result = OnboardingFormSchema.safeParse({ ...valid, npi: '123' });
    expect(result.success).toBe(false);
  });

  it('rejects zip codes that are not 5 digits', () => {
    expect(OnboardingFormSchema.safeParse({ ...valid, zip: '9410' }).success).toBe(false);
    expect(OnboardingFormSchema.safeParse({ ...valid, zip: '941100' }).success).toBe(false);
  });

  it('rejects practiceName shorter than 2 characters', () => {
    expect(OnboardingFormSchema.safeParse({ ...valid, practiceName: 'a' }).success).toBe(false);
  });

  it('rejects an empty acceptedPayers array', () => {
    expect(OnboardingFormSchema.safeParse({ ...valid, acceptedPayers: [] }).success).toBe(false);
  });

  it('rejects unknown payers', () => {
    expect(
      OnboardingFormSchema.safeParse({ ...valid, acceptedPayers: ['Made-Up Payer'] }).success,
    ).toBe(false);
  });
});
