import { defineConfig, mergeConfig } from 'vitest/config';

import base from '@dentabill/config/vitest';

/**
 * `@dentabill/api` vitest config.
 *
 * Mirrors the env-handling pattern from `@dentabill/db`'s vitest config:
 * vitest's `test.env` block sets variables BEFORE any setup runs and
 * survives turbo's task-level env scoping (turbo can strip job-level
 * env vars from individual task environments). Without setting
 * `DATABASE_URL` here, the integration tests would fall back to the
 * dummy value in `vitest.setup.ts` and fail to authenticate against
 * the real test database.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      name: '@dentabill/api',
      environment: 'node',
      globals: false,
      setupFiles: ['./vitest.setup.ts'],
      env: {
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          process.env.DATABASE_URL ??
          'postgresql://dentabill:dentabill@localhost:5432/dentabill_test?schema=public',
        REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
        NODE_ENV: 'test',
      },
      // Tests share a single DB instance; running serially per file
      // avoids the truncate races that come with parallel pools.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  }),
);
