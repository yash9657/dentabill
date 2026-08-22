import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  timestamp: z.string(),
});

type HealthResponse = z.infer<typeof HealthResponseSchema>;

const ReadyzResponseSchema = z.object({
  ready: z.boolean(),
  timestamp: z.string(),
  postgres: z.object({ ok: z.boolean() }),
  redis: z.object({ ok: z.boolean() }),
});

type ReadyzResponse = z.infer<typeof ReadyzResponseSchema>;

/**
 * Health check routes for the API.
 *
 * `/healthz` — Liveness probe. Returns 200 if the server is running.
 * `/readyz` — Readiness probe. Tests Postgres (SELECT 1) and Redis (PING)
 *   with 800ms timeout each, run concurrently. Returns 200 if both pass,
 *   503 if either fails or times out.
 */
export function healthRoutes(fastify: FastifyInstance): void {
  fastify.withTypeProvider().get(
    '/healthz',
    {
      schema: {
        description: 'Liveness probe — server is running',
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    (): HealthResponse => {
      return {
        ok: true,
        version: '0.0.0',
        timestamp: new Date().toISOString(),
      };
    },
  );

  fastify.withTypeProvider().get(
    '/readyz',
    {
      schema: {
        description:
          'Readiness probe — server is ready to handle traffic. Tests Postgres and Redis readiness with 800ms timeout each.',
        response: {
          200: ReadyzResponseSchema,
          503: ReadyzResponseSchema,
        },
      },
    },
    async (request, reply): Promise<ReadyzResponse> => {
      const timeout = 800; // milliseconds
      const timestamp = new Date().toISOString();

      // Races `probe` against a timer, clearing the timer either way so a fast
      // probe doesn't leave a pending handle holding the event loop open.
      const withTimeout = async (probe: Promise<unknown>): Promise<boolean> => {
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            probe,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                reject(new Error('timeout'));
              }, timeout);
            }),
          ]);
          return true;
        } catch {
          return false;
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      };

      const postgresCheck = withTimeout(prisma.$queryRaw`SELECT 1`);

      // `queueRedis` is null only under NODE_ENV=test (see plugins/queue.ts),
      // where the queue is stubbed — so treating absence as healthy cannot
      // mask a real outage in production, where it is always a live connection.
      const redisCheck = fastify.queueRedis
        ? withTimeout(fastify.queueRedis.ping())
        : Promise.resolve(true);

      // Run both checks concurrently
      const [postgresOk, redisOk] = await Promise.all([postgresCheck, redisCheck]);
      const ready = postgresOk && redisOk;

      if (!ready) {
        reply.code(503);
      }

      return {
        ready,
        timestamp,
        postgres: { ok: postgresOk },
        redis: { ok: redisOk },
      };
    },
  );
}
