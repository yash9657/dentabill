import { z } from 'zod';

/**
 * Zod schema for environment variables. Validates on startup.
 * Fails fast with clear errors if anything is missing.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().includes('://').min(1),
  REDIS_URL: z.string().includes('://').min(1),
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
  const parsed = envSchema.safeParse(raw);

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
