/**
 * Security-header policy for `apps/web`. Pure helpers consumed by
 * `middleware.ts`. Kept testable: the middleware itself depends on
 * `next/server` and the edge runtime, but these functions are pure
 * strings and can be exercised in plain Vitest.
 *
 * Threat model in scope (more in `docs/SECURITY.md`):
 *   - XSS via injected <script> — mitigated by strict CSP with nonce.
 *   - Clickjacking — `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
 *   - MIME sniffing — `X-Content-Type-Options: nosniff`.
 *   - Cross-window communication side-channels — `COOP same-origin`.
 *   - Third-party iframe / embed leakage — `COEP credentialless` (looser
 *     than `require-corp` so it doesn't break analytics/embeds we may
 *     add later, but still cuts most cross-origin leak paths).
 *   - Referer leakage — `strict-origin-when-cross-origin`.
 *   - Powerful APIs that we never use — Permissions-Policy denies them.
 *   - Downgrade to plaintext HTTP — HSTS with preload and includeSubDomains.
 *
 * What we deliberately accept:
 *   - `style-src 'unsafe-inline'`. Next.js inlines critical CSS at SSR time;
 *     hashing every variant explodes the header. Tightening to hashes is
 *     a known follow-up — likely lands with the marketing CMS in Phase 5
 *     once the inlined-CSS surface stabilises.
 *   - In dev, `'unsafe-eval'` is added so HMR works. Production CSP is
 *     strict.
 */

const STATIC_HEADERS = {
  /**
   * 2 years, applies to subdomains, preload-list eligible. Once the
   * production domain is on the Chromium HSTS preload list, browsers
   * upgrade HTTP→HTTPS even on first visit. Not removable without a
   * formal preload removal — only ship this when the domain is
   * exclusively HTTPS, which Phase 6 (Stripe + Cloud) will lock in.
   */
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  /**
   * `credentialless` rather than `require-corp` because PRD §2's stack
   * (Clerk, Retell webhooks in admin views, future embeds) relies on
   * cross-origin resources that won't all carry CORP headers. The
   * `credentialless` value still blocks credentialed cross-origin reads.
   */
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'same-origin',
  /**
   * Deny powerful browser APIs we don't use. Accepting incoming Retell
   * webhooks happens server-side, so the browser never needs microphone /
   * camera. Dental practices won't be making payments from this surface
   * either — Stripe is server-side too.
   */
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=(), browsing-topics=()',
  'X-DNS-Prefetch-Control': 'off',
} as const;

export type SecurityHeaderName = keyof typeof STATIC_HEADERS;

export function getStaticSecurityHeaders(): Readonly<Record<SecurityHeaderName, string>> {
  return STATIC_HEADERS;
}

export interface BuildCspOptions {
  /** Per-request nonce, base64-encoded, applied to script-src. */
  readonly nonce: string;
  /**
   * Production tightens script-src; dev adds 'unsafe-eval' for HMR and
   * uses CSP-Report-Only for the migration period. Toggle with
   * `process.env.NODE_ENV === 'production'`.
   */
  readonly isProd: boolean;
}

/**
 * Builds the Content-Security-Policy string. `strict-dynamic` lets
 * Next.js's runtime load nested scripts it trusts (the framework's own
 * preload chain) without each one needing the nonce, which would force
 * us to fingerprint internal Next.js URLs.
 */
export function buildCsp({ nonce, isProd }: BuildCspOptions): string {
  const scriptDirectives = [
    `'self'`,
    `'nonce-${nonce}'`,
    `'strict-dynamic'`,
    isProd ? null : `'unsafe-eval'`,
  ].filter((part): part is string => part !== null);

  const directives = [
    `default-src 'self'`,
    `script-src ${scriptDirectives.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `connect-src 'self'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    isProd ? `upgrade-insecure-requests` : null,
  ].filter((part): part is string => part !== null);

  return directives.join('; ');
}

/**
 * Returns the header name to use. We send Report-Only in dev so a tight
 * policy doesn't block local development while we iron out edge cases;
 * production enforces the policy.
 */
export function cspHeaderName(
  isProd: boolean,
): 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' {
  return isProd ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
}

/**
 * Generates a 16-byte cryptographic nonce, base64-encoded (~24 chars).
 * Web Crypto is available in both Node 20+ and Next.js's edge runtime,
 * so this works everywhere middleware runs without polyfills.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
