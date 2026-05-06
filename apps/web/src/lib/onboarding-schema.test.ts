import { describe, expect, it } from 'vitest';

import { OnboardingFormSchema } from './onboarding-schema.js';

describe('OnboardingFormSchema', () => {
  const valid = {
    practiceName: 'Sunrise Family Dental',
    npi: '1234567890',
    zip: '94110',
    acceptedPayers: ['Delta Dental PPO' as const],
  };

  it('accepts a valid submission with a 10-digit NPI', () => {
    expect(OnboardingFormSchema.safeParse(valid).success).toBe(true);
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

  describe('conditional NPI requirement (Phase B)', () => {
    it('rejects empty NPI when accepting Delta Dental PPO', () => {
      const result = OnboardingFormSchema.safeParse({
        ...valid,
        npi: '',
        acceptedPayers: ['Delta Dental PPO'],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === 'npi')).toBe(true);
      }
    });

    it('rejects empty NPI when accepting Cigna Dental', () => {
      const result = OnboardingFormSchema.safeParse({
        ...valid,
        npi: '',
        acceptedPayers: ['Cigna Dental'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty NPI when accepting MetLife Dental', () => {
      const result = OnboardingFormSchema.safeParse({
        ...valid,
        npi: '',
        acceptedPayers: ['MetLife Dental'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty NPI when ANY accepted payer is dialable, even mixed with non-dialable', () => {
      const result = OnboardingFormSchema.safeParse({
        ...valid,
        npi: '',
        acceptedPayers: ['Aetna Dental', 'Delta Dental PPO'],
      });
      expect(result.success).toBe(false);
    });

    it('accepts empty NPI when all accepted payers are non-dialable in Phase 3', () => {
      const result = OnboardingFormSchema.safeParse({
        ...valid,
        npi: '',
        acceptedPayers: ['Aetna Dental', 'Guardian Dental'],
      });
      expect(result.success).toBe(true);
    });
  });
});
