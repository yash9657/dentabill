import { audit, prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const MeOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  npi: z.string().nullable(),
  plan: z.enum(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']),
});

const PatchOrganizationBodySchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    npi: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\d{10}$/.test(v), 'NPI must be exactly 10 digits or empty.')
      .optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.npi !== undefined,
    'At least one field (name, npi) must be provided.',
  );

type PatchOrganizationBody = z.infer<typeof PatchOrganizationBodySchema>;
type MeOrganization = z.infer<typeof MeOrganizationSchema>;

const ALLOWED_WRITE_ROLES: ReadonlySet<'OWNER' | 'ADMIN' | 'BILLING_STAFF'> = new Set([
  'OWNER',
  'ADMIN',
]);

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

  fastify.withTypeProvider().patch(
    '/me/organization',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        description:
          'Update the current organization. Restricted to OWNER + ADMIN. NPI is required for payer dialling — empty values are accepted but block the Call Now action.',
        security: [{ bearer: [] }],
        body: PatchOrganizationBodySchema,
        response: { 200: MeOrganizationSchema },
      },
      config: {
        rateLimit: {
          hook: 'preHandler',
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (req): string => req.dentabillAuth?.orgId ?? 'anon',
        },
      },
    },
    async (request): Promise<MeOrganization> => {
      const identity = request.dentabillAuth;
      if (!identity) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');

      const actor = await prisma.user.findUnique({
        where: { id: identity.userId },
        select: { role: true },
      });
      if (!actor || !ALLOWED_WRITE_ROLES.has(actor.role)) {
        throw new ApiError(
          'FORBIDDEN',
          'Only practice owners and admins can edit organization settings.',
        );
      }

      const body = request.body as PatchOrganizationBody;
      const updateData: { name?: string; npi?: string | null } = {};
      const changedFields: string[] = [];
      if (body.name !== undefined) {
        updateData.name = body.name;
        changedFields.push('name');
      }
      if (body.npi !== undefined) {
        updateData.npi = body.npi === '' ? null : body.npi;
        changedFields.push('npi');
      }

      // Multi-tenant write: updateMany with composite where satisfies
      // ADR-008 (the write middleware enforces organizationId presence).
      const result = await prisma.organization.updateMany({
        where: { id: identity.orgId },
        data: updateData,
      });
      if (result.count === 0) {
        throw new ApiError('NOT_FOUND', 'Organization not found.');
      }

      const fresh = await prisma.organization.findUnique({
        where: { id: identity.orgId },
        select: { id: true, name: true, npi: true, plan: true },
      });
      if (!fresh) throw new ApiError('NOT_FOUND', 'Organization not found.');

      // Audit-log the change. Per HIPAA "minimum necessary", we record
      // *which* fields changed but never the values themselves — NPI is
      // a Medical Provider Identifier and shouldn't appear in audit logs.
      await audit({
        action: 'organization.update',
        resourceType: 'Organization',
        resourceId: identity.orgId,
        organizationId: identity.orgId,
        userId: identity.userId,
        metadata: { changedFields },
      });

      return fresh;
    },
  );
}
