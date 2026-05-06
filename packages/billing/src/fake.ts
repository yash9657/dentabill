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
 * `FakeStripe` — in-memory billing port used by every Phase-4 test.
 *
 *   - Validates every input against the matching Zod schema.
 *   - Maintains an idempotency cache keyed by `idempotencyKey`. A
 *     repeated call returns `deduplicated: true` and the cached
 *     `stripeUsageRecordId` — same contract LiveStripe should
 *     express against the real Stripe idempotency-key behaviour.
 *   - Exposes `customers` and `invocations` for spy-style asserts.
 */
export class FakeStripe implements BillingPort {
  readonly #customers = new Map<string, EnsureCustomerResult>();
  readonly #idempotencyCache = new Map<string, RecordUsageResult>();
  readonly #usageLog: RecordUsageInput[] = [];
  readonly #clock: () => Date;
  #counter = 0;

  public constructor(opts: { readonly clock?: () => Date } = {}) {
    this.#clock = opts.clock ?? ((): Date => new Date());
  }

  public get customers(): ReadonlyMap<string, EnsureCustomerResult> {
    return this.#customers;
  }

  public get invocations(): readonly RecordUsageInput[] {
    return this.#usageLog;
  }

  public reset(): void {
    this.#customers.clear();
    this.#idempotencyCache.clear();
    this.#usageLog.length = 0;
    this.#counter = 0;
  }

  public ensureCustomer(input: EnsureCustomerInput): Promise<EnsureCustomerResult> {
    const validation = EnsureCustomerInputSchema.safeParse(input);
    if (!validation.success) {
      return Promise.reject(
        new BillingValidationError(
          validation.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
    }
    const existing = this.#customers.get(input.organizationId);
    if (existing) return Promise.resolve({ ...existing, created: false });
    this.#counter += 1;
    const result: EnsureCustomerResult = {
      stripeCustomerId: `cus_fake_${String(this.#counter).padStart(6, '0')}`,
      created: true,
    };
    this.#customers.set(input.organizationId, result);
    return Promise.resolve(result);
  }

  public recordUsage(input: RecordUsageInput): Promise<RecordUsageResult> {
    const validation = RecordUsageInputSchema.safeParse(input);
    if (!validation.success) {
      return Promise.reject(
        new BillingValidationError(
          validation.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
    }
    const cached = this.#idempotencyCache.get(input.idempotencyKey);
    if (cached) return Promise.resolve({ ...cached, deduplicated: true });
    this.#counter += 1;
    const result: RecordUsageResult = {
      stripeUsageRecordId: `mbur_fake_${String(this.#counter).padStart(6, '0')}`,
      deduplicated: false,
      postedAt: this.#clock().toISOString(),
    };
    this.#idempotencyCache.set(input.idempotencyKey, result);
    this.#usageLog.push(input);
    return Promise.resolve(result);
  }
}
