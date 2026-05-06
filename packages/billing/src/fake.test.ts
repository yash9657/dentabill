import { describe, expect, it } from 'vitest';

import { FakeStripe } from './fake.js';
import { BillingValidationError } from './port.js';
import type { RecordUsageInput } from './types.js';

const PERIOD = new Date('2026-05-01T00:00:00Z');

function usage(overrides: Partial<RecordUsageInput> = {}): RecordUsageInput {
  return {
    organizationId: 'org_1',
    claimId: 'clm_1',
    amountCents: 500,
    billingPeriodStart: PERIOD,
    idempotencyKey: 'claim.clm_1.2026-05-01',
    ...overrides,
  };
}

describe('FakeStripe.ensureCustomer', () => {
  it('creates a customer the first time per orgId', async () => {
    const fake = new FakeStripe();
    const a = await fake.ensureCustomer({
      organizationId: 'org_1',
      name: 'Acme Dental',
      email: 'owner@acme.test',
    });
    expect(a.created).toBe(true);
    expect(a.stripeCustomerId).toMatch(/^cus_fake_/);
    const b = await fake.ensureCustomer({
      organizationId: 'org_1',
      name: 'Acme Dental',
      email: 'owner@acme.test',
    });
    expect(b.created).toBe(false);
    expect(b.stripeCustomerId).toBe(a.stripeCustomerId);
  });

  it('rejects malformed input', async () => {
    const fake = new FakeStripe();
    await expect(
      fake.ensureCustomer({
        organizationId: '',
        name: 'A',
        email: 'not-an-email',
      }),
    ).rejects.toBeInstanceOf(BillingValidationError);
  });
});

describe('FakeStripe.recordUsage', () => {
  it('posts a usage record on first call and returns deduplicated=false', async () => {
    const fake = new FakeStripe();
    const result = await fake.recordUsage(usage());
    expect(result.deduplicated).toBe(false);
    expect(result.stripeUsageRecordId).toMatch(/^mbur_fake_/);
    expect(fake.invocations).toHaveLength(1);
  });

  it('returns deduplicated=true on a repeat with the same idempotencyKey', async () => {
    const fake = new FakeStripe();
    const first = await fake.recordUsage(usage());
    const second = await fake.recordUsage(usage());
    expect(second.deduplicated).toBe(true);
    expect(second.stripeUsageRecordId).toBe(first.stripeUsageRecordId);
    // The Stripe-side log records exactly one invocation — the
    // double-charge guard.
    expect(fake.invocations).toHaveLength(1);
  });

  it('treats different idempotencyKeys as distinct records', async () => {
    const fake = new FakeStripe();
    await fake.recordUsage(usage({ idempotencyKey: 'claim.A.2026-05-01' }));
    await fake.recordUsage(usage({ idempotencyKey: 'claim.A.2026-06-01' }));
    expect(fake.invocations).toHaveLength(2);
  });

  it('rejects negative amountCents', async () => {
    const fake = new FakeStripe();
    await expect(fake.recordUsage(usage({ amountCents: -1 }))).rejects.toBeInstanceOf(
      BillingValidationError,
    );
  });
});
