import type { NextConfig } from 'next';

/**
 * Next.js 15 config (App Router, RSC by default — see ADR-014).
 *
 * Kept minimal in this scaffold. Future tasks fill it out:
 *   • P2-T6 — security headers via `middleware.ts` (CSP, HSTS, COOP, COEP)
 *   • P2-T9 — `@next/bundle-analyzer` wraps this config behind ANALYZE=1
 *   • Marketing tasks may add `images.remotePatterns` for product screenshots
 *
 * `transpilePackages` is required because `@dentabill/ui` ships raw
 * TypeScript sources (no build step — see its `package.json#main`); Next
 * needs to compile them through SWC like first-party app code.
 *
 * `poweredByHeader: false` strips the `X-Powered-By: Next.js` header. It
 * leaks framework + version, which is unnecessary attack-surface signal.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@dentabill/ui', '@dentabill/types'],
  typedRoutes: true,
  /**
   * `@dentabill/ui` ships raw TypeScript and uses NodeNext-style relative
   * imports (`./tokens.js`) — the canonical way TS authors ESM source.
   * Webpack alone does not resolve those `.js` specifiers to sibling `.ts`
   * files; this `extensionAlias` teaches it the TS resolver convention so
   * the workspace package builds without a separate compile step.
   */
  webpack(config) {
    const resolve = (config.resolve ??= {});
    resolve.extensionAlias = {
      ...(resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  /**
   * Turbopack (used by `next dev` and increasingly by `next build`) reads
   * resolver hints from this top-level key rather than `webpack()`.
   */
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    resolveAlias: {},
  },
};

export default nextConfig;
