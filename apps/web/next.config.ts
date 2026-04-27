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
  /**
   * Externalise packages that resolve native binaries or worker files
   * by relative path inside their own `node_modules` install. Webpack
   * rewrites those paths into `.next/server/vendor-chunks/...` and the
   * runtime crashes (e.g. `Cannot find module '.../lib/worker.js'`).
   * Marking these external delegates the `require()` to Node, which
   * finds the file in `node_modules/<pkg>/lib/worker.js` where the
   * package authors expect it to live.
   *
   * - `@prisma/client` + `.prisma/client`: library engine + worker.js
   * - `pino`: thread-stream worker thread
   * - `pino-pretty`: pino transport, loaded via worker_threads
   * - `thread-stream`: pino's worker harness
   */
  serverExternalPackages: [
    '@prisma/client',
    '.prisma/client',
    'pino',
    'pino-pretty',
    'thread-stream',
  ],
  typedRoutes: true,
  /**
   * `@dentabill/ui` ships raw TypeScript and uses NodeNext-style relative
   * imports (`./tokens.js`) — the canonical way TS authors ESM source.
   * Webpack alone does not resolve those `.js` specifiers to sibling `.ts`
   * files; this `extensionAlias` teaches it the TS resolver convention so
   * the workspace package builds without a separate compile step.
   */
  webpack(config, { isServer }) {
    const resolve = (config.resolve ??= {});
    resolve.extensionAlias = {
      ...(resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };

    /**
     * `serverExternalPackages` does not always traverse into packages
     * reached via workspace symlinks (`@dentabill/db` → `@dentabill/logger`
     * → `pino`). When pino ends up bundled, its `thread-stream` transport
     * tries to load `lib/worker.js` from a webpack-rewritten path and the
     * dev server / `next start` runtime crashes on every request. Adding
     * the same set as a hard webpack externals on the server side
     * guarantees Node resolves them at runtime where their internal
     * relative paths still hold.
     */
    if (isServer) {
      const SERVER_EXTERNALS = [
        '@prisma/client',
        '.prisma/client',
        'pino',
        'pino-pretty',
        'thread-stream',
      ];
      const existing = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [
        ...existing,
        ({ request }: { request?: string }, callback: (err?: unknown, result?: string) => void) => {
          if (request && SERVER_EXTERNALS.includes(request)) {
            callback(undefined, `commonjs ${request}`);
            return;
          }
          callback();
        },
      ];
    }
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
