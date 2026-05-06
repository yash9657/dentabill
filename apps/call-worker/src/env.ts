import { z } from 'zod';

/**
 * Worker process env. The worker is a Node service; it must load all
 * config from env at boot and crash early on any missing / malformed
 * value (no late surprises at job-pickup time).
 *
 * Phase 3 doesn't actually require RETELL_API_KEY — the FakeRetell
 * adapter (P3-T6) is the default when the key is absent. Production
 * deploy validates the key separately before flipping the live switch.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /** BullMQ + ioredis. Same DB / connection format as @dentabill/queue. */
  REDIS_URL: z.string().includes('://').min(1),

  /** Prisma connection string. Worker writes Call + CallEvent rows. */
  DATABASE_URL: z.string().includes('://').min(1),

  /** Retell SDK key. Empty / unset → `FakeRetell` adapter (ADR-033). */
  RETELL_API_KEY: z.string().optional().default(''),

  /** Per-payer Retell agent IDs (ADR-032). Empty in dev / test. */
  RETELL_AGENT_ID_DELTA_DENTAL_PPO: z.string().optional().default(''),
  RETELL_AGENT_ID_CIGNA_DENTAL: z.string().optional().default(''),
  RETELL_AGENT_ID_METLIFE_DENTAL: z.string().optional().default(''),

  /** HTTP port for the /healthz probe. */
  WORKER_PORT: z.coerce.number().int().positive().default(3010),

  /**
   * E.164 number the worker dials FROM. Provisioned in Retell (or
   * upstream telephony provider) and required before the first
   * production call. Dev/test default lets the worker boot — calls
   * resolved against FakeRetell never actually dial out.
   */
  WORKER_OUTBOUND_NUMBER: z
    .string()
    .regex(/^\+[0-9]{8,15}$/, 'expected E.164 (e.g. +15551234567)')
    .default('+15555550100'),

  /** BullMQ Worker concurrency (ADR-035 default = 4). */
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().max(64).default(4),

  /**
   * Per-call hard cap (ADR-038). 15 min default; lower for tests.
   * Worker uses this to enforce the wall-clock guard inside the
   * job handler.
   */
  MAX_CALL_DURATION_MS: z.coerce.number().int().positive().default(900_000),

  /**
   * Per-call hold cap (ADR-039). 10 min default. Hold detector
   * tears the call down + reschedules when this is exceeded.
   */
  MAX_HOLD_MS: z.coerce.number().int().positive().default(600_000),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadWorkerEnv(raw: NodeJS.ProcessEnv = process.env): WorkerEnv {
  // ADR-049: dotenv loads `KEY=` lines as `''`, which is truthy under
  // `??=` and bypasses Zod defaults. Normalise empty strings to
  // `undefined` at the loader.
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
    throw new Error(`Invalid call-worker env: ${errors}`);
  }
  return parsed.data;
}
