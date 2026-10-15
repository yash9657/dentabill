import { z } from 'zod';

/**
 * Summary-worker process env. Validated at boot; the worker crashes
 * fast on bad config rather than failing later inside a job.
 *
 * Shared by BullMQ and inline/SQS runtimes. New work needs an explicit
 * provider selection; credentials alone cannot approve a native release.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REDIS_URL: z.string().includes('://').min(1),
  DATABASE_URL: z.string().includes('://').min(1),

  /** Empty selects the synthetic baseline; configured legacy credentials fail closed. */
  ANTHROPIC_API_KEY: z.string().optional().default(''),

  /** Explicit selector for new work; existing runs keep their persisted provider. */
  SUMMARY_ANALYSIS_PROVIDER: z.enum(['SYNTHETIC', 'FIREWORKS']).default('SYNTHETIC'),
  OBSERVATION_RELEASE_ID: z.string().min(1).max(256).optional(),
  FIREWORKS_API_KEY: z.string().optional(),
  OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),

  /**
   * Demo-only: let FakeClaude derive a summary from the transcript instead of
   * throwing when no test fixture is registered.
   *
   * FakeClaude is fixture-driven, so a call that is not driven by test code
   * produces no summary — the job retries and dead-letters, and the claim
   * never transitions. That makes a fake-mode demo impossible without this.
   * A configured ANTHROPIC_API_KEY is rejected rather than falling back to this mode. Counterpart to DEMO_AUTOPILOT on the call worker.
   */
  DEMO_SUMMARIZER_FALLBACK: z.enum(['true', 'false']).optional().default('false'),

  /** Output allowance used in the durable synthetic token admission allocation. */
  SUMMARIZER_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4000),

  /**
   * Per-org daily token budget (cost guard, ADR-042). Defaults to 1M
   * which is generous; production deploys set this lower per plan tier.
   * Admission uses durable DB allocations, including unknown outstanding reservations.
   */
  SUMMARIZER_DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().default(1_000_000),

  /**
   * Process-level kill switch for the auto-transition policy. When OFF
   * (default), every summary routes Claim → MANUAL_REVIEW regardless of
   * confidence — operators handle every transition by hand. ADR-042 W2F.
   *
   * Parses the env-var string explicitly: only `'true'` (case-insensitive)
   * + `'1'` count as on. Zod's `coerce.boolean()` would treat any
   * non-empty string as truthy — including `'false'`, which is the
   * exact footgun this kill switch must avoid.
   */
  SUMMARIZER_AUTO_TRANSITION_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v !== 'string') return false;
      const lower = v.trim().toLowerCase();
      return lower === 'true' || lower === '1';
    }),

  /** HTTP port for the /healthz probe. */
  WORKER_PORT: z.coerce.number().int().positive().default(3011),

  /** BullMQ Worker concurrency. Default 4. */
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().max(64).default(4),
});

export type SummaryWorkerEnv = z.infer<typeof envSchema>;

export function loadSummaryWorkerEnv(raw: NodeJS.ProcessEnv = process.env): SummaryWorkerEnv {
  // ADR-049: dotenv loads `KEY=` lines as `''`, which would bypass
  // Zod defaults. Strip empties before parse — matches the
  // call-worker / api loader pattern.
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
    throw new Error(`Invalid summary-worker env: ${errors}`);
  }
  return parsed.data;
}
