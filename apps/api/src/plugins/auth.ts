import { clerkPlugin, getAuth } from '@clerk/fastify';
import { prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import type {
  FastifyInstance,
  FastifyRequest,
  preHandlerAsyncHookHandler,
  preHandlerHookHandler,
} from 'fastify';

import { getEnv } from '../lib/env.js';

/**
 * Authentication plugin for the DentaBill Fastify API.
 *
 * Two preHandlers ship from this plugin:
 *
 *   • `requireUser` — only checks that the request carries a valid
 *     Clerk session. Used by `/v1/onboarding`, the *first* authenticated
 *     route a brand-new Clerk user hits, before any DentaBill records
 *     exist.
 *
 *   • `requireAuth` — checks the Clerk session AND looks up the
 *     matching DentaBill `User.clerkUserId` row to derive the
 *     authoritative `userId` (DentaBill `User.id`) and `orgId`
 *     (DentaBill `User.organizationId`). Throws `ONBOARDING_REQUIRED`
 *     (403) if the Clerk user is signed in but has not yet completed
 *     `/v1/onboarding`. Every org-scoped route uses this.
 *
 * Two execution modes for the Clerk session source:
 *
 *   1. **Production / staging** — Both `CLERK_SECRET_KEY` and
 *      `CLERK_PUBLISHABLE_KEY` are present; Clerk's plugin verifies
 *      session JWTs.
 *
 *   2. **Dev / test (no keys)** — Both env vars are absent. The plugin
 *      reads `x-test-user-id` (Clerk userId stand-in) headers, and the
 *      DB lookup proceeds the same way. The legacy `x-test-org-id`
 *      header is no longer required: the org is always derived from
 *      the DentaBill `User` row.
 *
 * Routes opt in to authentication by attaching the appropriate
 * preHandler. Health probes (`/healthz`, `/readyz`) and the OpenAPI
 * spec endpoint stay public.
 */
export interface AuthIdentity {
  /** DentaBill `User.id` — the authoritative actor id used by audit + write middleware. */
  readonly userId: string;
  /** DentaBill `Organization.id` — the authoritative tenant scope for every org-scoped read. */
  readonly orgId: string;
  /** The originating Clerk userId, kept for forwarding logs / metadata. */
  readonly clerkUserId: string;
}

export interface ClerkOnlyIdentity {
  readonly clerkUserId: string;
}

/**
 * `request.dentabillAuth` is the DentaBill-resolved identity (DentaBill
 * `User.id` + `Organization.id`). It is deliberately a separate slot
 * from Clerk's own `request.auth` decorator (added by `clerkPlugin`),
 * which carries the raw Clerk session — the two coexist on the same
 * request, the names cannot collide, and downstream handlers reach
 * for whichever they need.
 *
 * `request.clerkAuth` carries the bare Clerk userId for the one
 * authenticated route (`/v1/onboarding`) that runs before the
 * DentaBill records exist.
 */
declare module 'fastify' {
  interface FastifyRequest {
    dentabillAuth: AuthIdentity | null;
    clerkAuth: ClerkOnlyIdentity | null;
  }
  interface FastifyInstance {
    auth: AuthPluginExports;
  }
}

const TEST_USER_HEADER = 'x-test-user-id';
const TEST_ORG_HEADER = 'x-test-org-id';

function readTestClerkUserId(request: FastifyRequest): string | null {
  const userId = request.headers[TEST_USER_HEADER];
  if (typeof userId !== 'string' || userId.length === 0) return null;
  return userId;
}

function readTestOrgIdOverride(request: FastifyRequest): string | null {
  const orgId = request.headers[TEST_ORG_HEADER];
  if (typeof orgId !== 'string' || orgId.length === 0) return null;
  return orgId;
}

async function loadDentaBillUser(clerkUserId: string): Promise<AuthIdentity | null> {
  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true, organizationId: true },
  });
  if (!user) return null;
  return { userId: user.id, orgId: user.organizationId, clerkUserId };
}

/**
 * Defence-in-depth check (ADR-044): when the Clerk session carries an
 * `orgId`, the matching `Organization.clerkOrgId` MUST equal it.
 *
 * Without this, a stale JWT minted for the user's previous org could
 * still be accepted because we resolve `dentabillAuth.orgId` from the
 * DB user — bypassing whatever org-switch happened on Clerk's side.
 *
 * Skipped when `session.orgId` is null (single-tenant Clerk users in
 * pre-W4-migration accounts) or when the DentaBill org still carries
 * a synthetic `local_*` clerkOrgId — the migration script swaps
 * those out, but until it has run for an org we cannot enforce the
 * assertion.
 */
async function assertJwtOrgMatchesDbOrg(
  sessionOrgId: string | null | undefined,
  dbOrgId: string,
): Promise<boolean> {
  if (!sessionOrgId) return true;
  const org = await prisma.organization.findUnique({
    where: { id: dbOrgId },
    select: { clerkOrgId: true },
  });
  if (!org) return false;
  if (org.clerkOrgId.startsWith('local_')) return true;
  return org.clerkOrgId === sessionOrgId;
}

