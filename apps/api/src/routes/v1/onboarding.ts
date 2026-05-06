import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { prisma, Prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getEnv } from '../../lib/env.js';

/**
 * Lazily-initialised Clerk backend client, constructed with the secret
 * key read explicitly from our validated env. We avoid `@clerk/fastify`'s
 * exported `clerkClient` singleton because it captures the secret key
 * at module-load time — order-of-import issues during dev HMR can leave
 * it with an empty key even when `process.env.CLERK_SECRET_KEY` is set.
 *
 * `getClerk()` returns `null` when no key is configured (test mode),
 * which the call sites use to skip the network round-trip cleanly.
 */
let cachedClerkClient: ClerkClient | null = null;
function getClerk(): ClerkClient | null {
  const env = getEnv();
  if (!env.CLERK_SECRET_KEY) return null;
  cachedClerkClient ??= createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    ...(env.CLERK_PUBLISHABLE_KEY ? { publishableKey: env.CLERK_PUBLISHABLE_KEY } : {}),
  });
  return cachedClerkClient;
}

/**
 * `POST /v1/onboarding` — first authenticated round-trip a new Clerk
 * user makes against DentaBill.
 *
 * Creates the `Organization` + `User` rows that every other
 * authenticated route assumes exist, and stamps the Clerk user's
 * `publicMetadata` so the Next.js middleware can gate `/dashboard/**`
 * without a database round-trip.
 *
 * Idempotency: If a `User` row already exists for this Clerk userId
 * (the route was POSTed twice from a flaky network, or the user
 * navigated back to /onboarding), the existing row is returned. The
 * client treats either response as "you are onboarded; go to the
 * dashboard". No silent merging — a duplicate practice-name on the
 * same Clerk user is a no-op.
 *
 * Auth model: this is the only authenticated route that uses
 * `requireUser` (Clerk session only) instead of `requireAuth` (which
 * additionally requires the DentaBill `User` row to exist). Every
 * other route assumes onboarding is complete.
 *
 * Clerk Organizations are intentionally not used in Phase 2 — see
 * docs/DECISIONS.md ADR-031 (forthcoming). `Organization.clerkOrgId`
 * is filled with a synthetic `local_<cuid>` value to satisfy the
 * existing unique-required schema; when team-member invites land in
 * Phase 4 we will migrate to real Clerk Org ids in a single backfill.
 */
const PayerEnum = z.enum([
  'Delta Dental PPO',
  'Cigna Dental',
  'MetLife Dental',
  'Aetna Dental',
  'Guardian Dental',
  'Humana Dental',
  'United Concordia',
  'Anthem Dental',
]);

// Mirrors apps/web/src/lib/onboarding-schema.ts NPI_REQUIRED_PAYERS.
// Server-side enforcement is independent of the client to defend
// against forged or out-of-date client requests.
const NPI_REQUIRED_PAYERS: ReadonlySet<z.infer<typeof PayerEnum>> = new Set([
  'Delta Dental PPO',
  'Cigna Dental',
  'MetLife Dental',
]);

const OnboardingBodySchema = z
  .object({
    practiceName: z.string().trim().min(2).max(160),
    npi: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\d{10}$/.test(v), 'NPI must be 10 digits or empty.'),
    zip: z
      .string()
      .trim()
      .regex(/^\d{5}$/, 'Zip must be 5 digits.'),
    acceptedPayers: z.array(PayerEnum).min(1).max(8),
  })
  .superRefine((data, ctx) => {
    const requiresNpi = data.acceptedPayers.some((p) => NPI_REQUIRED_PAYERS.has(p));
    if (requiresNpi && data.npi.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['npi'],
        message:
          'NPI is required when accepting Delta Dental PPO, Cigna Dental, or MetLife Dental.',
      });
    }
  });

const OnboardingResponseSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  alreadyOnboarded: z.boolean(),
});

type OnboardingBody = z.infer<typeof OnboardingBodySchema>;
type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;

/**
 * Stamp the Clerk user's publicMetadata so Next.js middleware can
 * read `sessionClaims.publicMetadata.onboarded` without a database
 * lookup.
 *
 * This is **load-bearing**, not best-effort: if the stamp fails the
 * dashboard redirect-gate keeps bouncing the user back to /onboarding
 * even though the DB rows exist. We surface the failure to the caller
 * so the client can retry on the idempotent path.
 *
 * In test mode (no `CLERK_SECRET_KEY`) the function is a no-op — the
 * test bypass in middleware doesn't read publicMetadata anyway.
 */
