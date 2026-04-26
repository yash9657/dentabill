import { clerkPlugin, getAuth } from '@clerk/fastify';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';

import { getEnv } from '../lib/env.js';

/**
 * Authentication plugin for the DentaBill Fastify API.
 *
 * Two execution modes:
 *
 *   1. **Production / staging** — Both `CLERK_SECRET_KEY` and
 *      `CLERK_PUBLISHABLE_KEY` are present. The plugin registers
 *      `@clerk/fastify`'s `clerkPlugin` so every request is decorated
 *      with Clerk session data, and exposes `requireAuth` as a
 *      preHandler that calls Clerk's `getAuth(request)` and pulls
 *      `userId` + `orgId` off the verified session. Missing session
 *      or missing `orgId` (a user not currently scoped to an
 *      organization) throws `ApiError("AUTHENTICATION_REQUIRED")`,
 *      which the global error handler in `app.ts` serialises to a
 *      401.
 *
 *   2. **Dev / test (no keys)** — Both env vars are absent (the
 *      vitest setup leaves them undefined; local dev without Clerk
 *      keys provisioned). The plugin skips Clerk's plugin registration
 *      entirely and `requireAuth` reads `x-test-user-id` /
 *      `x-test-org-id` request headers, attaching them as the auth
 *      identity. Same `ApiError` is thrown when those headers are
 *      missing on a protected route.
 *
 * Routes opt in to authentication by attaching `requireAuth` as a
 * `preHandler`. The plugin does NOT auto-protect every route — health
 * probes (`/healthz`, `/readyz`) and the OpenAPI spec endpoint are
 * deliberately public. P2-T38 starts wiring `requireAuth` into the
 * claims router as it lands.
 *
 * `request.auth` is decorated as `null` at registration time so the
 * field exists on every request and TypeScript can narrow safely.
 * Per-request mutation happens inside `requireAuth`.
 */
export interface AuthIdentity {
  readonly userId: string;
  readonly orgId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthIdentity | null;
  }
  interface FastifyInstance {
    auth: AuthPluginExports;
  }
}

const TEST_USER_HEADER = 'x-test-user-id';
const TEST_ORG_HEADER = 'x-test-org-id';

function readTestAuth(request: FastifyRequest): AuthIdentity | null {
  const userId = request.headers[TEST_USER_HEADER];
  const orgId = request.headers[TEST_ORG_HEADER];
  if (typeof userId !== 'string' || typeof orgId !== 'string') return null;
  if (userId.length === 0 || orgId.length === 0) return null;
  return { userId, orgId };
}

function buildClerkRequireAuth(): preHandlerHookHandler {
  return (request, _reply, done) => {
    const session = getAuth(request);
    if (!session.userId || !session.orgId) {
      done(
        new ApiError('AUTHENTICATION_REQUIRED', 'Sign in and select an organization to continue.'),
      );
      return;
    }
    request.auth = { userId: session.userId, orgId: session.orgId };
    done();
  };
}

function buildTestRequireAuth(): preHandlerHookHandler {
  return (request, _reply, done) => {
    const identity = readTestAuth(request);
    if (!identity) {
      done(
        new ApiError('AUTHENTICATION_REQUIRED', 'Sign in and select an organization to continue.'),
      );
      return;
    }
    request.auth = identity;
    done();
  };
}

export interface AuthPluginExports {
  readonly requireAuth: preHandlerHookHandler;
  readonly hasClerkKeys: boolean;
}

/**
 * Registers the auth plugin and returns the `requireAuth` preHandler
 * that route modules can attach to the routes that need it.
 *
 * The function is async because `clerkPlugin` registration is async.
 * Callers in `app.ts` should `await` and stash the returned
 * `requireAuth` for later use, or attach it via `fastify.decorate` if
 * we ever need to access it from a per-route schema definition.
 */
export async function registerAuthPlugin(fastify: FastifyInstance): Promise<AuthPluginExports> {
  const env = getEnv();
  const hasClerkKeys = Boolean(env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY);

  fastify.decorateRequest('auth', null);

  if (hasClerkKeys && env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY) {
    await fastify.register(clerkPlugin, {
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
    });
    return { requireAuth: buildClerkRequireAuth(), hasClerkKeys: true };
  }

  return { requireAuth: buildTestRequireAuth(), hasClerkKeys: false };
}
