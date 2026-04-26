import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest base. JS (not TS) so cross-package imports resolve through
 * Node's ESM loader without a build step.
 *
 * Consumers extend via:
 *
 *   import { mergeConfig, defineConfig } from 'vitest/config';
 *   import base from '@dentabill/config/vitest';
 *   export default mergeConfig(base, defineConfig({ ... }));
 *
 * @type {import('vitest/config').UserConfig}
 */
export default defineConfig({
  test: {
    globals: false,
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/dist/**',
        '**/node_modules/**',
        '**/__fixtures__/**',
        '**/vitest.config.*',
      ],
    },
  },
});