async function stampOnboardedMetadata(
  fastify: FastifyInstance,
  clerkUserId: string,
  meta: { dentabillOrgId: string; dentabillUserId: string },
): Promise<{ stamped: boolean }> {
  const clerk = getClerk();
  if (!clerk) return { stamped: false };
  try {
    await clerk.users.updateUser(clerkUserId, {
      publicMetadata: {
        onboarded: true,
        dentabillOrgId: meta.dentabillOrgId,
        dentabillUserId: meta.dentabillUserId,
      },
    });
    return { stamped: true };
  } catch (err) {
    fastify.log.error(
      { err, clerkUserId },
      'Failed to update Clerk publicMetadata. The DB rows exist but the dashboard redirect gate will keep bouncing this user. Surface the failure so the client retries.',
    );
    throw new ApiError(
      'INTERNAL_ERROR',
      'Could not finalise onboarding with the auth provider. Please try again.',
    );
  }
}

async function readClerkEmail(clerkUserId: string): Promise<string | null> {
  const clerk = getClerk();
  if (!clerk) return null;
  try {
    const user = await clerk.users.getUser(clerkUserId);
    const primary = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
    return primary ?? null;
  } catch {
    return null;
  }
}

export function onboardingRoutes(fastify: FastifyInstance): void {
  fastify.withTypeProvider().post(
    '/onboarding',
    {
      preHandler: fastify.auth.requireUser,
      schema: {
        description:
          'First-run onboarding for a Clerk-authenticated user. Idempotently creates the DentaBill Organization + User and stamps Clerk publicMetadata.',
        security: [{ bearer: [] }],
        body: OnboardingBodySchema,
        response: {
          200: OnboardingResponseSchema,
        },
      },
    },
    async (request): Promise<OnboardingResponse> => {
      const session = request.clerkAuth;
      if (!session) {
        throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
      }
      const body = request.body as OnboardingBody;

      // Idempotent: if the user already exists, return the existing
      // identity. The form's success path doesn't care which branch
      // fired, only that the call returned 200.
      const existing = await prisma.user.findUnique({
        where: { clerkUserId: session.clerkUserId },
        select: { id: true, organizationId: true },
      });
      if (existing) {
        await stampOnboardedMetadata(fastify, session.clerkUserId, {
          dentabillOrgId: existing.organizationId,
          dentabillUserId: existing.id,
        });
        return {
          organizationId: existing.organizationId,
          userId: existing.id,
          alreadyOnboarded: true,
        };
      }

      const email = (await readClerkEmail(session.clerkUserId)) ?? `${session.clerkUserId}@unknown`;

      // Create Organization + User in one transaction. Both are required
      // before any subsequent authenticated request can pass `requireAuth`.
      //
      // Race condition: two browser tabs (or a flaky network retry that
      // raced the first attempt) may both pass the `findUnique` check
      // and both reach this transaction. The second one violates one of
      // two unique indexes:
      //
      //   - `Organization.clerkOrgId @unique` on the synthetic
      //     `local_<clerkUserId>` value.
      //   - `User.clerkUserId @unique` on the user row.
      //
      // Either way the right user-facing answer is "you are already
      // onboarded; here is your existing record." We catch Prisma's
      // P2002 unique-constraint code and fall through to the same
      // idempotent path the up-front findUnique uses.
      let result: { orgId: string; userId: string };
      try {
        result = await prisma.$transaction(async (tx) => {
          const org = await tx.organization.create({
            data: {
              // `clerkOrgId` is unique + required in the schema. Real Clerk
              // Org wiring lands in Phase 4; until then we use a synthetic
              // namespaced id keyed off the Clerk userId. This keeps the
              // `@unique` index satisfied and makes future migration to a
              // real Clerk Org id a single UPDATE.
              clerkOrgId: `local_${session.clerkUserId}`,
              name: body.practiceName,
              npi: body.npi === '' ? null : body.npi,
              settings: {
                zip: body.zip,
                acceptedPayers: body.acceptedPayers,
              },
            },
            select: { id: true },
          });
          const user = await tx.user.create({
            data: {
              clerkUserId: session.clerkUserId,
              organizationId: org.id,
              email,
              role: 'ADMIN',
            },
            select: { id: true },
          });
          return { orgId: org.id, userId: user.id };
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const racedExisting = await prisma.user.findUnique({
            where: { clerkUserId: session.clerkUserId },
            select: { id: true, organizationId: true },
          });
          if (racedExisting) {
            await stampOnboardedMetadata(fastify, session.clerkUserId, {
              dentabillOrgId: racedExisting.organizationId,
              dentabillUserId: racedExisting.id,
            });
            return {
              organizationId: racedExisting.organizationId,
              userId: racedExisting.id,
              alreadyOnboarded: true,
            };
          }
        }
        throw err;
      }

      await stampOnboardedMetadata(fastify, session.clerkUserId, {
        dentabillOrgId: result.orgId,
        dentabillUserId: result.userId,
      });

      return {
        organizationId: result.orgId,
        userId: result.userId,
        alreadyOnboarded: false,
      };
    },
  );
}
