import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { cache } from 'react';

/**
 * Server-side onboarding gate. `apps/api`'s `/v1/me` is the authoritative
 * source — it's the same DB the rest of the platform writes through and
 * its `requireAuth` preHandler returns 403 when the Clerk session is
 * valid but the DentaBill `User` row hasn't been created yet, exactly
 * matching our three-state contract.
 *
 * We deliberately do NOT import `@dentabill/db` from `apps/web`:
 * pulling Prisma + `@dentabill/logger`'s pino transport into the web
 * bundle drags worker-thread / native-binary resolution paths through
 * webpack/Turbopack and breaks `next start` and `next dev` in subtle,
 * environment-specific ways. Going through the API endpoint keeps
 * `apps/web` a pure presentation tier with one HTTP hop to the source
 * of truth.
 *
 * Wrapped in `cache()` so multiple Server Components in the same
 * request (dashboard layout + page + breadcrumbs) share one fetch.
 *
 * Returns a discriminated tagged result so callers can branch:
 *   - `unconfigured` — no Clerk keys present; CI / test mode. The web
 *     middleware is a no-op pass-through in this state and `auth()`
 *     would throw, so we short-circuit and let callers render their
 *     content. Production always has keys, so this branch never fires
 *     there.
 *   - `signed-out`  — Clerk session missing or expired. Caller should
 *     redirect to /sign-in.
 *   - `pending`     — Clerk session valid but DentaBill `User` row
 *     does not exist. Caller should redirect to /onboarding.
 *   - `onboarded`   — both Clerk session and DentaBill rows exist;
 *     caller should render the dashboard.
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

interface MeResponseBody {
  readonly user: { readonly id: string };
  readonly organization: { readonly id: string };
}

const hasClerkKeys = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

const apiBaseUrl = (): string => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const getOnboardingStatus = cache(async (): Promise<OnboardingStatus> => {
  if (!hasClerkKeys()) return { state: 'unconfigured' };

  const session = await auth();
  const clerkUserId = session.userId;
  if (!clerkUserId) return { state: 'signed-out' };

  const token = await session.getToken();
  if (!token) return { state: 'signed-out' };

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/v1/me`, {
      headers: { authorization: `Bearer ${token}` },
      // The onboarding gate must reflect the latest DB state, so opt
      // out of Next's automatic fetch cache. Cross-request memoisation
      // is provided by `cache()` above.
      cache: 'no-store',
    });
  } catch {
    // Network failure reaching the API. Treat as signed-out so the
    // caller can route to /sign-in (where the user can recover) rather
    // than silently dropping them on a half-rendered dashboard.
    return { state: 'signed-out' };
  }

  if (response.status === 401) return { state: 'signed-out' };
  if (response.status === 403) return { state: 'pending', clerkUserId };
  if (!response.ok) {
    // 5xx etc. Same recovery posture as a network failure.
    return { state: 'signed-out' };
  }

  const body = (await response.json().catch(() => null)) as MeResponseBody | null;
  if (!body) return { state: 'signed-out' };

  return {
    state: 'onboarded',
    clerkUserId,
    userId: body.user.id,
    organizationId: body.organization.id,
  };
});
