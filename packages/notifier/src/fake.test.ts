import { describe, expect, it } from 'vitest';

import { FakeResend } from './fake.js';
import { NotifierValidationError } from './port.js';

describe('FakeResend', () => {
  it('records valid claim.resolved deliveries', async () => {
    const fake = new FakeResend();
    const result = await fake.notify({
      to: 'biller@practice.test',
      template: 'claim.resolved',
      vars: {
        claimNumber: 'CL-1',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: '2026-01-15',
        amountResolvedCents: 24000,
      },
      organizationId: 'org_1',
    });
    expect(result.id).toBe('fake-resend-1');
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.deliveries[0]?.template).toBe('claim.resolved');
    expect(fake.deliveries[0]?.organizationId).toBe('org_1');
  });

  it('rejects payloads that fail Zod validation', async () => {
    const fake = new FakeResend();
    await expect(
      fake.notify({
        to: 'b@p.test',
        template: 'claim.resolved',
        vars: {
          claimNumber: 'CL-1',
          payerCode: 'DELTA_DENTAL_PPO',
          serviceDate: '2026/01/15',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          amountResolvedCents: -1 as any,
        },
      }),
    ).rejects.toBeInstanceOf(NotifierValidationError);
  });

  it('rejects PHI fields not in the template (forward-compat guard)', async () => {
    const fake = new FakeResend();
    const phiVars = {
      claimNumber: 'CL-1',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: '2026-01-15',
      amountResolvedCents: 100,
      patientName: 'John Doe',
    };
    // Reach past the typed surface — the test is the regression
    // guard for runtime callers that bypass TypeScript (e.g. JS shims).
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
    await expect(
      (fake as any).notify({
        to: 'b@p.test',
        template: 'claim.resolved',
        vars: phiVars,
      }),
    ).rejects.toBeInstanceOf(NotifierValidationError);
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
  });

  it('reset() clears deliveries', async () => {
    const fake = new FakeResend();
    await fake.notify({
      to: 'b@p.test',
      template: 'claim.denied',
      vars: {
        claimNumber: 'CL-1',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: '2026-01-15',
        denialCode: 'CO-50',
      },
    });
    expect(fake.deliveries).toHaveLength(1);
    fake.reset();
    expect(fake.deliveries).toHaveLength(0);
  });
});
