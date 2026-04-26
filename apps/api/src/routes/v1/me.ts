import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const MeResponseSchema = z.object({
  userId: z.string(),
  orgId: z.string(),
});

type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * `/v1/me` — minimal authenticated probe that returns the verified
 * `userId` + `orgId` for the current request.
 *
 * Lands with the auth middleware in P2-T37 so the integration tests
 * have a real protected route to assert against. The claims and
 * ingestion routes (P2-T38, P2-T43) reuse the same `requireAuth`
 * preHandler attached here.
 */
export function meRoutes(fastify: FastifyInstance): void {
  fastify.withTypeProvider().get(
    '/me',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        description: 'Returns the userId + orgId of the current Clerk session.',
        security: [{ bearer: [] }],
        response: {
          200: MeResponseSchema,
        },
      },
    },
    (request): MeResponse => {
      // requireAuth guarantees `request.auth` is set or the preHandler
      // throws AUTHENTICATION_REQUIRED before this handler runs.
      const identity = request.auth;
      if (!identity) {
        throw new Error('unreachable: requireAuth populated request.auth');
      }
      return { userId: identity.userId, orgId: identity.orgId };
    },
  );
}
