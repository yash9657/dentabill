import { describe, expect, it } from 'vitest';

import { CLAIMS_PER_WEEK_BUCKETS, ContactFormSchema } from './contact-schema.js';

describe('ContactFormSchema', () => {
  const valid = {
    name: 'Alex Garcia',
    email: 'alex@yourpractice.com',
    practiceName: 'Sunrise Family Dental',
    claimsPerWeek: CLAIMS_PER_WEEK_BUCKETS[0],
    message: 'We follow up on around eighty claims a week with Delta and Cigna.',
  };

  it('accepts a well-formed submission', () => {
    expect(ContactFormSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects names shorter than 2 characters', () => {
    const r = ContactFormSchema.safeParse({ ...valid, name: 'A' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/tell us your name/i);
    }
  });

  it('rejects malformed emails', () => {
    const r = ContactFormSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/valid work email/i);
    }
  });

  it('rejects messages shorter than 20 characters', () => {
    const r = ContactFormSchema.safeParse({ ...valid, message: 'too short' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/at least a sentence/i);
    }
  });

  it('rejects unknown claimsPerWeek values', () => {
    const r = ContactFormSchema.safeParse({ ...valid, claimsPerWeek: 'lots' });
    expect(r.success).toBe(false);
  });

  it('trims whitespace before validation', () => {
    const r = ContactFormSchema.safeParse({ ...valid, name: '   Alex Garcia   ' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('Alex Garcia');
    }
  });
});
