import { describe, expect, it, vi } from 'vitest';

import { LiveStripe } from './live.js';

const PERIOD = new Date('2026-05-01T00:00:00Z');

function fakeClient() {
  return {
    customers: {
      create: vi.fn(async (_input) => ({ id: 'cus_live_1' })),
      list: vi.fn(async (_input) => ({ data: [] as { id: string }[] })),
    },
    billing: {
      meterEvents: {
        create: vi.fn(async (_input, _opts) => ({ identifier: 'mbur_live_1' })),
      },
    },
  };
}

describe('LiveStripe.ensureCustomer', () => {
  it('reuses an existing Stripe customer (list-by-email)', async () => {
    const client = fakeClient();
    client.customers.list.mockResolvedValueOnce({ data: [{ id: 'cus_existing_999' }] });
    const live = new LiveStripe({ stripeClient: client, enabled: true });
    const result = await live.ensureCustomer({
      organizationId: 'org_1',
      name: 'Acme',
      email: 'a@a.test',
    });
    expect(result.created).toBe(false);
    expect(result.stripeCustomerId).toBe('cus_existing_999');
    expect(client.customers.create).not.toHaveBeenCalled();
  });

  it('creates a new customer when no existing match', async () => {
    const client = fakeClient();
    const live = new LiveStripe({ stripeClient: client, enabled: true });
    const result = await live.ensureCustomer({
      organizationId: 'org_1',
      name: 'Acme',
      email: 'a@a.test',
    });
    expect(result.created).toBe(true);
    expect(client.customers.create).toHaveBeenCalledOnce();
  });
});

describe('LiveStripe.recordUsage', () => {
  it('skips Stripe API when enabled=false (receipt-only mode)', async () => {
    const client = fakeClient();
    const live = new LiveStripe({ stripeClient: client, enabled: false });
    const result = await live.recordUsage({
      organizationId: 'org_1',
      claimId: 'clm_1',
      amountCents: 500,
      billingPeriodStart: PERIOD,
      idempotencyKey: 'claim.clm_1.2026-05-01',
    });
    expect(result.stripeUsageRecordId).toBeNull();
    expect(client.billing.meterEvents.create).not.toHaveBeenCalled();
  });

  it('forwards the idempotencyKey to Stripe SDK options', async () => {
    const client = fakeClient();
    const live = new LiveStripe({ stripeClient: client, enabled: true });
    const result = await live.recordUsage({
      organizationId: 'org_1',
      claimId: 'clm_1',
      amountCents: 500,
      billingPeriodStart: PERIOD,
      idempotencyKey: 'claim.clm_1.2026-05-01',
    });
    expect(result.stripeUsageRecordId).toBe('mbur_live_1');
    expect(client.billing.meterEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'claim.clm_1.2026-05-01',
        payload: expect.objectContaining({ claim_id: 'clm_1', value: '500' }),
      }),
      expect.objectContaining({ idempotencyKey: 'claim.clm_1.2026-05-01' }),
    );
  });
});
