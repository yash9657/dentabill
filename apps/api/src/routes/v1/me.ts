import { prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const MeOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  npi: z.string().nullable(),
  plan: z.enum(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']),
});

const MeUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.enum(['OWNER', 'ADMIN', 'BILLING_STAFF']),
});

const MeResponseSchema = z.object({
  user: MeUserSchema,
  organization: MeOrganizationSchema,
});

type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * `/v1/me` — the authenticated profile probe. Used by the dashboard
 * shell to display practice name + user role, and by the onboarding
 * gate as a fast "am I onboarded?" check (a 200 means the DentaBill
 * `User` row exists and the practice is set up).
 *
 * The route is preHandled by `requireAuth`, so reaching the handler
 * already guarantees both `User` and `Organization` exist. A 403
 * with `code: FORBIDDEN` from the preHandler signals "Clerk session
 * is valid but onboarding hasn't completed" — the web client uses
 * that signal to redirect the visitor to `/onboarding`.
 */
export function meRoutes(fastify: FastifyInstance): void {
  fastify.withTypeProvider().get(
    '/me',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        description:
          'Returns the authenticated DentaBill User and Organization for the current Clerk session.',
        security: [{ bearer: [] }],
        response: {
          200: MeResponseSchema,
        },
      },
    },
    async (request): Promise<MeResponse> => {
      const identity = request.dentabillAuth;
      if (!identity) {
        throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
      }
      const [user, organization] = await Promise.all([
        prisma.user.findUnique({
          where: { id: identity.userId },
          select: { id: true, email: true, name: true, role: true },
        }),
        prisma.organization.findUnique({
          where: { id: identity.orgId },
          select: { id: true, name: true, npi: true, plan: true },
        }),
      ]);
      if (!user || !organization) {
        // Should not happen — requireAuth verified both exist. Treat as
        // an onboarding gap rather than an internal error so the client
        // can route the user back to /onboarding gracefully.
        throw new ApiError(
          'FORBIDDEN',
          'Onboarding required. Complete the practice setup before continuing.',
        );
      }
      return { user, organization };
    },
  );
}
