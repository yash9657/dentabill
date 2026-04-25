import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest base. Consumers extend via:
 *
 *   import { mergeConfig } from 'vitest/config';
 *   import base from '@dentabill/config/vitest';
 *   export default mergeConfig(base, defineConfig({ ... }));
 */
export default defineConfig({
  test: {
    globals: false,
    include: ['**/*.{test,spec}.ts'],
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
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/dist/**',
        '**/node_modules/**',
        '**/__fixtures__/**',
        '**/vitest.config.{ts,js}',
      ],
    },
  },
});
