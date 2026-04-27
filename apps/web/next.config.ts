import withBundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';

/**
 * Next.js 15 config (App Router, RSC by default — see ADR-014).
 *
 * `transpilePackages` is required because `@dentabill/ui` ships raw
 * TypeScript sources (no build step — see its `package.json#main`); Next
 * needs to compile them through SWC like first-party app code.
 *
 * `poweredByHeader: false` strips the `X-Powered-By: Next.js` header —
 * unnecessary attack-surface signal.
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

/**
 * `@next/bundle-analyzer` wraps the config when `ANALYZE=1`. Locally this
 * opens the treemap report in the browser; in CI we capture the JSON
 * `__next/build-manifest.json` instead and pipe it through
 * `scripts/check-bundle-budget.mjs` to enforce ADR-020.
 */
const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === '1',
});

export default bundleAnalyzer(nextConfig);
