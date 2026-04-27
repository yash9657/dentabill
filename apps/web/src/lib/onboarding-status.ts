import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@dentabill/db';
import { cache } from 'react';

/**
 * Server-side onboarding gate. The DB is the source of truth — we
 * deliberately do NOT read `publicMetadata.onboarded` from the Clerk
 * session JWT because that value is cached at JWT-issue time and can
 * lag the DB by tens of seconds after a successful onboarding submit.
 *
 * Wrapped in `cache()` so multiple Server Components in the same
 * request (dashboard layout + page + breadcrumbs) share one DB query.
 *
 * Returns a discriminated tagged result so callers can branch:
 *   - `unconfigured` — no Clerk keys present; CI / test mode. Callers should treat
 *     as a pass-through and render their content. The middleware is a no-op in
 *     this mode too, so the absence of keys is the single source of "auth off".
 *   - `signed-out`  — Clerk configured, no session; redirect to /sign-in
 *   - `pending`     — signed in, but no DentaBill `User` row yet; redirect to /onboarding
 *   - `onboarded`   — signed in and `User`+`Organization` exist; render dashboard
 */
export type OnboardingStatus =
  | { readonly state: 'unconfigured' }
  | { readonly state: 'signed-out' }
  | { readonly state: 'pending'; readonly clerkUserId: string }
  | {
      readonly state: 'onboarded';
      readonly clerkUserId: string;
      readonly userId: string;
      readonly organizationId: string;
    };

const hasClerkKeys = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

export const getOnboardingStatus = cache(async (): Promise<OnboardingStatus> => {
  // CI / e2e test mode: the middleware is a no-op pass-through when no Clerk
  // keys are configured, and `auth()` throws "Clerk can't detect usage of
  // clerkMiddleware()" in that state. Bail out early so callers can render
  // without the auth gate. Production always has keys, so this branch never
  // fires there.
  if (!hasClerkKeys()) return { state: 'unconfigured' };

  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return { state: 'signed-out' };

  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true, organizationId: true },
  });

  if (!user) return { state: 'pending', clerkUserId };
  return {
    state: 'onboarded',
    clerkUserId,
    userId: user.id,
    organizationId: user.organizationId,
  };
});
