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
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates and returns environment variables. Throws if validation fails.
 */
export function loadEnv(): Env {
  const raw = process.env;
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
