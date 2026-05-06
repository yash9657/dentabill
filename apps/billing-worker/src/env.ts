import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().includes('://').min(1),

  /** Selects FakeStripe when empty / unset; LiveStripe otherwise. */
  STRIPE_API_KEY: z.string().optional().default(''),

  /**
   * When `true`, LiveStripe actually POSTs to Stripe. When `false`
   * (default), the worker still writes BillingUsageRecord rows but
   * skips the Stripe API call — receipt-only mode (ADR-043, W3).
   *
   * Explicit string→bool parser per the same kill-switch rationale
   * as SUMMARIZER_AUTO_TRANSITION_ENABLED — `coerce.boolean()` would
   * read 'false' as truthy, the precise footgun this gate must avoid.
   */
  STRIPE_METERED_BILLING_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v !== 'string') return false;
      const lower = v.trim().toLowerCase();
      return lower === 'true' || lower === '1';
    }),

  /**
   * Per-resolved-claim flat fee in cents. ADR-043 punts deeper pricing
   * to Phase 5 once we have customer data; for now every resolved
   * claim is billed at the same rate per org plan tier.
   */
  STRIPE_PER_CLAIM_FEE_CENTS: z.coerce.number().int().min(0).default(50),
});

export type BillingWorkerEnv = z.infer<typeof envSchema>;

export function loadBillingWorkerEnv(raw: NodeJS.ProcessEnv = process.env): BillingWorkerEnv {
  const normalised: Record<string, string | undefined> = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    normalised[key] = value === '' ? undefined : value;
  }
  const parsed = envSchema.safeParse(normalised);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid billing-worker env: ${errors}`);
  }
  return parsed.data;
}
