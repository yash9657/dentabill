import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

import base from '@dentabill/config/vitest';

/**
 * `apps/web` runs Vitest in jsdom with React enabled, mirroring
 * `@dentabill/ui`. Component / page tests live in `src/**`; e2e tests
 * (P2-T7) will live under `e2e/` and run via Playwright, NOT Vitest.
 *
 * `globals: false` matches the rest of the monorepo (explicit imports of
 * describe/it/expect). With that, @testing-library/react's auto-cleanup
 * is disabled — `test/setup.ts` registers it explicitly.
 */
export default mergeConfig(
  base,
  defineConfig({
    plugins: [react()],
    test: {
      name: '@dentabill/web',
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      globals: false,
      exclude: ['e2e/**', '**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/.next/**'],
    },
  }),
);
