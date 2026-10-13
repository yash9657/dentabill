import { JOB_DISPATCH_MODES } from '@dentabill/queue';
import { z } from 'zod';

/**
 * Zod schema for environment variables. Validates on startup.
 * Fails fast with clear errors if anything is missing.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().includes('://').min(1),
  /**
   * BullMQ + SSE pub/sub. Required in `bullmq` dispatch mode; optional in
   * `inline` mode (ADR-053), where its absence switches SSE to Postgres
   * polling, the readiness probe skips Redis, and the summary cost guard
   * becomes process-local. `rediss://` (TLS) URLs work as-is via ioredis.
   */
  REDIS_URL: z.string().includes('://').optional(),
  NEXT_PUBLIC_APP_URL: z.string().includes('://').min(1),
  NEXT_PUBLIC_API_URL: z.string().includes('://').optional(),
  API_CORS_ORIGINS: z.string().default(''),
  /**
   * Clerk authentication. Both keys are optional in dev / test so the
   * API boots without provisioned Clerk keys; the auth plugin reads
   * the same `hasClerkKeys` gate the web side uses and falls back to
   * a test-only header bypass when they are absent. Required in
   * production — server.ts validates that explicitly at boot.
   */
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  /**
   * Org-scoped DOB hashing secret per ADR-007 + `docs/SECURITY.md`.
   * Combined with `organizationId` and the cleartext DOB to produce
   * the on-disk `Claim.patientDOBHash`. Required in production —
   * server.ts validates on boot. Defaulted in dev/test so the
   * existing fixture-driven tests keep working.
   */
  DOB_HASH_SECRET: z.string().min(16).default('dev-only-dob-hash-secret-rotate-before-production'),
  /**
   * Shared secret used to verify HMAC-SHA256 signatures on inbound
   * Retell webhooks (P3-T17 / ADR-036). Required in production —
   * the webhook route refuses to verify with an empty secret. Defaulted
   * in dev/test so suites can craft signatures with a known value.
   */
  RETELL_WEBHOOK_SECRET: z
    .string()
    .min(16)
    .default('dev-only-retell-webhook-secret-rotate-before-production'),
  /**
   * Svix-signed webhook secret used to verify inbound Clerk webhooks
   * (organizationMembership.deleted, organization.deleted). Optional
   * in dev / test; the route refuses to verify against an unset
   * secret so tests deliberately omit it for the negative-path
   * assertions.
   */
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Telephony vendor key. The api never places calls itself; it reads this
   * only to know whether real telephony is configured, which gates the
   * demo-only overrides below.
   */
  RETELL_API_KEY: z.string().optional(),
  /**
   * Demo-only: skip the ADR-037 payer business-hours guard at enqueue.
   *
   * The guard is correct for production — dialling a closed payer line burns
   * a call and annoys a practice. But it also means "Call Now" returns 422
   * every evening and all weekend, which is exactly when a demo is likely to
   * run. This lets the demo work at 9pm on a Saturday without pretending the
   * payer is open.
   *
   * Ignored unless `RETELL_API_KEY` is empty, so it can never suppress the
   * guard once real telephony is wired up. See `payerHoursOverridden`.
   */
  DEMO_IGNORE_PAYER_HOURS: z.enum(['true', 'false']).optional().default('false'),

  /**
   * ADR-053 — how jobs are run. `bullmq` (default): Redis queues drained by
   * the always-on call-worker / summary-worker. `inline`: no workers; the
   * API POSTs each job to its own `/v1/internal/jobs/*` route, which runs
   * the processor to completion (serverless / Vercel deployments). `sqs`:
   * jobs are sent to the SQS queue at `JOBS_QUEUE_URL` and run by the
   * worker Lambda (`src/lambda-worker.ts`, AWS deployments).
   */
  JOB_DISPATCH_MODE: z
    .string()
    .optional()
    .transform((v) => (v ?? 'bullmq').trim().toLowerCase())
    .pipe(z.enum(JOB_DISPATCH_MODES)),
  /**
   * Shared secret for `/v1/internal/jobs/*` (sent in the
   * `x-internal-job-secret` header). Required in `inline` mode.
   */
  INTERNAL_JOB_SECRET: z.string().min(32).optional(),
  /**
   * Origin the inline dispatcher POSTs internal jobs to. Defaults to the
   * Vercel production domain, then the per-deployment URL, then localhost.
   * Set it explicitly when Deployment Protection guards *.vercel.app.
   */
  INTERNAL_API_BASE_URL: z.string().includes('://').optional(),
  /**
   * SQS standard queue URL every job is sent to. Required in `sqs` mode.
   * Region and credentials come from the standard AWS environment
   * (`AWS_REGION`, the Lambda execution role).
   */
  JOBS_QUEUE_URL: z.string().includes('://').optional(),
  /** Set by AWS Lambda; used only to pick platform-specific defaults. */
  AWS_LAMBDA_FUNCTION_NAME: z.string().optional(),
  /** Vercel system env (set automatically on Vercel). */
  VERCEL: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  /** Set by Vercel when "Protection Bypass for Automation" is enabled. */
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().optional(),
  /**
   * Upper bound on one SSE response. The client reconnects (and replays,
   * de-duplicated by event id) when a stream ends without a `close` event,
   * so this only needs to sit under the platform's function timeout.
   * Unset = unbounded, except on Vercel and AWS Lambda (900 s function
   * timeout) where it defaults to 780 s.
   */
  SSE_MAX_STREAM_MS: z.coerce.number().int().positive().optional(),
  /** Postgres poll cadence for SSE when Redis is not configured. */
  SSE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates and returns environment variables. Throws if validation fails.
 *
 * Resolves the Clerk publishable key from either `CLERK_PUBLISHABLE_KEY`
 * (the canonical name in this schema) OR `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
 * (the Next.js-prefixed name shared with apps/web). Publishable keys are
 * inherently public — exposing them server-side under either name is safe.
 * The fallback exists so a single root `.env` with the Next-style variable
 * configures both apps without duplication.
 */
export function loadEnv(): Env {
  const raw: Record<string, string | undefined> = { ...process.env };
  if (!raw.CLERK_PUBLISHABLE_KEY && raw.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    raw.CLERK_PUBLISHABLE_KEY = raw.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  }
  // ADR-049: dotenv loads `KEY=` lines as `''`, which is truthy under
  // `??=` and bypasses Zod defaults. Normalise empty strings to
  // `undefined` at the loader so every consumer (test setup, dev
  // server, prod boot) picks up defaults consistently. This is the
  // single canonical place — no per-suite workaround required.
  for (const key of Object.keys(raw)) {
    if (raw[key] === '') raw[key] = undefined;
  }
  const parsed = envSchema.safeParse(raw);

  if (parsed.success) {
    const modeErrors = dispatchModeErrors(parsed.data);
    if (modeErrors.length > 0) {
      throw new Error(`Invalid environment: ${modeErrors.join('; ')}`);
    }
  }

  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${errors}`);
  }

  return parsed.data;
}

