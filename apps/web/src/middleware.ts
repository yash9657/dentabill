import { NextResponse, type NextRequest } from 'next/server';

import {
  buildCsp,
  cspHeaderName,
  generateNonce,
  getStaticSecurityHeaders,
} from './lib/security-headers.js';

/**
 * Edge middleware that stamps every navigation/document response with the
 * DentaBill security-header set: a strict, nonce-based CSP plus HSTS,
 * COOP/COEP/CORP, X-Frame-Options DENY, X-Content-Type-Options nosniff,
 * Referrer-Policy strict-origin-when-cross-origin, and Permissions-Policy
 * denying every browser capability we don't intentionally use.
 *
 * Per-request nonce flow:
 *   1. Mint a fresh base64 nonce (16 random bytes from Web Crypto).
 *   2. Forward it to the request via an `x-nonce` header so downstream
 *      RSC code can read it via `headers()` and apply it to inline
 *      `<script>` / `<style>` tags as needed.
 *   3. Emit the same nonce inside the response's `Content-Security-Policy`
 *      header so the browser whitelists it.
 *
 * Static assets and Next.js's internal pipelines bypass this middleware
 * via the matcher — they don't set their own `<script>` tags, so the CSP
 * isn't relevant, and matching them would just thrash the nonce cache.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const isProd = process.env.NODE_ENV === 'production';
  const csp = buildCsp({ nonce, isProd });
  const cspHeader = cspHeaderName(isProd);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Threading the CSP through the request lets Next.js's RSC streaming
  // reuse the same policy when it injects framework scripts.
  requestHeaders.set(cspHeader, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set(cspHeader, csp);
  for (const [name, value] of Object.entries(getStaticSecurityHeaders())) {
    response.headers.set(name, value);
  }

  return response;
}

/**
 * Apply to everything *except* asset paths Next.js streams without needing
 * a CSP nonce. Public files (`/icon.svg`, `/robots.txt`, `/sitemap.xml`)
 * still flow through middleware — they're served by route handlers and
 * benefit from the static security headers.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|_next/data|favicon\\.ico).*)'],
};
