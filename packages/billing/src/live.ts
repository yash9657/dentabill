import { BillingValidationError, type BillingPort } from './port.js';
import {
  EnsureCustomerInputSchema,
  RecordUsageInputSchema,
  type EnsureCustomerInput,
  type EnsureCustomerResult,
  type RecordUsageInput,
  type RecordUsageResult,
} from './types.js';

/**
 * `LiveStripe` — wraps the `stripe` SDK.
 *
 * Phase 4 ships the wrapper in receipt-only mode by default:
 * `STRIPE_METERED_BILLING_ENABLED=false` short-circuits Stripe API
 * calls and returns `stripeUsageRecordId: null`. The
 * `BillingUsageRecord` row is still persisted by the worker, so
 * flipping the flag later replays cleanly.
 *
 * The SDK is loaded via dynamic import in production wiring; this
 * file accepts an injectable client to keep tests offline.
 */

interface StripeClientLike {
  readonly customers: {
    create: (input: { name: string; email: string; metadata?: Record<string, string> }) => Promise<{
      id: string;
    }>;
    list: (input: { email: string; limit?: number }) => Promise<{ data: { id: string }[] }>;
  };
  readonly billing: {
    readonly meterEvents: {
      create: (
        input: {
          event_name: string;
          payload: Record<string, string>;
          identifier?: string;
        },
        opts?: { idempotencyKey?: string },
      ) => Promise<{ identifier: string }>;
    };
  };
}

export interface LiveStripeOptions {
  readonly stripeClient: StripeClientLike;
  /**
   * Whether to actually post to Stripe. When false, the adapter is
   * receipt-only and returns null `stripeUsageRecordId`.
   */
  readonly enabled: boolean;
  /** Stripe meter event name used for `billing.meterEvents.create`. */
  readonly meterEventName?: string;
  /** Test seam — defaults to `() => new Date()`. */
  readonly clock?: () => Date;
}

const DEFAULT_METER_EVENT_NAME = 'dentabill_resolved_claim';

export class LiveStripe implements BillingPort {
  readonly #client: StripeClientLike;
  readonly #enabled: boolean;
  readonly #meterEventName: string;
  readonly #clock: () => Date;

  public constructor(options: LiveStripeOptions) {
    this.#client = options.stripeClient;
    this.#enabled = options.enabled;
    this.#meterEventName = options.meterEventName ?? DEFAULT_METER_EVENT_NAME;
    this.#clock = options.clock ?? ((): Date => new Date());
  }

  public async ensureCustomer(input: EnsureCustomerInput): Promise<EnsureCustomerResult> {
    const validation = EnsureCustomerInputSchema.safeParse(input);
    if (!validation.success) {
      throw new BillingValidationError(
        validation.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    // Stripe doesn't dedupe customer-create by email; we list first.
    const existing = await this.#client.customers.list({ email: input.email, limit: 1 });
    if (existing.data.length > 0 && existing.data[0]) {
      return { stripeCustomerId: existing.data[0].id, created: false };
    }
    const created = await this.#client.customers.create({
      name: input.name,
      email: input.email,
      metadata: { dentabill_org_id: input.organizationId },
    });
    return { stripeCustomerId: created.id, created: true };
  }

  public async recordUsage(input: RecordUsageInput): Promise<RecordUsageResult> {
    const validation = RecordUsageInputSchema.safeParse(input);
    if (!validation.success) {
      throw new BillingValidationError(
        validation.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const postedAt = this.#clock().toISOString();
    if (!this.#enabled) {
      return { stripeUsageRecordId: null, deduplicated: false, postedAt };
    }
    const result = await this.#client.billing.meterEvents.create(
      {
        event_name: this.#meterEventName,
        identifier: input.idempotencyKey,
        payload: {
          stripe_customer_id: input.organizationId,
          claim_id: input.claimId,
          value: String(input.amountCents),
        },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return {
      stripeUsageRecordId: result.identifier,
      deduplicated: false,
      postedAt,
    };
  }
}
