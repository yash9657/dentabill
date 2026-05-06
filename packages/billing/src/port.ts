import type {
  EnsureCustomerInput,
  EnsureCustomerResult,
  RecordUsageInput,
  RecordUsageResult,
} from './types.js';

/**
 * `BillingPort` — port-and-adapters seam for Stripe metered billing.
 *
 * Adapters:
 *   - `FakeStripe`: in-memory idempotency map + invocation log. Used
 *     by every test that doesn't need a live Stripe account.
 *   - `LiveStripe`: wraps the `stripe` SDK. Lazy-loaded so dev/test
 *     bundles stay SDK-free.
 *
 * Methods:
 *   - `ensureCustomer({ organizationId, name, email })` — idempotent
 *     "create or fetch" of a Stripe customer. The billing-worker
 *     calls this lazily (first time an org has a resolved claim) so
 *     trial orgs don't pollute Stripe.
 *   - `recordUsage({ organizationId, claimId, amountCents, ... })` —
 *     post a usage record. Honours the idempotency key.
 */
export interface BillingPort {
  ensureCustomer(input: EnsureCustomerInput): Promise<EnsureCustomerResult>;
  recordUsage(input: RecordUsageInput): Promise<RecordUsageResult>;
}

export class BillingValidationError extends Error {
  public constructor(
    public readonly issues: readonly { readonly path: string; readonly message: string }[],
  ) {
    super(
      `BillingPort input validation failed: ${issues
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`,
    );
    this.name = 'BillingValidationError';
  }
}
