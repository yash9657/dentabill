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
 *   - `signed-out` — no Clerk session at all; route should redirect to /sign-in
 *   - `pending`    — signed in, but no DentaBill `User` row yet; route to /onboarding
 *   - `onboarded`  — signed in and `User`+`Organization` exist; route to /dashboard
 */
export type OnboardingStatus =
  | { readonly state: 'signed-out' }
  | { readonly state: 'pending'; readonly clerkUserId: string }
  | {
      readonly state: 'onboarded';
      readonly clerkUserId: string;
      readonly userId: string;
      readonly organizationId: string;
    };

export const getOnboardingStatus = cache(async (): Promise<OnboardingStatus> => {
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
