import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

import {
  buildCsp,
  cspHeaderName,
  generateNonce,
  getStaticSecurityHeaders,
} from './lib/security-headers.js';

/**
 * Composite edge middleware: Clerk authentication on top of the
 * DentaBill security-header set.
 *
 * The pipeline is, in order:
 *
 *   1. Mint a per-request CSP nonce (Web Crypto, 16 base64 bytes) so
 *      every nonce-tagged inline script / style is bound to one
 *      request and one only.
 *   2. Hand control to `clerkMiddleware()`. If the request matches
 *      `isProtectedRoute` (currently `/dashboard/**`), Clerk redirects
 *      the visitor to /sign-in when they don't have a session;
 *      everything else passes through untouched.
 *   3. Whatever response Clerk returns gets stamped with the static
 *      security headers (HSTS, X-Frame-Options DENY, COOP/COEP/CORP,
 *      X-Content-Type-Options nosniff, Referrer-Policy, Permissions-
 *      Policy) and the nonce-bound CSP for the current request.
 *
 * Threading the CSP through both the request and the response lets
 * Next.js's RSC streaming reuse the same policy when it injects
 * framework scripts.
 *
 * `clerkMiddleware()` is configured to run only when Clerk env keys
 * are present. In dev or CI without keys, it's a no-op pass-through;
 * the security-header pipeline still runs unchanged.
 */
const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);

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

  if (isProtectedRoute(request)) {
    await auth.protect();
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(response, csp, cspHeader);
});

export default hasClerkKeys ? middlewareWithClerk : middlewareWithoutClerk;

/**
 * Apply to everything *except* asset paths Next.js streams without
 * needing a CSP nonce. Public files (`/icon.svg`, `/robots.txt`,
 * `/sitemap.xml`) still flow through middleware — they're served by
 * route handlers and benefit from the static security headers.
 *
 * Clerk's matcher conventions are different from Next's default; this
 * matcher is the union of "everything we want CSP on" and "everything
 * Clerk wants to inspect for auth". The exclude list is identical, so
 * Clerk works on every page that needs auth and every page CSP needs.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|_next/data|favicon\\.ico).*)'],
};
