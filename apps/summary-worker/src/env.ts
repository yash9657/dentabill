import { z } from 'zod';

/**
 * Summary-worker process env. Validated at boot; the worker crashes
 * fast on bad config rather than failing later inside a job.
 *
 * Phase 4 ships with `ANTHROPIC_API_KEY` optional — empty / unset
 * selects the FakeClaude adapter (mirrors the Phase-3 RetellPort
 * pattern). Production deploy validates the key separately before
 * flipping `SUMMARIZER_AUTO_TRANSITION_ENABLED` on.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REDIS_URL: z.string().includes('://').min(1),
  DATABASE_URL: z.string().includes('://').min(1),

  /** Selects FakeClaude when empty / unset; LiveClaude otherwise. */
  ANTHROPIC_API_KEY: z.string().optional().default(''),

  /**
   * Demo-only: let FakeClaude derive a summary from the transcript instead of
   * throwing when no test fixture is registered.
   *
   * FakeClaude is fixture-driven, so a call that is not driven by test code
   * produces no summary — the job retries and dead-letters, and the claim
   * never transitions. That makes a fake-mode demo impossible without this.
   * Ignored whenever ANTHROPIC_API_KEY is set, since LiveClaude is then doing
   * the summarizing. Counterpart to DEMO_AUTOPILOT on the call worker.
   */
  DEMO_SUMMARIZER_FALLBACK: z.enum(['true', 'false']).optional().default('false'),

  /** Hard cap on output tokens per Claude call (ADR-042). */
  SUMMARIZER_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4000),

  /**
   * Per-org daily token budget (cost guard, ADR-042). Defaults to 1M
   * which is generous; production deploys set this lower per plan tier.
   * Mutated under Redis lock; budget overflow aborts + audits.
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
