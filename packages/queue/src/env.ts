import { z } from 'zod';

const envSchema = z.object({
  REDIS_URL: z.string().includes('://').min(1),
  /**
   * BullMQ Worker concurrency for the `calls` queue (ADR-035 default = 4).
   * Tuned against Retell's outbound-call limit and the Postgres pool size;
   * override per environment.
   */
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().max(64).default(4),
});

export type QueueEnv = z.infer<typeof envSchema>;

export function loadQueueEnv(raw: NodeJS.ProcessEnv = process.env): QueueEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid queue env: ${errors}`);
  }
  return parsed.data;
}
