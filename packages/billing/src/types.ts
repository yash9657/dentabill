import { z } from 'zod';

/**
 * Wire types for `BillingPort`.
 *
 * Idempotency policy (ADR-043):
 *   - The caller derives `idempotencyKey` as `claim.<id>.<billingPeriodStartIso>`.
 *   - Stripe's idempotency window is 24h; beyond that, our database
 *     uniqueness constraint on `BillingUsageRecord(claimId, billingPeriodStart)`
 *     is the durable backstop.
 *   - Both the `LiveStripe` adapter and `FakeStripe` honour the key.
 */
export const RecordUsageInputSchema = z
  .object({
    organizationId: z.string().min(1),
    claimId: z.string().min(1),
    /** Cents — integer. The billing-worker computes amount × plan-tier. */
    amountCents: z.number().int().min(0),
    /** Anchor for the day this usage row covers. */
    billingPeriodStart: z.date(),
    /** Idempotency key — see file-level note. */
    idempotencyKey: z.string().min(1),
  })
  .strict();

export type RecordUsageInput = z.infer<typeof RecordUsageInputSchema>;

export const RecordUsageResultSchema = z
  .object({
    /** Stripe usage_record id, when STRIPE_METERED_BILLING_ENABLED. Null
     * means "receipt-only" mode — the BillingUsageRecord row was
     * persisted but no Stripe POST was made. */
    stripeUsageRecordId: z.string().nullable(),
    /** Whether the call was a no-op (idempotency cache hit). */
    deduplicated: z.boolean(),
    postedAt: z.string().datetime(),
  })
  .strict();

export type RecordUsageResult = z.infer<typeof RecordUsageResultSchema>;

export const EnsureCustomerInputSchema = z
  .object({
    organizationId: z.string().min(1),
    /** Friendly name for the Stripe customer. */
    name: z.string().min(1),
    /** Owner's email — Stripe sends invoices to this address. */
    email: z.string().email(),
  })
  .strict();

export type EnsureCustomerInput = z.infer<typeof EnsureCustomerInputSchema>;

export interface EnsureCustomerResult {
  readonly stripeCustomerId: string;
  readonly created: boolean;
}
