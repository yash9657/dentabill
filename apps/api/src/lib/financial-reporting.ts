import { z } from 'zod';

export const VerifiedPaymentsSchema = z.object({
  status: z.literal('unavailable'),
  reason: z.literal('PAYMENT_LEDGER_NOT_IMPLEMENTED'),
  amountCents: z
    .null()
    .describe('Unknown, never zero or claim face value. No reconciled payment ledger exists.'),
});

export const unavailableVerifiedPayments: z.infer<typeof VerifiedPaymentsSchema> = {
  status: 'unavailable',
  reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
  amountCents: null,
};
