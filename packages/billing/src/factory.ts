import { FakeStripe } from './fake.js';
import { LiveStripe } from './live.js';
import type { BillingPort } from './port.js';

/**
 * `createBillingPort({ stripeApiKey, enabled })`
 *
 * Empty / unset key → FakeStripe (in-memory).
 * Non-empty key → LiveStripe wired to the real Stripe SDK.
 *
 * The SDK is lazy-loaded via `await import('stripe')` so dev/test
 * bundles stay SDK-free. The `enabled` flag controls receipt-only vs
 * actual Stripe POST mode for LiveStripe.
 */

type StripeCtor = new (
  apiKey: string,
  options?: { apiVersion?: string },
) => {
  customers: {
    create: (input: { name: string; email: string; metadata?: Record<string, string> }) => Promise<{
      id: string;
    }>;
    list: (input: { email: string; limit?: number }) => Promise<{ data: { id: string }[] }>;
  };
  billing: {
    meterEvents: {
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
};

type StripeLoader = () => Promise<StripeCtor>;

export interface CreateBillingPortInput {
  readonly stripeApiKey?: string;
  /** When false, LiveStripe runs in receipt-only mode (no Stripe POST). */
  readonly enabled?: boolean;
  /** Optional override for testing the live wiring without a real SDK. */
  readonly stripeLoader?: StripeLoader;
}

export interface CreateBillingPortResult {
  readonly billing: BillingPort;
  readonly mode: 'live' | 'fake';
}

export async function createBillingPort(
  input: CreateBillingPortInput,
): Promise<CreateBillingPortResult> {
  const key = input.stripeApiKey ?? '';
  if (key.length === 0) {
    return { billing: new FakeStripe(), mode: 'fake' };
  }
  const loader: StripeLoader =
    input.stripeLoader ??
    ((): Promise<StripeCtor> => {
      const moduleId = 'stripe';
      return import(moduleId).then((m: { default: StripeCtor }) => m.default);
    });
  const Ctor = await loader();
  const client = new Ctor(key, { apiVersion: '2025-04-30.basil' });
  const billing = new LiveStripe({
    stripeClient: client,
    enabled: input.enabled ?? false,
  });
  return { billing, mode: 'live' };
}