/**
 * Cached environment instance. Call `loadEnv()` on module load in server.ts.
 */
let env: Env | undefined;

/**
 * Returns the cached environment. Lazy-loads on first call if not yet initialized.
 */
export function getEnv(): Env {
  return (env ??= loadEnv());
}

/**
 * Initialize the environment. Typically called once from server.ts.
 */
export function initEnv(): Env {
  env = loadEnv();
  return env;
}

/**
 * Whether the payer business-hours guard is currently overridden for the demo.
 *
 * Two conditions, both required: the operator opted in with
 * `DEMO_IGNORE_PAYER_HOURS=true`, AND no `RETELL_API_KEY` is configured. The
 * second is the safety interlock — the moment real telephony credentials
 * exist, the guard comes back regardless of the flag, so this can never cause
 * a real out-of-hours dial.
 */
export function payerHoursOverridden(candidate: Env = getEnv()): boolean {
  const hasRealTelephony = Boolean(candidate.RETELL_API_KEY && candidate.RETELL_API_KEY.length > 0);
  return candidate.DEMO_IGNORE_PAYER_HOURS === 'true' && !hasRealTelephony;
}

function dispatchModeErrors(candidate: Env): string[] {
  const errors: string[] = [];
  if (candidate.JOB_DISPATCH_MODE === 'bullmq' && !candidate.REDIS_URL) {
    errors.push('REDIS_URL: required when JOB_DISPATCH_MODE=bullmq');
  }
  if (candidate.JOB_DISPATCH_MODE === 'inline' && !candidate.INTERNAL_JOB_SECRET) {
    errors.push('INTERNAL_JOB_SECRET: required (min 32 chars) when JOB_DISPATCH_MODE=inline');
  }
  if (candidate.JOB_DISPATCH_MODE === 'sqs' && !candidate.JOBS_QUEUE_URL) {
    errors.push('JOBS_QUEUE_URL: required when JOB_DISPATCH_MODE=sqs');
  }
  return errors;
}

/**
 * Origin the inline dispatcher calls back into (ADR-053). Order:
 * explicit `INTERNAL_API_BASE_URL` → Vercel production domain (production
 * deployments only — unaffected by Standard Deployment Protection) →
 * per-deployment `VERCEL_URL` → local listener.
 */
export function resolveInternalApiBaseUrl(candidate: Env = getEnv()): string {
  if (candidate.INTERNAL_API_BASE_URL) return candidate.INTERNAL_API_BASE_URL;
  if (candidate.VERCEL_ENV === 'production' && candidate.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${candidate.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (candidate.VERCEL_URL) return `https://${candidate.VERCEL_URL}`;
  return `http://127.0.0.1:${String(candidate.PORT)}`;
}

/** Effective SSE stream cap — see `SSE_MAX_STREAM_MS`. */
export function sseMaxStreamMs(candidate: Env = getEnv()): number | null {
  if (candidate.SSE_MAX_STREAM_MS !== undefined) return candidate.SSE_MAX_STREAM_MS;
  return candidate.VERCEL || candidate.AWS_LAMBDA_FUNCTION_NAME ? 780_000 : null;
}