function buildClerkRequireUser(): preHandlerHookHandler {
  return (request, _reply, done) => {
    const session = getAuth(request);
    if (!session.userId) {
      done(new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.'));
      return;
    }
    request.clerkAuth = { clerkUserId: session.userId };
    done();
  };
}

function buildTestRequireUser(): preHandlerHookHandler {
  return (request, _reply, done) => {
    const clerkUserId = readTestClerkUserId(request);
    if (!clerkUserId) {
      done(new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.'));
      return;
    }
    request.clerkAuth = { clerkUserId };
    done();
  };
}

const buildClerkRequireAuth = (): preHandlerAsyncHookHandler => {
  return async (request) => {
    const session = getAuth(request);
    if (!session.userId) {
      throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
    }
    const identity = await loadDentaBillUser(session.userId);
    if (!identity) {
      throw new ApiError(
        'FORBIDDEN',
        'Onboarding required. Complete the practice setup before continuing.',
      );
    }
    const sessionOrgId =
      typeof (session as { orgId?: unknown }).orgId === 'string'
        ? ((session as { orgId?: string }).orgId ?? null)
        : null;
    const orgMatch = await assertJwtOrgMatchesDbOrg(sessionOrgId, identity.orgId);
    if (!orgMatch) {
      throw new ApiError(
        'AUTHENTICATION_REQUIRED',
        'Session organization mismatch — please reload to refresh your session.',
      );
    }
    request.dentabillAuth = identity;
    request.clerkAuth = { clerkUserId: session.userId };
  };
};

const buildTestRequireAuth = (): preHandlerAsyncHookHandler => {
  return async (request) => {
    const clerkUserId = readTestClerkUserId(request);
    if (!clerkUserId) {
      throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
    }
    const orgIdOverride = readTestOrgIdOverride(request);
    if (orgIdOverride) {
      // Test bypass path: integration tests that have already seeded
      // an Organization + User row pass both headers. The userId is
      // the DentaBill `User.id` (not a Clerk userId) in that mode,
      // matching how every existing test fixture uses it.
      request.dentabillAuth = { userId: clerkUserId, orgId: orgIdOverride, clerkUserId };
      request.clerkAuth = { clerkUserId };
      return;
    }
    const identity = await loadDentaBillUser(clerkUserId);
    if (!identity) {
      throw new ApiError(
        'FORBIDDEN',
        'Onboarding required. Complete the practice setup before continuing.',
      );
    }
    request.dentabillAuth = identity;
    request.clerkAuth = { clerkUserId };
  };
};

export interface AuthPluginExports {
  readonly requireAuth: preHandlerAsyncHookHandler;
  readonly requireUser: preHandlerHookHandler;
  readonly hasClerkKeys: boolean;
}

/**
 * Registers the auth plugin and returns the preHandlers route modules
 * attach to gate access. `requireUser` is the bare-Clerk-session check
 * used by `/v1/onboarding`; `requireAuth` is the org-scoped check used
 * by every other authenticated route.
 */
export async function registerAuthPlugin(fastify: FastifyInstance): Promise<AuthPluginExports> {
  const env = getEnv();
  const hasClerkKeys = Boolean(env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY);

  // Without Clerk keys the fallback accepts an `x-test-user-id` header as proof
  // of identity. That is fine on a laptop and essential for the integration
  // suite, but on a reachable host it is a total authentication bypass: anyone
  // who guesses or reads a clerkUserId gets full org-scoped access to that
  // org's claims. Refusing to boot is the only safe behaviour — a warning is
  // not enough, because the warning scrolls past and the server keeps serving.
  //
  // `env.ts` has long claimed server.ts enforced this at boot. It did not; the
  // startup path only logged `auth mode: test-header-bypass` and carried on.
  if (env.NODE_ENV === 'production' && !hasClerkKeys) {
    throw new Error(
      'Refusing to start: NODE_ENV=production requires CLERK_SECRET_KEY and ' +
        'CLERK_PUBLISHABLE_KEY (or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY). Without them the ' +
        'API would accept the x-test-user-id header as authentication, which is a ' +
        'complete auth bypass on any reachable host.',
    );
  }

  fastify.decorateRequest('dentabillAuth', null);
  fastify.decorateRequest('clerkAuth', null);

  if (hasClerkKeys && env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY) {
    await fastify.register(clerkPlugin, {
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
    });
    return {
      requireAuth: buildClerkRequireAuth(),
      requireUser: buildClerkRequireUser(),
      hasClerkKeys: true,
    };
  }

  return {
    requireAuth: buildTestRequireAuth(),
    requireUser: buildTestRequireUser(),
    hasClerkKeys: false,
  };
}
