import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

import {
  buildCsp,
  cspHeaderName,
  generateNonce,
  getStaticSecurityHeaders,
} from './lib/security-headers.js';

/**
 * Composite edge middleware: Clerk authentication + the DentaBill
 * security-header set.
 *
 * Pipeline, in order:
 *
 *   1. Mint a per-request CSP nonce (Web Crypto, 16 base64 bytes) so
 *      every nonce-tagged inline script / style is bound to one request.
 *   2. Hand control to `clerkMiddleware()`.
 *      a. Protected routes (`/dashboard/**` and `/onboarding`) require
 *         an authenticated session — `auth.protect()` throws to /sign-in
 *         otherwise.
 *      b. Already-signed-in visitors hitting `/sign-in` or `/sign-up`
 *         (without an invite ticket — the ticket case is the legitimate
 *         "I'm accepting an invite to a new practice" path) are
 *         redirected to `/dashboard/overview`.
 *   3. Stamp the static security headers and the nonce-bound CSP.
 *
 * Onboarding completion is **not** gated here. We tried gating on
 * `publicMetadata.onboarded` but the Clerk session JWT caches metadata
 * at issuance time, so the cookie can lag behind the DB by up to ~50s
 * even after `getToken({ skipCache: true })` and `user.reload()`. The
 * dashboard layout (a Server Component with direct DB access) now does
 * the onboarded check by reading the `User.clerkUserId` row — that's
 * the source of truth and self-heals any cache drift.
 */
const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/onboarding']);
const isAuthEntryRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

const TICKET_PARAMS = ['__clerk_ticket', '__clerk_invitation_token', 'ticket'] as const;

function hasInviteTicket(request: NextRequest): boolean {
  const params = request.nextUrl.searchParams;
  return TICKET_PARAMS.some((key) => Boolean(params.get(key)));
}

const hasClerkKeys = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

function applySecurityHeaders(
  response: NextResponse,
  csp: string,
  cspHeader: string,
): NextResponse {
  response.headers.set(cspHeader, csp);
  for (const [name, value] of Object.entries(getStaticSecurityHeaders())) {
    response.headers.set(name, value);
  }
  return response;
}

function stampRequestNonce(request: NextRequest): {
  readonly requestHeaders: Headers;
  readonly csp: string;
  readonly cspHeader: string;
} {
  const nonce = generateNonce();
  const isProd = process.env.NODE_ENV === 'production';
  const csp = buildCsp({ nonce, isProd });
  const cspHeader = cspHeaderName(isProd);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(cspHeader, csp);

  return { requestHeaders, csp, cspHeader };
}

const middlewareWithoutClerk = (request: NextRequest): NextResponse => {
  const { requestHeaders, csp, cspHeader } = stampRequestNonce(request);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(response, csp, cspHeader);
};

const middlewareWithClerk = clerkMiddleware(async (auth, request) => {
  const { requestHeaders, csp, cspHeader } = stampRequestNonce(request);
  const session = await auth();
  const url = request.nextUrl;

  // /dashboard/** and /onboarding require an authenticated session.
  // The dashboard layout (a Server Component) does the onboarded
  // check against the DB after this gate passes — see the comment
  // at the top of this file for why we don't read publicMetadata
  // from sessionClaims here.
  if (isProtectedRoute(request)) {
    await auth.protect();
  }

  // Already-signed-in users hitting /sign-in or /sign-up without an
  // invite ticket get bounced to the dashboard. The dashboard layout
  // will redirect them to /onboarding if they haven't completed it
  // yet — single source of truth, no metadata cache to fight.
  if (session.userId && isAuthEntryRoute(request) && !hasInviteTicket(request)) {
    const target = new URL('/dashboard/overview', url);
    return applySecurityHeaders(NextResponse.redirect(target), csp, cspHeader);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(response, csp, cspHeader);
});

export default hasClerkKeys ? middlewareWithClerk : middlewareWithoutClerk;

export const config = {
  matcher: ['/((?!_next/static|_next/image|_next/data|favicon\\.ico).*)'],
};
