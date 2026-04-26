import { type FastifyInstance } from 'fastify';
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
});

type ReadyzResponse = z.infer<typeof ReadyzResponseSchema>;

/**
 * Health check routes for the API.
 *
 * `/healthz` — Liveness probe. Returns 200 if the server is running.
 * `/readyz` — Readiness probe. Stub for Phase 2; Phase 2B will add DB + Redis checks.
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
          'Readiness probe — server is ready to handle traffic. Phase 2B will add DB/Redis checks.',
        response: {
          200: ReadyzResponseSchema,
        },
      },
    },
    (): ReadyzResponse => {
      // TODO(P2-T12B): Add DB readiness check (SELECT 1)
      // TODO(P2-T12B): Add Redis readiness check (PING)
      return {
        ready: true,
        timestamp: new Date().toISOString(),
      };
    },
  );
}
